// Server-side use cases. They run inside the Cloudflare Worker (real Firestore) and inside the
// offline demo server (localStorage) through the same tiny store interface:
//
//   store.get(col, id)                    -> doc | null
//   store.query(col, [[field, '==', v]], limit) -> doc[]
//   store.begin()                         -> tx { get(col,id), set(col,id,data), commit() }
//
// Every doc returned carries its `id`. Writes are buffered by tx and applied atomically on commit.
import {
  AppError, priceOrder, validateCustomer, isShopOpen, canManageShop, canTransition,
  RESTOCK_STATUSES, money, str, newOrderNo, normalizePhone, ORDER_STATUSES,
} from './core.js';

const PAY_METHODS = ['cod', 'bkash', 'nagad'];

function randId(len = 20) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => a[x % a.length]).join('');
}

const couponKey = (shopId, code) => `${shopId}_${String(code).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')}`;

async function loadShop(store, shopId, now) {
  const shop = await store.get('shops', str(shopId, 60));
  const open = isShopOpen(shop, now);
  if (!open.ok) throw new AppError(`shop_${open.reason}`, 'This shop is not accepting orders right now', open.reason === 'not_found' ? 404 : 403);
  return shop;
}

export async function previewCoupon(store, ctx, body) {
  const shop = await loadShop(store, body.shopId, ctx.now);
  const ids = [...new Set((body.items || []).map((i) => str(i.productId, 80)))];
  const products = new Map();
  for (const id of ids) products.set(id, await store.get('products', id));
  let coupon = null;
  if (body.couponCode) {
    coupon = await store.get('coupons', couponKey(shop.id, body.couponCode));
    if (!coupon || coupon.shopId !== shop.id) throw new AppError('coupon_unknown', 'Coupon code not found', 404);
  }
  const priced = priceOrder({ items: body.items, products, shop, coupon, district: str(body.district, 60), now: ctx.now });
  return { subtotal: priced.subtotal, discount: priced.discount, delivery: priced.delivery, total: priced.total };
}

export async function createOrder(store, ctx, body) {
  const shop = await loadShop(store, body.shopId, ctx.now);
  const customer = validateCustomer(body.customer);
  const payMethod = PAY_METHODS.includes(body.payMethod) ? body.payMethod : 'cod';
  const trxId = str(body.trxId, 40);
  if (payMethod !== 'cod' && trxId.length < 4) throw new AppError('bad_trx', 'Enter the transaction ID of your payment');
  if (payMethod !== 'cod' && !shop.pay?.[payMethod]) throw new AppError('pay_method_off', 'This payment method is not available');
  const key = str(body.idempotencyKey, 40).replace(/[^a-zA-Z0-9_-]/g, '');
  const orderId = key.length >= 8 ? `k_${shop.id}_${key}` : `o_${randId()}`;

  const tx = await store.begin();
  const existing = await tx.get('orders', orderId);
  if (existing) return { id: existing.id, no: existing.no, total: existing.total, duplicate: true };

  const ids = [...new Set((body.items || []).map((i) => str(i.productId, 80)))];
  const products = new Map();
  for (const id of ids) products.set(id, await tx.get('products', id));
  let coupon = null;
  if (body.couponCode) {
    coupon = await tx.get('coupons', couponKey(shop.id, body.couponCode));
    if (!coupon || coupon.shopId !== shop.id) throw new AppError('coupon_unknown', 'Coupon code not found', 404);
  }
  const priced = priceOrder({ items: body.items, products, shop, coupon, district: customer.district, now: ctx.now });

  for (const line of priced.lines) {
    const p = products.get(line.productId);
    if (p.trackStock === false) continue;
    if (line.variantId) {
      const variants = p.variants.map((v) => (v.id === line.variantId ? { ...v, stock: Number(v.stock) - line.qty } : v));
      p.variants = variants;
      p.sold = (Number(p.sold) || 0) + line.qty;
    } else {
      p.stock = Number(p.stock) - line.qty;
      p.sold = (Number(p.sold) || 0) + line.qty;
    }
    tx.set('products', p.id, p);
  }
  if (coupon) tx.set('coupons', coupon.id, { ...coupon, used: (Number(coupon.used) || 0) + 1 });

  const now = ctx.now;
  const no = newOrderNo(new Date(now));
  const order = {
    shopId: shop.id, no, uid: ctx.user?.uid || '',
    items: priced.lines, subtotal: priced.subtotal, discount: priced.discount, delivery: priced.delivery, total: priced.total,
    couponCode: coupon ? coupon.code : '',
    customer, payMethod, trxId, paid: 0, due: priced.total, payments: [],
    status: 'pending', courier: { name: '', trackingId: '' }, restocked: false,
    history: [{ at: now, by: 'customer', type: 'created', text: 'Order placed' }],
    createdAt: now, updatedAt: now,
  };
  tx.set('orders', orderId, order);

  const cKey = `${shop.id}_${customer.phone}`;
  const c = (await tx.get('customers', cKey)) || { shopId: shop.id, phone: customer.phone, orders: 0, spent: 0, createdAt: now };
  tx.set('customers', cKey, {
    ...c, name: customer.name, address: customer.address, district: customer.district,
    orders: (Number(c.orders) || 0) + 1, spent: money((Number(c.spent) || 0) + priced.total), lastOrderAt: now,
  });
  await tx.commit();
  return { id: orderId, no, total: priced.total };
}

