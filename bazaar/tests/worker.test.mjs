import test from 'node:test';
import assert from 'node:assert/strict';
import { toFields, fromFields } from '../functions/_lib/firestore.js';
import { onRequest } from '../functions/api/[[path]].js';

const env = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'p', client_email: 'x@p.iam', private_key: 'k' }), FIREBASE_PROJECT_ID: 'p', FIREBASE_API_KEY: 'k' };
const call = (path, { method = 'POST', headers = {}, body = '{}' } = {}) =>
  onRequest({ request: new Request(`https://shop.example/api/${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : body }), env, params: { path: path.split('/') } });

test('firestore value encoding round-trips', () => {
  const doc = { a: 1, b: 1.5, c: 'x', d: true, e: null, f: [1, 'z', { g: 2 }], h: { i: { j: [] } } };
  assert.deepEqual(fromFields(toFields(doc)), doc);
  assert.equal(toFields({ n: 3 }).n.integerValue, '3');
  assert.equal('undefined' in toFields({ u: undefined }), false);
});

test('worker guards: method, origin, content type, endpoint, auth, size, bad json', async () => {
  assert.equal((await call('health', { method: 'GET' })).status, 200);
  assert.equal((await call('createOrder', { method: 'GET' })).status, 405);
  assert.equal((await call('createOrder', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('createOrder', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('constructor')).status, 404);
  assert.equal((await call('__proto__')).status, 404);
  const noAuth = await call('adminUpdateOrder');
  assert.equal(noAuth.status, 401);
  assert.equal((await call('createOrder', { body: 'x'.repeat(70000) })).status, 413);
  assert.equal((await call('createOrder', { body: '[1]' })).status, 400);
  assert.equal((await call('createOrder', { body: '{bad' })).status, 400);
});

test('worker rate limits a noisy client', async () => {
  let last;
  for (let i = 0; i < 100; i++) last = await call('nothing');
  assert.equal(last.status, 429);
});

import { buildReport } from '../public/shared/report.js';
import { runReports } from '../cron-worker/src/index.js';
test('daily report text', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const txt = buildReport({
    shop: { name: 'Demo', currency: '৳' }, now,
    orders: [{ createdAt: now - 3600000, status: 'pending', total: 1000, due: 1000 }, { createdAt: now - 3600000, status: 'cancelled', total: 500, due: 500 }, { createdAt: now - 3 * 86400000, status: 'delivered', total: 700, due: 0 }],
    products: [{ name: 'A', nameBn: 'ক', stock: 2, active: true }, { name: 'B', stock: 50, active: true }, { name: 'C', stock: 1, active: false }],
  });
  assert.match(txt, /নতুন অর্ডার: ২টি/);
  assert.match(txt, /বিক্রি: ৳১,০০০/);
  assert.match(txt, /• ক: ২টি বাকি/);
  assert.doesNotMatch(txt, /• C/);
});
test('cron does nothing without a bot token', async () => {
  assert.deepEqual(await runReports({}), { sent: 0, skipped: 'no bot token' });
});
