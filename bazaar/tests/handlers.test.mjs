import test from 'node:test';
import assert from 'node:assert/strict';
import { MemStore } from '../public/shared/memstore.js';
import { handlers, defaultShop } from '../public/shared/handlers.js';
import { priceOrder, normalizePhone, canTransition } from '../public/shared/core.js';

const NOW = Date.UTC(2026, 10, 23, 10);
const ctx = (user = null) => ({ now: NOW, user });

function seed() {
  const s = new MemStore();
  s._col('shops').main = defaultShop('main', 'Test', NOW);
  s._col('shops').other = { ...defaultShop('other', 'Other', NOW) };
  s._col('products').p1 = { shopId: 'main', name: 'Shirt', price: 1000, salePrice: 800, stock: 5, active: true, images: [] };
  s._col('products').p2 = {
    shopId: 'main', name: 'Shoe', price: 2000, stock: 0, active: true, images: [],
    variants: [{ id: 'v1', label: '42', stock: 2 }, { id: 'v2', label: '43', price: 2500, stock: 1 }],
  };
  s._col('products').px = { shopId: 'other', name: 'Alien', price: 10, stock: 9, active: true };
  s._col('coupons').main_SAVE10 = { shopId: 'main', code: 'SAVE10', type: 'percent', value: 10, min: 500, maxDiscount: 100, active: true, used: 0, limit: 1 };
  return s;
}
const customer = { name: 'Rahim', phone: '+8801712345678', address: 'House 1, Road 2, Dhaka', district: 'Dhaka' };

test('server ignores client prices and charges DB price + delivery', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 2, price: 1 }], customer });
  assert.equal(r.total, 1600 + 60);
  const o = await s.get('orders', r.id);
  assert.equal(o.customer.phone, '01712345678');
  assert.equal((await s.get('products', 'p1')).stock, 3);
});

test('stock cannot go negative, even across duplicate lines', async () => {
  const s = seed();
  await assert.rejects(
    handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 3 }, { productId: 'p1', qty: 3 }], customer }),
    { code: 'out_of_stock' },
  );
  assert.equal((await s.get('products', 'p1')).stock, 5);
});

test('variant price and stock are used', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p2', variantId: 'v2', qty: 1 }], customer });
  assert.equal(r.total, 2500 + 60);
  assert.equal((await s.get('products', 'p2')).variants[1].stock, 0);
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p2', variantId: 'v2', qty: 1 }], customer }), { code: 'out_of_stock' });
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p2', qty: 1 }], customer }), { code: 'variant_gone' });
});

test('products of another shop cannot be bought', async () => {
  const s = seed();
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'px', qty: 1 }], customer }), { code: 'product_gone' });
});

test('coupon: capped discount, single use, counted once', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 5 }], customer, couponCode: 'save10' });
  const o = await s.get('orders', r.id);
  assert.equal(o.discount, 100);
  assert.equal((await s.get('coupons', 'main_SAVE10')).used, 1);
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 0 + 0 }], customer }), { code: 'bad_qty' });
  s._col('products').p1.stock = 5;
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer, couponCode: 'SAVE10' }), { code: 'coupon_used_up' });
});

test('same idempotency key never creates two orders', async () => {
  const s = seed();
  const body = { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer, idempotencyKey: 'abcdefgh12345' };
  const a = await handlers.createOrder(s, ctx(), body);
  const b = await handlers.createOrder(s, ctx(), body);
  assert.equal(a.id, b.id);
  assert.equal(b.duplicate, true);
  assert.equal((await s.get('products', 'p1')).stock, 4);
});

test('suspended or expired shop refuses orders', async () => {
  const s = seed();
  s._col('shops').main.status = 'suspended';
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer }), { code: 'shop_suspended' });
  s._col('shops').main.status = 'active';
  s._col('shops').main.expiresAt = NOW - 1;
  await assert.rejects(handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer }), { code: 'shop_expired' });
});

test('manual bKash needs a number configured and a trx id', async () => {
  const s = seed();
  const base = { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer, payMethod: 'bkash' };
  await assert.rejects(handlers.createOrder(s, ctx(), { ...base, trxId: '8N7A6D5' }), { code: 'pay_method_off' });
  s._col('shops').main.pay.bkash = '01700000000';
  await assert.rejects(handlers.createOrder(s, ctx(), base), { code: 'bad_trx' });
  const r = await handlers.createOrder(s, ctx(), { ...base, trxId: '8N7A6D5' });
  assert.equal((await s.get('orders', r.id)).paid, 0);
});