function publicOrder(o) {
  return {
    id: o.id, no: o.no, status: o.status, items: o.items, subtotal: o.subtotal, discount: o.discount,
    delivery: o.delivery, total: o.total, paid: o.paid, due: o.due, payMethod: o.payMethod,
    courier: o.courier ? { name: o.courier.name, trackingId: o.courier.trackingId, status: o.courier.status || '' } : o.courier, createdAt: o.createdAt, customer: { name: o.customer?.name, district: o.customer?.district },
    history: (o.history || []).filter((h) => h.type === 'status' || h.type === 'created').map((h) => ({ at: h.at, text: h.text })),
  };
}

async function findOrderByNo(store, no, phone) {
  const n = str(no, 30).toUpperCase();
  const [o] = await store.query('orders', [['no', '==', n]], 1);
  // Same answer for "no such order" and "wrong phone" so order numbers can't be probed.
  if (!o || normalizePhone(phone) !== o.customer?.phone) throw new AppError('order_not_found', 'No order matches that number and phone', 404);
  return o;
}

export async function trackOrder(store, ctx, body) {
  return publicOrder(await findOrderByNo(store, body.no, body.phone));
}

async function restock(tx, order) {
  if (order.restocked) return;
  for (const line of order.items) {
    const p = await tx.get('products', line.productId);
    if (!p || p.trackStock === false) continue;
    if (line.variantId && Array.isArray(p.variants)) {
      p.variants = p.variants.map((v) => (v.id === line.variantId ? { ...v, stock: Number(v.stock) + line.qty } : v));
    } else {
      p.stock = Number(p.stock) + line.qty;
    }
    p.sold = Math.max(0, (Number(p.sold) || 0) - line.qty);
    tx.set('products', p.id, p);
  }
  order.restocked = true;
}

export async function customerCancel(store, ctx, body) {
  const found = await findOrderByNo(store, body.no, body.phone);
  const tx = await store.begin();
  const order = await tx.get('orders', found.id);
  if (order.status !== 'pending') throw new AppError('cannot_cancel', 'This order is already being processed. Contact the shop to cancel.', 409);
  await restock(tx, order);
  order.status = 'cancelled';
  order.updatedAt = ctx.now;
  order.history = [...order.history, { at: ctx.now, by: 'customer', type: 'status', text: 'Cancelled by customer' }];
  tx.set('orders', order.id, order);
  await tx.commit();
  return publicOrder(order);
}

