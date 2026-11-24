// Minimal Firestore REST client for Cloudflare Workers (no Node SDK needed, runs on the free plan).
import { AppError } from '../../public/shared/core.js';

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`Unsupported value type: ${typeof v}`);
}
export function toFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = toValue(v);
  return f;
}
export function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
export function fromFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = fromValue(v);
  return o;
}

let cached = { token: '', exp: 0 };

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const header = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const code = String(detail?.error || 'unknown').slice(0, 60);
    const description = String(detail?.error_description || detail?.error?.message || 'No diagnostic returned').replace(/[\\r\\n\\t]/g, ' ').slice(0, 180);
    console.error('Google OAuth token exchange failed', { httpStatus: res.status, error: code, description });
    throw new Error(`token exchange failed: ${res.status} ${code}: ${description}`);
  }
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

export class FirestoreStore {
  constructor(env) {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing');
    this.sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (!this.sa.project_id || !this.sa.client_email || !this.sa.private_key) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is incomplete: project_id, client_email and private_key are required');
    }
    // Guard against a service account from the wrong project. The expected id defaults to this
    // shop's project; a deployment (or a test fixture) may pin another one with FIREBASE_PROJECT_ID.
    const expected = env.FIREBASE_PROJECT_ID || 'e-comerce-e5345';
    if (this.sa.project_id !== expected) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT project_id mismatch: expected ${expected}, received ${String(this.sa.project_id).slice(0, 80)}`);
    }
    this.base = `https://firestore.googleapis.com/v1/projects/${this.sa.project_id}/databases/(default)/documents`;
    this.dbName = `projects/${this.sa.project_id}/databases/(default)/documents`;
  }

  async _fetch(url, init = {}) {
    const token = await accessToken(this.sa);
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (res.status === 404) return null;
    if (res.status === 409) throw new AppError('tx_aborted', 'Busy, please retry', 409);
    if (!res.ok) throw new Error(`firestore ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  _doc(d) {
    return { ...fromFields(d.fields || {}), id: d.name.split('/').pop() };
  }

  async get(col, id, txId) {
    const q = txId ? `?transaction=${encodeURIComponent(txId)}` : '';
    const d = await this._fetch(`${this.base}/${col}/${encodeURIComponent(id)}${q}`);
    return d ? this._doc(d) : null;
  }

  async query(col, conds = [], limit = 0) {
    const filters = conds.map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: { '==': 'EQUAL', in: 'IN', '>=': 'GREATER_THAN_OR_EQUAL', '<=': 'LESS_THAN_OR_EQUAL' }[op], value: toValue(value) },
    }));
    const structuredQuery = { from: [{ collectionId: col }] };
    if (filters.length) structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
    if (limit) structuredQuery.limit = limit;
    const rows = await this._fetch(`${this.base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) });
    return (rows || []).filter((r) => r.document).map((r) => this._doc(r.document));
  }

  async begin() {
    const store = this;
    const t = await this._fetch(`${this.base}:beginTransaction`, { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) });
    const txId = t.transaction;
    const pending = new Map();
    return {
      async get(col, id) {
        const hit = pending.get(`${col}/${id}`);
        if (hit) return { ...JSON.parse(JSON.stringify(hit.data)), id };
        return store.get(col, id, txId);
      },
      set(col, id, data) {
        const { id: _drop, ...rest } = data;
        pending.set(`${col}/${id}`, { col, id, data: rest });
      },
      async commit() {
        const writes = [...pending.values()].map(({ col, id, data }) => ({
          update: { name: `${store.dbName}/${col}/${id}`, fields: toFields(data) },
        }));
        await store._fetch(`${store.base}:commit`, { method: 'POST', body: JSON.stringify({ writes, transaction: txId }) });
        pending.clear();
      },
    };
  }
}
