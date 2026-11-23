// Drives the real Worker code against a fake Firestore REST + Google auth server, so the REST encoding,
// transactions, queries, token check and role lookup are exercised end to end (no network, no real project).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { onRequest } from '../functions/api/[[path]].js';
import { toFields, fromFields } from '../functions/_lib/firestore.js';
import { defaultShop } from '../public/shared/handlers.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'demo', client_email: 'svc@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const env = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), FIREBASE_API_KEY: 'k', BOOTSTRAP_TOKEN: 'boot' };
const NOW = Date.now();

const db = {
  'shops/main': defaultShop('main', 'Fake Shop', NOW),
  'products/p1': { shopId: 'main', name: 'Shirt', price: 1000, salePrice: 0, stock: 3, active: true, images: [] },
  'users/boss': { email: 'boss@x.y', role: 'owner', shopId: 'main' },
};
let commits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
    const { idToken } = JSON.parse(init.body);
    return idToken.startsWith('boss') ? json({ users: [{ localId: 'boss', email: 'boss@x.y' }] }) : json({ error: 'bad' }, 400);
  }
  if (!url.startsWith('https://firestore.googleapis.com/')) throw new Error('unexpected fetch ' + url);
  assert.equal(init.headers.authorization, 'Bearer tok');
  const path = url.split('/documents')[1] || '';
  if (path.startsWith(':beginTransaction')) return json({ transaction: 'tx1' });
  if (path.startsWith(':runQuery')) {
    const q = JSON.parse(init.body).structuredQuery;
    const col = q.from[0].collectionId;
    const filters = !q.where ? [] : q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where];
    const rows = Object.entries(db).filter(([k]) => k.startsWith(col + '/')).filter(([, d]) => filters.every((f) => {
      const v = fromFields({ x: f.fieldFilter.value }).x, fv = d[f.fieldFilter.field.fieldPath];
      return f.fieldFilter.op === 'EQUAL' ? fv === v : f.fieldFilter.op === 'GREATER_THAN_OR_EQUAL' ? fv >= v : true;
    })).slice(0, q.limit || 1e9);
    return json(rows.length ? rows.map(([k, d]) => ({ document: { name: `x/${k}`, fields: toFields(d) } })) : [{}]);
  }
  if (path.startsWith(':commit')) {
    commits += 1;
    for (const w of JSON.parse(init.body).writes) db[w.update.name.split('/documents/')[1]] = fromFields(w.update.fields);
    return json({ writeResults: [] });
  }
  const key = decodeURIComponent(path.slice(1).split('?')[0]);
  return db[key] ? json({ name: `x/${key}`, fields: toFields(db[key]) }) : json({ error: { code: 404 } }, 404);
};
test.after(() => { globalThis.fetch = realFetch; });

const call = (name, body, token) => onRequest({
  request: new Request(`https://shop.test/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }),
  env, params: { path: [name] },
});
const customer = { name: 'Rahim', phone: '01712345678', address: 'House 1, Road 2, Dhaka', district: 'Dhaka' };

test('order through the Worker: price from DB, stock decremented in a Firestore transaction', async () => {
  const res = await call('createOrder', { shopId: 'main', items: [{ productId: 'p1', qty: 2, price: 1 }], customer });
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.data.total, 2000 + 60);
  assert.equal(db['products/p1'].stock, 1);
  const order = db[`orders/${j.data.id}`];
  assert.equal(order.customer.phone, '01712345678');
  assert.equal(db['customers/main_01712345678'].orders, 1);
});

test('oversell is refused with 409 and nothing is written', async () => {
  const before = commits;
  const res = await call('createOrder', { shopId: 'main', items: [{ productId: 'p1', qty: 5 }], customer });
  assert.equal(res.status, 409);
  assert.equal(commits, before);
  assert.equal(db['products/p1'].stock, 1);
});

test('tracking works through query; wrong phone gets the same 404', async () => {
  const no = Object.values(db).find((d) => d.no)?.no;
  const ok = await call('trackOrder', { no, phone: '01712345678' });
  assert.equal(ok.status, 200);
  assert.equal((await call('trackOrder', { no, phone: '01999999999' })).status, 404);
});

test('admin endpoints need a real token and the right shop', async () => {
  const id = Object.keys(db).find((k) => k.startsWith('orders/')).split('/')[1];
  assert.equal((await call('adminUpdateOrder', { id, action: 'status', status: 'confirmed' })).status, 401);
  assert.equal((await call('adminUpdateOrder', { id, action: 'status', status: 'confirmed' }, 'x'.repeat(150))).status, 401);
  const good = await call('adminUpdateOrder', { id, action: 'status', status: 'confirmed' }, 'boss' + 'x'.repeat(150));
  assert.equal(good.status, 200, JSON.stringify(await good.clone().json()));
  assert.equal(db[`orders/${id}`].status, 'confirmed');
  db['users/boss'].shopId = 'other';
  assert.equal((await call('adminUpdateOrder', { id, action: 'note', text: 'hi' }, 'boss' + 'x'.repeat(150))).status, 403);
  db['users/boss'].shopId = 'main';
});

test('bootstrap: setup token required, works once', async () => {
  const t = 'boss' + 'x'.repeat(150);
  delete db['users/boss'];
  assert.equal((await call('bootstrap', { token: 'wrong' }, t)).status, 403);
  assert.equal((await call('bootstrap', { token: 'boot', shopName: 'Hi' }, t)).status, 200);
  assert.equal(db['users/boss'].role, 'super');
  assert.equal((await call('bootstrap', { token: 'boot' }, t)).status, 409);
});