export async function adminUpdateOrder(store, ctx, body) {
  const user = ctx.user;
  if (!user) throw new AppError('auth_required', 'Sign in required', 401);
  const tx = await store.begin();
  const order = await tx.get('orders', str(body.id, 80));
  if (!order) throw new AppError('order_not_found', 'Order not found', 404);
  if (!canManageShop(user, order.shopId)) throw new AppError('forbidden', 'You cannot manage this order', 403);
  const by = user.email || user.uid;
  const log = (type, text) => order.history.push({ at: ctx.now, by, type, text });

  switch (body.action) {
    case 'status': {
      const to = str(body.status, 20);
      if (!ORDER_STATUSES.includes(to)) throw new AppError('bad_status', 'Unknown status');
      if (!canTransition(order.status, to)) throw new AppError('bad_transition', `Cannot move from ${order.status} to ${to}`, 409);
      if (RESTOCK_STATUSES.has(to)) await restock(tx, order);
      order.status = to;
      if (to === 'delivered' && order.payMethod === 'cod' && order.due > 0) {
        order.payments.push({ at: ctx.now, amount: order.due, method: 'cod', note: 'Collected on delivery', by });
        order.paid = order.total;
        order.due = 0;
      }
      log('status', `Status: ${to}`);
      break;
    }
    case 'payment': {
      const amount = money(body.amount);
      if (!(amount > 0)) throw new AppError('bad_amount', 'Enter an amount above zero');
      if (amount > order.due) throw new AppError('over_payment', `Amount is more than the due ${order.due}`);
      order.payments.push({ at: ctx.now, amount, method: str(body.method, 20) || 'cash', note: str(body.note, 120), by });
      order.paid = money(order.paid + amount);
      order.due = money(order.total - order.paid);
      log('payment', `Payment received: ${amount}`);
      break;
    }
    case 'courier':
      order.courier = { name: str(body.name, 60), trackingId: str(body.trackingId, 60) };
      log('courier', `Courier: ${order.courier.name} ${order.courier.trackingId}`.trim());
      break;
    case 'note':
      log('note', str(body.text, 300));
      break;
    default:
      throw new AppError('bad_action', 'Unknown action');
  }
  order.updatedAt = ctx.now;
  tx.set('orders', order.id, order);
  await tx.commit();
  return order;
}

export async function claimInvite(store, ctx, body) {
  if (!ctx.user) throw new AppError('auth_required', 'Sign in required', 401);
  const code = str(body.code, 40).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const tx = await store.begin();
  const inv = await tx.get('invites', code);
  if (!inv || inv.used || (inv.expiresAt && inv.expiresAt < ctx.now)) throw new AppError('bad_invite', 'This invite code is invalid or already used', 404);
  if (!['owner', 'staff'].includes(inv.role)) throw new AppError('bad_invite', 'Invalid invite', 400);
  const shop = await tx.get('shops', inv.shopId);
  if (!shop) throw new AppError('bad_invite', 'Shop no longer exists', 404);
  const profile = (await tx.get('users', ctx.user.uid)) || { email: ctx.user.email, createdAt: ctx.now };
  if (profile.role === 'super') throw new AppError('forbidden', 'Super admin accounts cannot join a shop', 403);
  tx.set('users', ctx.user.uid, { ...profile, role: inv.role, shopId: inv.shopId });
  tx.set('invites', code, { ...inv, used: true, usedBy: ctx.user.uid, usedAt: ctx.now });
  await tx.commit();
  return { role: inv.role, shopId: inv.shopId, shopName: shop.name };
}

export function defaultShop(id, name, now) {
  return {
    name, slug: id, status: 'active', plan: 'standard', createdAt: now, expiresAt: 0,
    brand: { logo: '', tagline: '', primary: '#1B5E43', accent: '#C9A24B' },
    contact: { phone: '', whatsapp: '', email: '', address: '' },
    currency: '৳', delivery: { insideDistrict: 'Dhaka', insideFee: 60, outsideFee: 120, freeAbove: 3000 },
    pay: { bkash: '', nagad: '' },
    about: '', announcement: '',
  };
}

