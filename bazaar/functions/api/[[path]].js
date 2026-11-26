// One Pages Function serves every /api/* call. All price, stock and permission decisions happen here.
import { AppError } from '../../public/shared/core.js';
import { handlers, NEEDS_AUTH } from '../../public/shared/handlers.js';
import { FirestoreStore } from '../_lib/firestore.js';
import { authenticate, verifyTurnstile } from '../_lib/auth.js';

const MAX_BODY = 64 * 1024;
const CAPTCHA_ON = new Set(['createOrder', 'trackOrder', 'customerCancel']);
const hits = new Map(); // per-isolate throttle; add a Cloudflare rate-limit rule for the real limit (see SETUP.md)

function throttled(key, limit, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > limit;
}

// Constant-time string compare for the courier webhook token.
function sameToken(a, b) {
  const x = new TextEncoder().encode(String(a || '')), y = new TextEncoder().encode(String(b || ''));
  if (!y.length || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (e) => json({ ok: false, error: { code: e.code, message: e.message } }, e.status);

// Product pictures are stored inside the product document; this turns one back into a real, long-cached image file.
async function productImage(request, env, id) {
  const gone = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return gone();
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(request); if (hit) return hit; }
  const p = await new FirestoreStore(env).get('products', id);
  const m = p && p.active !== false ? /^data:(image\/(?:webp|jpeg|png|gif));base64,([A-Za-z0-9+/=]+)$/.exec(p.thumb || p.images?.[0] || '') : null;
  if (!m) return gone();
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const res = new Response(request.method === 'HEAD' ? null : bytes, {
    headers: { 'content-type': m[1], 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-length': String(bytes.length) },
  });
  if (cache) await cache.put(request, res.clone());
  return res;
}

export async function onRequest({ request, env, params }) {
  try {
    const name = [].concat(params.path || []).join('/');
    if (name === 'health') return json({ ok: true });
    if (name.startsWith('img/') && (request.method === 'GET' || request.method === 'HEAD')) return productImage(request, env, name.slice(4));
    if (request.method !== 'POST') throw new AppError('method_not_allowed', 'POST only', 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new AppError('bad_origin', 'Cross-site requests are not allowed', 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new AppError('bad_type', 'JSON required', 415);
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    if (throttled(`all:${ip}`, 90, 60_000) || (name === 'createOrder' && throttled(`order:${ip}`, 12, 600_000))) {
      throw new AppError('rate_limited', 'Too many requests. Please wait a moment.', 429);
    }
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    if (!handler) throw new AppError('not_found', 'Unknown endpoint', 404);
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new AppError('too_large', 'Request too large', 413);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { throw new AppError('bad_json', 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('bad_json', 'Invalid JSON');

    const store = new FirestoreStore(env);
    // The courier calls the webhook with its own shared token, not a Firebase session.
    const webhook = name === 'courierWebhook' && sameToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.STEADFAST_WEBHOOK_TOKEN);
    const user = name === 'courierWebhook' ? null : await authenticate(request, env, store);
    if (NEEDS_AUTH.has(name) && !user) throw new AppError('auth_required', 'Sign in required', 401);
    if (CAPTCHA_ON.has(name)) await verifyTurnstile(env, body.turnstile, ip);

    for (let attempt = 0; ; attempt++) {
      try {
        return json({ ok: true, data: await handler(store, { now: Date.now(), user, webhook }, body, env) });
      } catch (e) {
        if (e?.code === 'tx_aborted' && attempt < 3) continue; // another order touched the same stock
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    // Structured server-side diagnostics: never return internal details to the browser.
    console.error('api error', {
      endpoint: [].concat(params.path || []).join('/'),
      name: e?.name || 'Error',
      message: e?.message || 'Unknown error',
      stack: e?.stack || '',
    });
    // During first-time bootstrap, return a bounded diagnostic so the admin can see
    // whether Firebase token exchange or Firestore setup failed. Never expose stack traces.
    const diagnostic = [].concat(params.path || []).join('/') === 'bootstrap'
      ? String(e?.message || 'Unknown server error').replace(/(?:AIza[0-9A-Za-z_-]{20,}|-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----)/g, '[redacted]').slice(0, 240)
      : 'Something went wrong. Please try again.';
    return json({ ok: false, error: { code: 'server_error', message: diagnostic } }, 500);
  }
}