test('tracking needs the matching phone', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer });
  const t = await handlers.trackOrder(s, ctx(), { no: r.no.toLowerCase(), phone: '01712345678' });
  assert.equal(t.status, 'pending');
  assert.equal(t.customer.phone, undefined);
  await assert.rejects(handlers.trackOrder(s, ctx(), { no: r.no, phone: '01799999999' }), { code: 'order_not_found' });
  await assert.rejects(handlers.trackOrder(s, ctx(), { no: 'BZ-NOPE', phone: '01712345678' }), { code: 'order_not_found' });
});

test('customer can cancel only while pending, stock returns once', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 2 }], customer });
  await handlers.customerCancel(s, ctx(), { no: r.no, phone: customer.phone });
  assert.equal((await s.get('products', 'p1')).stock, 5);
  await assert.rejects(handlers.customerCancel(s, ctx(), { no: r.no, phone: customer.phone }), { code: 'cannot_cancel' });
  assert.equal((await s.get('products', 'p1')).stock, 5);
});

test('admin: only own shop, valid transitions, COD collected on delivery, restock on cancel', async () => {
  const s = seed();
  const r = await handlers.createOrder(s, ctx(), { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer });
  const staff = { uid: 'u1', email: 'a@b.c', role: 'staff', shopId: 'main' };
  const stranger = { uid: 'u2', email: 'x@y.z', role: 'owner', shopId: 'other' };
  await assert.rejects(handlers.adminUpdateOrder(s, ctx(stranger), { id: r.id, action: 'status', status: 'confirmed' }), { code: 'forbidden' });
  await assert.rejects(handlers.adminUpdateOrder(s, ctx(null), { id: r.id, action: 'status', status: 'confirmed' }), { code: 'auth_required' });
  await assert.rejects(handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'status', status: 'delivered' }), { code: 'bad_transition' });
  await handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'status', status: 'confirmed' });
  await handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'payment', amount: 200, method: 'bkash' });
  await assert.rejects(handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'payment', amount: 99999 }), { code: 'over_payment' });
  await handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'status', status: 'shipped' });
  const done = await handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'status', status: 'delivered' });
  assert.equal(done.due, 0);
  assert.equal(done.paid, done.total);
  const back = await handlers.adminUpdateOrder(s, ctx(staff), { id: r.id, action: 'status', status: 'returned' });
  assert.equal(back.restocked, true);
  assert.equal((await s.get('products', 'p1')).stock, 5);
});

test('invite codes: single use, sets role; bootstrap needs the secret and only works once', async () => {
  const s = seed();
  s._col('invites').ABC123 = { shopId: 'main', role: 'owner', used: false, expiresAt: NOW + 1000 };
  const u = { uid: 'u9', email: 'o@o.o' };
  await assert.rejects(handlers.claimInvite(s, ctx(null), { code: 'abc123' }), { code: 'auth_required' });
  const got = await handlers.claimInvite(s, ctx(u), { code: 'abc123' });
  assert.equal(got.role, 'owner');
  assert.equal((await s.get('users', 'u9')).shopId, 'main');
  await assert.rejects(handlers.claimInvite(s, ctx(u), { code: 'abc123' }), { code: 'bad_invite' });

  const env = { BOOTSTRAP_TOKEN: 'secret-token' };
  await assert.rejects(handlers.bootstrap(s, ctx(u), { token: 'nope' }, env), { code: 'forbidden' });
  await handlers.bootstrap(s, ctx(u), { token: 'secret-token' }, env);
  assert.equal((await s.get('users', 'u9')).role, 'super');
  await assert.rejects(handlers.bootstrap(s, ctx({ uid: 'u10' }), { token: 'secret-token' }, env), { code: 'already_setup' });
  await assert.rejects(handlers.bootstrap(s, ctx(u), { token: 'x' }, {}), { code: 'forbidden' });
});

test('helpers', () => {
  assert.equal(normalizePhone('+880 1712-345678'), '01712345678');
  assert.equal(normalizePhone('1712345678'), '01712345678');
  assert.equal(canTransition('delivered', 'pending'), false);
  const shop = { id: 'm', delivery: { freeAbove: 500, outsideFee: 100 } };
  const out = priceOrder({ items: [{ productId: 'a', qty: 1 }], products: { a: { shopId: 'm', name: 'A', price: 600, stock: 3 } }, shop, district: 'X' });
  assert.equal(out.delivery, 0);
});

import { productUnitPrice as _pup } from '../public/shared/core.js';
test('sale price stops after saleEnds', () => {
  const p = { price: 100, salePrice: 80, saleEnds: 1000 };
  assert.equal(_pup(p, null, 999), 80);
  assert.equal(_pup(p, null, 1000), 100);
  assert.equal(_pup({ price: 100, salePrice: 80 }, null, 5e12), 80);
});