export async function bootstrap(store, ctx, body, env) {
  if (!ctx.user) throw new AppError('auth_required', 'Sign in required', 401);
  if (!env?.BOOTSTRAP_TOKEN || str(body.token, 200) !== env.BOOTSTRAP_TOKEN) throw new AppError('forbidden', 'Wrong setup token', 403);
  const existing = await store.query('users', [['role', '==', 'super']], 1);
  if (existing.length) throw new AppError('already_setup', 'A super admin already exists', 409);
  const tx = await store.begin();
  const profile = (await tx.get('users', ctx.user.uid)) || { email: ctx.user.email, createdAt: ctx.now };
  tx.set('users', ctx.user.uid, { ...profile, role: 'super', shopId: '' });
  if (!(await tx.get('shops', 'main'))) tx.set('shops', 'main', defaultShop('main', str(body.shopName, 60) || 'My Shop', ctx.now));
  await tx.commit();
  return { role: 'super' };
}

export async function removeStaff(store, ctx, body) {
  const user = ctx.user;
  if (!user) throw new AppError('auth_required', 'Sign in required', 401);
  const tx = await store.begin();
  const target = await tx.get('users', str(body.uid, 80));
  if (!target || target.role !== 'staff') throw new AppError('not_found', 'Staff member not found', 404);
  if (!canManageShop(user, target.shopId) || user.role === 'staff') throw new AppError('forbidden', 'Only the shop owner can remove staff', 403);
  tx.set('users', target.id, { ...target, role: 'customer', shopId: '' });
  await tx.commit();
  return { ok: true };
}

/* ---- newsletter and reviews */
const EMAIL_RE = /^[^\s@/\\]{1,64}@[^\s@/\\]{1,120}\.[A-Za-z]{2,24}$/;

// Browsers cannot write subscribers directly (rules forbid it), so every address is checked here first.
export async function subscribe(store, ctx, body) {
  const shop = await loadShop(store, body.shopId, ctx.now);
  const email = str(body.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AppError('bad_email', 'Enter a valid email address');
  const id = `${shop.id}_${email}`;
  const tx = await store.begin();
  if (!(await tx.get('subscribers', id))) {
    tx.set('subscribers', id, { shopId: shop.id, email, createdAt: ctx.now });
    await tx.commit();
  }
  return { ok: true };
}

// Only a real, delivered order can leave a review, and only for a product that was in it.
// The shown name is the first name on the order, so nobody can post under a made-up identity.
export async function submitReview(store, ctx, body) {
  const order = await findOrderByNo(store, body.no, body.phone);
  if (order.status !== 'delivered') throw new AppError('not_delivered', 'You can review a product after your order is delivered', 409);
  const productId = str(body.productId, 80);
  const line = (order.items || []).find((l) => l.productId === productId);
  if (!line) throw new AppError('not_in_order', 'That product is not in this order', 404);
  const rating = Math.round(Number(body.rating));
  if (!(rating >= 1 && rating <= 5)) throw new AppError('bad_rating', 'Choose between 1 and 5 stars');
  const id = `${order.shopId}_${order.no}_${productId}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const tx = await store.begin();
  if (await tx.get('reviews', id)) throw new AppError('already_reviewed', 'You have already reviewed this product for this order', 409);
  tx.set('reviews', id, {
    shopId: order.shopId, productId, productName: str(line.name, 140), orderNo: order.no,
    name: str(order.customer?.name, 60).split(/\s+/)[0] || 'Customer', rating, text: str(body.text, 600),
    status: 'pending', createdAt: ctx.now,
  });
  await tx.commit();
  return { ok: true };
}

const avg1 = (list) => (list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : 0);

// Owner decision on a review. The product's star average is recomputed from approved reviews only.
export async function adminReview(store, ctx, body) {
  const user = ctx.user;
  if (!user) throw new AppError('auth_required', 'Sign in required', 401);
  const status = { approve: 'approved', reject: 'rejected' }[body.action];
  if (!status) throw new AppError('bad_action', 'Unknown action');
  const tx = await store.begin();
  const r = await tx.get('reviews', str(body.id, 200));
  if (!r) throw new AppError('not_found', 'Review not found', 404);
  if (!canManageShop(user, r.shopId) || user.role === 'staff') throw new AppError('forbidden', 'Only the shop owner can approve reviews', 403);
  tx.set('reviews', r.id, { ...r, status, moderatedAt: ctx.now });
  const others = (await store.query('reviews', [['productId', '==', r.productId], ['status', '==', 'approved']])).filter((x) => x.id !== r.id && x.shopId === r.shopId);
  const counted = status === 'approved' ? [...others, r] : others;
  const p = await tx.get('products', r.productId);
  if (p && p.shopId === r.shopId) tx.set('products', p.id, { ...p, ratingAvg: avg1(counted), ratingCount: counted.length });
  await tx.commit();
  return { status, ratingAvg: avg1(counted), ratingCount: counted.length };
}

// Fallback for the admin order list: the Worker reads orders with the service account, after checking the caller manages that shop.
export async function adminListOrders(store, ctx, body) {
  const user = ctx.user;
  if (!user) throw new AppError('auth_required', 'Sign in required', 401);
  const shopId = str(body.shopId, 80);
  if (!shopId || !canManageShop(user, shopId)) throw new AppError('forbidden', 'You cannot manage this shop', 403);
  const rows = await store.query('orders', [['shopId', '==', shopId]]);
  return { orders: rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 300) };
}

/* ------------------------------------------------------------------ courier (Steadfast) */
const COURIER_BASE = 'https://portal.packzy.com/api/v1';

async function courierCall(ctx, env, path, init) {
  if (!env?.STEADFAST_API_KEY || !env?.STEADFAST_SECRET_KEY) throw new AppError('courier_not_set', 'Courier booking is not set up yet', 400);
  let res;
  try {
    res = await (ctx.fetch || fetch)(`${COURIER_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Api-Key': env.STEADFAST_API_KEY, 'Secret-Key': env.STEADFAST_SECRET_KEY },
    });
  } catch { throw new AppError('courier_unreachable', 'Could not reach the courier. Try again in a moment.', 502); }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new AppError('courier_error', str(json?.message, 160) || 'The courier refused this request', 502);
  return json;
}

