import test from 'node:test';
import assert from 'node:assert/strict';
import { MemStore } from '../public/shared/memstore.js';
import { handlers, defaultShop } from '../public/shared/handlers.js';

const NOW = Date.UTC(2026, 10, 26, 10);
const owner = { uid: 'u1', email: 'o@x.test', role: 'owner', shopId: 'main' };
const env = { STEADFAST_API_KEY: 'k', STEADFAST_SECRET_KEY: 's' };
const customer = { name: 'Rahim', phone: '01712345678', address: 'House 1, Road 2', district: 'Dhaka' };

async function setup(status = 'confirmed') {
  const s = new MemStore();
  s._col('shops').main = defaultShop('main', 'Test', NOW);
  s._col('products').p1 = { shopId: 'main', name: 'Shirt', price: 1000, stock: 5, active: true, images: [] };
  const r = await handlers.createOrder(s, { now: NOW, user: null }, { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer });
  const o = await s.get('orders', r.id);
  o.status = status;
  s._col('orders')[r.id] = o;
  return { s, id: r.id, no: o.no };
}
const fakeFetch = (calls, reply) => async (url, init) => { calls.push({ url, init }); return { ok: reply.ok !== false, json: async () => reply.body }; };
const okParcel = { ok: true, body: { status: 200, consignment: { consignment_id: 777, tracking_code: 'TRK123', status: 'in_review' } } };

test('booking sends the parcel, saves the tracking code and moves the order to shipped', async () => {
  const { s, id, no } = await setup();
  const calls = [];
  const o = await handlers.bookCourier(s, { now: NOW, user: owner, fetch: fakeFetch(calls, okParcel) }, { id }, env);
  assert.equal(o.status, 'shipped');
  assert.equal(o.courier.trackingId, 'TRK123');
  assert.equal(o.courier.consignmentId, '777');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.invoice, no);
  assert.equal(sent.cod_amount, o.due);
  assert.equal(calls[0].init.headers['Api-Key'], 'k');
  assert.match(calls[0].url, /\/create_order$/);
});

test('a parcel cannot be booked twice, and secrets must be configured', async () => {
  const { s, id } = await setup();
  const calls = [];
  const c = { now: NOW, user: owner, fetch: fakeFetch(calls, okParcel) };
  await assert.rejects(handlers.bookCourier(s, c, { id }, {}), { code: 'courier_not_set' });
  assert.equal(calls.length, 0);
  await handlers.bookCourier(s, c, { id }, env);
  await assert.rejects(handlers.bookCourier(s, c, { id }, env), { code: 'courier_booked' });
  assert.equal(calls.length, 1);
});

test('only managers of the shop can book, and only confirmed orders', async () => {
  const { s, id } = await setup();
  const c = { now: NOW, fetch: fakeFetch([], okParcel) };
  await assert.rejects(handlers.bookCourier(s, { ...c, user: null }, { id }, env), { code: 'auth_required' });
  await assert.rejects(handlers.bookCourier(s, { ...c, user: { ...owner, shopId: 'other' } }, { id }, env), { code: 'forbidden' });
  const p = await setup('pending');
  await assert.rejects(handlers.bookCourier(p.s, { ...c, user: owner }, { id: p.id }, env), { code: 'bad_status' });
});

test('a courier failure leaves the order unshipped and can be retried', async () => {
  const { s, id } = await setup();
  const bad = { now: NOW, user: owner, fetch: fakeFetch([], { ok: false, body: { message: 'Invalid credentials' } }) };
  await assert.rejects(handlers.bookCourier(s, bad, { id }, env), { code: 'courier_error' });
  const o = await s.get('orders', id);
  assert.equal(o.status, 'confirmed');
  assert.equal(o.courier.state, 'failed');
  const ok = await handlers.bookCourier(s, { now: NOW, user: owner, fetch: fakeFetch([], okParcel) }, { id }, env);
  assert.equal(ok.status, 'shipped');
});

test('webhook needs the token, updates status, and ignores repeats and strangers', async () => {
  const { s, id, no } = await setup();
  await handlers.bookCourier(s, { now: NOW, user: owner, fetch: fakeFetch([], okParcel) }, { id }, env);
  const body = { consignment_id: 777, invoice: no, status: 'delivered', updated_at: new Date(NOW + 5000).toISOString() };
  await assert.rejects(handlers.courierWebhook(s, { now: NOW + 5000, webhook: false }, body), { code: 'forbidden' });
  await handlers.courierWebhook(s, { now: NOW + 5000, webhook: true }, body);
  let o = await s.get('orders', id);
  assert.equal(o.status, 'delivered');
  assert.equal(o.due, 0);
  assert.equal(o.courier.status, 'delivered');
  const again = await handlers.courierWebhook(s, { now: NOW + 6000, webhook: true }, body);
  assert.equal(again.duplicate, true);
  const stranger = await handlers.courierWebhook(s, { now: NOW, webhook: true }, { invoice: 'NOPE', status: 'delivered' });
  assert.equal(stranger.ignored, true);
  const wrongParcel = await handlers.courierWebhook(s, { now: NOW, webhook: true }, { ...body, consignment_id: 1, status: 'cancelled' });
  assert.equal(wrongParcel.ignored, true);
  o = await s.get('orders', id);
  assert.equal(o.status, 'delivered');
});

test('other courier states are recorded but do not change the order status', async () => {
  const { s, id, no } = await setup();
  await handlers.bookCourier(s, { now: NOW, user: owner, fetch: fakeFetch([], okParcel) }, { id }, env);
  await handlers.courierWebhook(s, { now: NOW + 1, webhook: true }, { consignment_id: '777', invoice: no, status: 'cancelled', updated_at: new Date(NOW + 1000).toISOString() });
  const o = await s.get('orders', id);
  assert.equal(o.status, 'shipped');
  assert.equal(o.courier.status, 'cancelled');
});

test('delivery record lookup returns the courier counts', async () => {
  const { s, id } = await setup();
  const calls = [];
  const r = await handlers.courierFraud(s, { now: NOW, user: owner, fetch: fakeFetch(calls, { ok: true, body: { total_parcels: 9, total_delivered: 7, total_cancelled: 2, total_fraud_reports: 0 } }) }, { id }, env);
  assert.deepEqual(r, { parcels: 9, delivered: 7, cancelled: 2, reports: 0 });
  assert.match(calls[0].url, /\/fraud_check\/01712345678$/);
});

test('public tracking exposes the tracking code and status but not internal courier fields', async () => {
  const { s, id, no } = await setup();
  await handlers.bookCourier(s, { now: NOW, user: owner, fetch: fakeFetch([], okParcel) }, { id }, env);
  const pub = await handlers.trackOrder(s, { now: NOW, user: null }, { no, phone: customer.phone });
  assert.deepEqual(Object.keys(pub.courier).sort(), ['name', 'status', 'trackingId']);
});
