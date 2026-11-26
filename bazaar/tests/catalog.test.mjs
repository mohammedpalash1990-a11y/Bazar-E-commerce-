import test from 'node:test';
import assert from 'node:assert/strict';
import { MemStore } from '../public/shared/memstore.js';
import { handlers, defaultShop } from '../public/shared/handlers.js';

const NOW = Date.UTC(2026, 10, 26, 10);
const owner = { uid: 'u1', email: 'o@x.test', role: 'owner', shopId: 'main' };
const customer = { name: 'Rahim', phone: '01712345678', address: 'House 1, Road 2', district: 'Dhaka' };
const PIC = 'data:image/webp;base64,AAAA';

function seed() {
  const s = new MemStore();
  s._col('shops').main = defaultShop('main', 'Test', NOW);
  s._col('products').p1 = { shopId: 'main', name: 'Shirt', price: 1000, stock: 5, active: true, images: [PIC, PIC], thumb: PIC, description: 'x'.repeat(500), updatedAt: 42 };
  s._col('products').p2 = { shopId: 'main', name: 'Hidden', price: 10, stock: 1, active: false, images: [] };
  s._col('products').p3 = { shopId: 'other', name: 'Alien', price: 10, stock: 1, active: true, images: [] };
  return s;
}
const ctx = (extra = {}) => ({ now: NOW, user: owner, ...extra });

test('the snapshot lists only live products of this shop, without picture data', async () => {
  const s = seed();
  const r = await handlers.rebuildCatalog(s, ctx(), { shopId: 'main' });
  assert.equal(r.products, 1);
  const cat = await s.get('catalog', 'main');
  assert.equal(cat.prods.length, 1);
  const p = cat.prods[0];
  assert.equal(p.thumb, '/api/img/p1?v=42');
  assert.deepEqual(p.images, []);
  assert.equal(p.description.length, 160);
  assert.ok(JSON.stringify(cat).length < 2000);
});

test('demo mode keeps the picture inline because it has no image route', async () => {
  const s = seed();
  await handlers.rebuildCatalog(s, ctx({ inline: true }), { shopId: 'main' });
  assert.equal((await s.get('catalog', 'main')).prods[0].thumb, PIC);
});

test('only the shop manager can rebuild it', async () => {
  const s = seed();
  await assert.rejects(handlers.rebuildCatalog(s, ctx({ user: null }), { shopId: 'main' }), { code: 'auth_required' });
  await assert.rejects(handlers.rebuildCatalog(s, ctx({ user: { ...owner, shopId: 'other' } }), { shopId: 'main' }), { code: 'forbidden' });
});

test('an order and a cancellation keep the snapshot stock exact', async () => {
  const s = seed();
  await handlers.rebuildCatalog(s, ctx(), { shopId: 'main' });
  const r = await handlers.createOrder(s, { now: NOW, user: null }, { shopId: 'main', items: [{ productId: 'p1', qty: 2 }], customer });
  assert.equal((await s.get('catalog', 'main')).prods[0].stock, 3);
  assert.equal((await s.get('catalog', 'main')).prods[0].sold, 2);
  const o = await s.get('orders', r.id);
  o.status = 'confirmed'; s._col('orders')[r.id] = o;
  await handlers.adminUpdateOrder(s, ctx(), { id: r.id, action: 'status', status: 'cancelled' });
  assert.equal((await s.get('catalog', 'main')).prods[0].stock, 5);
  assert.equal((await s.get('products', 'p1')).stock, 5);
});

test('shops without a snapshot are not affected by orders', async () => {
  const s = seed();
  await handlers.createOrder(s, { now: NOW, user: null }, { shopId: 'main', items: [{ productId: 'p1', qty: 1 }], customer });
  assert.equal(await s.get('catalog', 'main'), null);
});