async function manageableOrder(store, ctx, id) {
  if (!ctx.user) throw new AppError('auth_required', 'Sign in required', 401);
  const tx = await store.begin();
  const order = await tx.get('orders', str(id, 80));
  if (!order) throw new AppError('order_not_found', 'Order not found', 404);
  if (!canManageShop(ctx.user, order.shopId)) throw new AppError('forbidden', 'You cannot manage this order', 403);
  return { tx, order };
}

// "Send to courier": the Worker books the parcel, then saves the tracking code and moves the order to Shipped.
// A short "sending" lock stops a double click from booking the same parcel twice.
export async function bookCourier(store, ctx, body, env) {
  const { tx, order } = await manageableOrder(store, ctx, body.id);
  if (order.courier?.consignmentId) throw new AppError('courier_booked', 'This order is already with the courier', 409);
  if (!['confirmed', 'processing'].includes(order.status)) throw new AppError('bad_status', 'Confirm the order before sending it to the courier', 409);
  if (order.courier?.state === 'sending' && ctx.now - (order.courier.sendingAt || 0) < 60000) throw new AppError('courier_busy', 'Booking is already in progress. Wait a minute.', 409);
  if (!env?.STEADFAST_API_KEY || !env?.STEADFAST_SECRET_KEY) throw new AppError('courier_not_set', 'Courier booking is not set up yet', 400);

  order.courier = { ...(order.courier || { name: '', trackingId: '' }), state: 'sending', sendingAt: ctx.now };
  tx.set('orders', order.id, order);
  await tx.commit();

  let parcel;
  try {
    const json = await courierCall(ctx, env, '/create_order', {
      method: 'POST',
      body: JSON.stringify({
        invoice: order.no,
        recipient_name: order.customer.name,
        recipient_phone: order.customer.phone,
        recipient_address: `${order.customer.address}, ${order.customer.district}`.slice(0, 250),
        cod_amount: Math.max(0, Number(order.due) || 0),
        note: str(order.customer.note, 200),
      }),
    });
    parcel = json.consignment;
    if (!parcel?.consignment_id) throw new AppError('courier_error', str(json.message, 160) || 'The courier did not return a tracking code', 502);
  } catch (e) {
    const t2 = await store.begin();
    const o2 = await t2.get('orders', order.id);
    if (o2) { o2.courier = { ...o2.courier, state: 'failed' }; t2.set('orders', o2.id, o2); await t2.commit(); }
    throw e;
  }

  const t3 = await store.begin();
  const fresh = await t3.get('orders', order.id);
  const by = ctx.user.email || ctx.user.uid;
  fresh.courier = { name: 'Steadfast', trackingId: str(parcel.tracking_code, 60), consignmentId: String(parcel.consignment_id), status: str(parcel.status, 40), statusAt: ctx.now, bookedAt: ctx.now, state: 'booked' };
  fresh.history.push({ at: ctx.now, by, type: 'courier', text: `Courier: Steadfast ${fresh.courier.trackingId}`.trim() });
  if (canTransition(fresh.status, 'shipped')) { fresh.status = 'shipped'; fresh.history.push({ at: ctx.now, by, type: 'status', text: 'Status: shipped' }); }
  fresh.updatedAt = ctx.now;
  t3.set('orders', fresh.id, fresh);
  await t3.commit();
  return fresh;
}

