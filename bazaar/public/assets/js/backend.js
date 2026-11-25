// One interface, two engines: real Firebase (when config.js has keys) or an offline demo kept in this browser.
import { CONFIG } from './config.js';
import { MemStore } from '../../shared/memstore.js';
import { handlers, NEEDS_AUTH } from '../../shared/handlers.js';
import { AppError } from '../../shared/core.js';
import { seedData } from './seed.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1';
let singleton;

export async function initBackend() {
  if (singleton) return singleton;
  let fb = CONFIG.firebase;
  if (!fb?.apiKey) {
    try {
      const r = await fetch('/api/config');
      const j = await r.json();
      if (j?.ok && j.data?.firebase?.apiKey) fb = j.data.firebase;
    } catch { /* offline / static server without /api/config */ }
  }
  singleton = fb?.apiKey ? firebaseBackend(fb) : demoBackend();
  return singleton;
}

function parseApi(json) {
  if (json && json.ok) return json.data;
  const e = new Error(json?.error?.message || 'Something went wrong');
  e.code = json?.error?.code || 'server_error';
  throw e;
}

/* ------------------------------------------------------------------ Firebase */
async function firebaseBackend(firebaseConfig) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const fs = F.getFirestore(app);
  const listeners = new Set();
  const state = { user: null };

  async function loadProfile(u) {
    if (!u) return null;
    const ref = F.doc(fs, 'users', u.uid);
    let snap = await F.getDoc(ref);
    if (!snap.exists()) {
      await F.setDoc(ref, { email: u.email || '', role: 'customer', shopId: '', createdAt: Date.now() });
      snap = await F.getDoc(ref);
    }
    return { uid: u.uid, email: u.email || '', ...snap.data() };
  }
  const ready = new Promise((resolve) => {
    A.onAuthStateChanged(auth, async (u) => {
      try { state.user = await loadProfile(u); } catch { state.user = u ? { uid: u.uid, email: u.email, role: 'customer', shopId: '' } : null; }
      listeners.forEach((cb) => cb(state.user));
      resolve();
    });
  });

  const build = (col, { where = [], orderBy = [], limit = 0 } = {}) => {
    const c = [...where.map(([f, op, v]) => F.where(f, op, v)), ...orderBy.map(([f, d]) => F.orderBy(f, d || 'asc'))];
    if (limit) c.push(F.limit(limit));
    return F.query(F.collection(fs, col), ...c);
  };
  const rows = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

  return {
    mode: 'firebase', ready,
    auth: {
      get user() { return state.user; },
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      async signIn(email, pw) { await A.signInWithEmailAndPassword(auth, email, pw); await ready; await this.refresh(); },
      async signUp(email, pw, extra = {}) {
        const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
        await F.setDoc(F.doc(fs, 'users', cred.user.uid), { email, role: 'customer', shopId: '', createdAt: Date.now(), ...pick(extra, ['name', 'phone', 'address', 'district']) });
        await this.refresh();
      },
      async signOut() { await A.signOut(auth); },
      async reset(email) { await A.sendPasswordResetEmail(auth, email); },
      async refresh() { state.user = await loadProfile(auth.currentUser); listeners.forEach((cb) => cb(state.user)); },
    },
    db: {
      async list(col, opts) { return rows(await F.getDocs(build(col, opts))); },
      async get(col, id) { const s = await F.getDoc(F.doc(fs, col, id)); return s.exists() ? { ...s.data(), id } : null; },
      async set(col, id, data) { const { id: _i, ...d } = data; await F.setDoc(F.doc(fs, col, id), d); return id; },
      async update(col, id, patch) { await F.updateDoc(F.doc(fs, col, id), patch); },
      async remove(col, id) { await F.deleteDoc(F.doc(fs, col, id)); },
      watch(col, opts, cb) { return F.onSnapshot(build(col, opts), (s) => cb(rows(s)), () => cb(null)); },
    },
    async api(name, body = {}) {
      const headers = { 'content-type': 'application/json' };
      if (auth.currentUser) headers.authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
      const res = await fetch(`/api/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
      return parseApi(await res.json().catch(() => null));
    },
  };
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/* ---------------------------------------------------------------------- Demo */
const KEY = 'bz_demo_v1';
const PW = 'bz_demo_pw_v1';
const SESSION = 'bz_demo_session_v1';
const DEMO_ENV = { BOOTSTRAP_TOKEN: 'demo' };

function safeLS(fn, fallback) { try { return fn(); } catch { return fallback; } }

function demoBackend() {
  const load = () => safeLS(() => JSON.parse(localStorage.getItem(KEY)), null);
  const initial = load() || (() => {
    const d = seedData(Date.now());
    d.users.demo_owner = { email: 'owner@demo.test', role: 'owner', shopId: 'main', name: 'Demo Owner', createdAt: Date.now() };
    d.users.demo_super = { email: 'super@demo.test', role: 'super', shopId: '', name: 'Platform Admin', createdAt: Date.now() };
    return d;
  })();
  const pws = safeLS(() => JSON.parse(localStorage.getItem(PW)), null) || { 'owner@demo.test': 'demo1234', 'super@demo.test': 'demo1234' };
  const watchers = new Set();
  const listeners = new Set();
  let persistTimer;

  const store = new MemStore(initial, (col) => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => safeLS(() => localStorage.setItem(KEY, JSON.stringify(store.data))), 50);
    notify(col);
  });
  safeLS(() => localStorage.setItem(KEY, JSON.stringify(store.data)));
  safeLS(() => localStorage.setItem(PW, JSON.stringify(pws)));

  const sort = (arr, orderBy) => {
    for (const [f, d] of [...orderBy].reverse()) arr.sort((a, b) => ((a[f] > b[f]) - (a[f] < b[f])) * (d === 'desc' ? -1 : 1));
    return arr;
  };
  const list = async (col, { where = [], orderBy = [], limit = 0 } = {}) => {
    const r = sort(await store.query(col, where), orderBy);
    return limit ? r.slice(0, limit) : r;
  };
  function notify(col) { watchers.forEach((w) => { if (w.col === col) list(w.col, w.opts).then(w.cb); }); }

  const state = { user: null };
  const sid = safeLS(() => localStorage.getItem(SESSION), null);
  async function profileOf(uid) {
    const p = await store.get('users', uid);
    return p ? { uid, ...p } : null;
  }
  const ready = (async () => { if (sid) state.user = await profileOf(sid); })();
  const emit = () => listeners.forEach((cb) => cb(state.user));
  const mkUid = (email) => `demo_${btoa(unescape(encodeURIComponent(email))).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;

  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    store.data = JSON.parse(e.newValue);
    ['orders', 'products', 'customers', 'coupons', 'shops', 'categories', 'users', 'invites'].forEach(notify);
  });

  return {
    mode: 'demo', ready,
    auth: {
      get user() { return state.user; },
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      async signIn(email, pw) {
        email = String(email).trim().toLowerCase();
        if (pws[email] !== pw) throw Object.assign(new Error('Wrong email or password'), { code: 'bad_credentials' });
        const [u] = await store.query('users', [['email', '==', email]], 1);
        state.user = u ? { uid: u.id, ...u } : null;
        safeLS(() => localStorage.setItem(SESSION, state.user.uid));
        emit();
      },
      async signUp(email, pw, extra = {}) {
        email = String(email).trim().toLowerCase();
        if (pws[email]) throw Object.assign(new Error('That email already has an account'), { code: 'email_in_use' });
        if (String(pw).length < 6) throw Object.assign(new Error('Password must be at least 6 characters'), { code: 'weak_password' });
        pws[email] = pw;
        safeLS(() => localStorage.setItem(PW, JSON.stringify(pws)));
        const uid = mkUid(email);
        await store.put('users', uid, { email, role: 'customer', shopId: '', createdAt: Date.now(), ...pick(extra, ['name', 'phone', 'address', 'district']) });
        state.user = await profileOf(uid);
        safeLS(() => localStorage.setItem(SESSION, uid));
        emit();
      },
      async signOut() { state.user = null; safeLS(() => localStorage.removeItem(SESSION)); emit(); },
      async reset() { /* no email in demo */ },
      async refresh() { if (state.user) state.user = await profileOf(state.user.uid); emit(); },
    },
    db: {
      list,
      get: (col, id) => store.get(col, id),
      async set(col, id, data) { await store.put(col, id, data); return id; },
      async update(col, id, patch) { await store.merge(col, id, patch); },
      remove: (col, id) => store.remove(col, id),
      watch(col, opts, cb) { const w = { col, opts, cb }; watchers.add(w); list(col, opts).then(cb); return () => watchers.delete(w); },
    },
    async api(name, body = {}) {
      try {
        if (!Object.hasOwn(handlers, name)) throw new AppError('not_found', 'Unknown endpoint', 404);
        const user = state.user;
        if (NEEDS_AUTH.has(name) && !user) throw new AppError('auth_required', 'Sign in required', 401);
        const data = await handlers[name](store, { now: Date.now(), user }, JSON.parse(JSON.stringify(body)), DEMO_ENV);
        if (['claimInvite', 'bootstrap'].includes(name)) await this.auth.refresh();
        return data;
      } catch (e) {
        if (e instanceof AppError) throw Object.assign(new Error(e.message), { code: e.code });
        throw e;
      }
    },
    resetDemo() { safeLS(() => { localStorage.removeItem(KEY); localStorage.removeItem(PW); localStorage.removeItem(SESSION); }); location.reload(); },
  };
}