// The customer's past delivery record with the courier, shown before you send a risky cash-on-delivery parcel.
export async function courierFraud(store, ctx, body, env) {
  const { order } = await manageableOrder(store, ctx, body.id);
  const phone = encodeURIComponent(order.customer.phone);
  const j = await courierCall(ctx, env, `/fraud_check/${phone}`, { method: 'GET' });
  return { parcels: Number(j.total_parcels) || 0, delivered: Number(j.total_delivered) || 0, cancelled: Number(j.total_cancelled) || 0, reports: Number(j.total_fraud_reports) || 0 };
}

// Steadfast calls this when a parcel changes state. The Worker checks the shared token (ctx.webhook) before this runs.
// Only "delivered" moves the order; every other state is recorded and left for the shop owner to decide.
export async function courierWebhook(store, ctx, body) {
  if (!ctx.webhook) throw new AppError('forbidden', 'Not allowed', 403);
  const invoice = str(body.invoice, 60), raw = str(body.status, 40);
  if (!invoice || !raw) throw new AppError('bad_request', 'invoice and status are required');
  const [hit] = await store.query('orders', [['no', '==', invoice]], 1);
  if (!hit) return { ok: true, ignored: true };
  const tx = await store.begin();
  const order = await tx.get('orders', hit.id);
  const c = order?.courier;
  if (!c?.consignmentId || (body.consignment_id != null && String(body.consignment_id) !== c.consignmentId)) return { ok: true, ignored: true };
  const stamp = Date.parse(body.updated_at) || 0;
  if (c.status === raw || (stamp && c.statusAt && stamp < c.statusAt)) return { ok: true, duplicate: true };
  order.courier = { ...c, status: raw, statusAt: stamp || ctx.now };
  order.history.push({ at: ctx.now, by: 'courier', type: 'courier', text: `Courier status: ${raw}` });
  if (raw === 'delivered' && canTransition(order.status, 'delivered')) {
    order.status = 'delivered';
    if (order.payMethod === 'cod' && order.due > 0) {
      order.payments.push({ at: ctx.now, amount: order.due, method: 'cod', note: 'Collected on delivery (courier)', by: 'courier' });
      order.paid = order.total;
      order.due = 0;
    }
    order.history.push({ at: ctx.now, by: 'courier', type: 'status', text: 'Status: delivered' });
  }
  order.updatedAt = ctx.now;
  tx.set('orders', order.id, order);
  await tx.commit();
  return { ok: true };
}

export const handlers = { previewCoupon, createOrder, trackOrder, customerCancel, adminUpdateOrder, claimInvite, bootstrap, removeStaff, subscribe, submitReview, adminReview, adminListOrders, bookCourier, courierFraud, courierWebhook };
// Which handlers need a signed-in user, enforced by both runtimes before dispatch.
export const NEEDS_AUTH = new Set(['adminUpdateOrder', 'claimInvite', 'bootstrap', 'removeStaff', 'adminReview', 'adminListOrders', 'bookCourier', 'courierFraud']);
