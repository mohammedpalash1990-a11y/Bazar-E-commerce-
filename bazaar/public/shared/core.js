// Pure business rules shared by the Cloudflare Worker and the offline demo server.
// No I/O here: everything takes plain data and returns plain data.

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];

const FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned', 'cancelled'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
// Statuses that give stock back to the shelf.
export const RESTOCK_STATUSES = new Set(['cancelled', 'returned']);

export function canTransition(from, to) {
  return (FLOW[from] || []).includes(to);
}

export function nextStatuses(from) {
  return FLOW[from] || [];
}

export function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function str(v, max = 200) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// Accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX and returns 01XXXXXXXXX.
// Other countries: digits only, 7–15 long.
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  d = d.replace(/^\+?880/, '0');
  d = d.replace(/\D/g, '');
  if (/^1[3-9]\d{8}$/.test(d)) d = '0' + d;
  return d;
}

export function isValidPhone(p) {
  return /^01[3-9]\d{8}$/.test(p) || /^\d{7,15}$/.test(p);
}

export function validateCustomer(c) {
  const out = {
    name: str(c?.name, 80),
    phone: normalizePhone(c?.phone),
    address: str(c?.address, 300),
    district: str(c?.district, 60),
    note: str(c?.note, 300),
    email: str(c?.email, 120),
  };
  if (out.name.length < 2) throw new AppError('bad_name', 'Name is required');
  if (!isValidPhone(out.phone)) throw new AppError('bad_phone', 'Enter a valid phone number');
  if (out.address.length < 6) throw new AppError('bad_address', 'Full address is required');
  return out;
}

export function productUnitPrice(product, variant) {
  const vPrice = Number(variant?.price) || 0;
  const base = vPrice > 0 ? vPrice : Number(product.price) || 0;
  // A variant with its own price only uses its own sale price, never the product's.
  const sale = Number(variant?.salePrice) > 0 ? Number(variant.salePrice) : vPrice > 0 ? 0 : Number(product.salePrice) || 0;
  return money(sale > 0 && sale < base ? sale : base);
}

export function availableStock(product, variant) {
  if (product.trackStock === false) return Infinity;
  const s = variant ? Number(variant.stock) : Number(product.stock);
  return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
}

export function deliveryFee(shop, district, subtotalAfterDiscount) {
  const d = shop?.delivery || {};
  const free = Number(d.freeAbove) || 0;
  if (free > 0 && subtotalAfterDiscount >= free) return 0;
  const inside = String(d.insideDistrict || '').toLowerCase();
  const isInside = inside && String(district || '').toLowerCase() === inside;
  return money(isInside ? Number(d.insideFee) || 0 : Number(d.outsideFee) || 0);
}

export function couponDiscount(coupon, subtotal, now = Date.now()) {
  if (!coupon) return 0;
  if (!coupon.active) throw new AppError('coupon_inactive', 'This coupon is not active');
  if (coupon.expiresAt && Number(coupon.expiresAt) < now) throw new AppError('coupon_expired', 'This coupon has expired');
  if (coupon.limit > 0 && coupon.used >= coupon.limit) throw new AppError('coupon_used_up', 'This coupon has been fully used');
  if (coupon.min > 0 && subtotal < coupon.min) throw new AppError('coupon_min', `Minimum order for this coupon is ${coupon.min}`);
  let d = coupon.type === 'percent' ? subtotal * (Number(coupon.value) / 100) : Number(coupon.value);
  if (coupon.type === 'percent' && coupon.maxDiscount > 0) d = Math.min(d, coupon.maxDiscount);
  return money(Math.min(Math.max(d, 0), subtotal));
}

// items: [{productId, variantId?, qty}]  products: Map|object by id  -> priced lines
export function priceOrder({ items, products, shop, coupon, district, now = Date.now() }) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError('empty_cart', 'Cart is empty');
  if (items.length > 40) throw new AppError('too_many_lines', 'Too many items in one order');
  const get = (id) => (products instanceof Map ? products.get(id) : products[id]);
  const wanted = new Map(); // productId|variantId -> qty (merge duplicates so stock is checked once)
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (!it.productId || !(qty >= 1 && qty <= 99)) throw new AppError('bad_qty', 'Invalid quantity');
    const key = `${it.productId}|${it.variantId || ''}`;
    wanted.set(key, (wanted.get(key) || 0) + qty);
  }
  const lines = [];
  for (const [key, qty] of wanted) {
    const [productId, variantId] = key.split('|');
    const p = get(productId);
    if (!p || p.shopId !== shop.id || p.active === false) throw new AppError('product_gone', 'An item is no longer available', 409);
    let variant = null;
    if (Array.isArray(p.variants) && p.variants.length) {
      variant = p.variants.find((v) => v.id === variantId);
      if (!variant) throw new AppError('variant_gone', `Choose an option for ${p.name}`, 409);
    }
    const stock = availableStock(p, variant);
    if (qty > stock) throw new AppError('out_of_stock', `Only ${stock} left of ${p.name}`, 409);
    const unit = productUnitPrice(p, variant);
    lines.push({
      productId, variantId: variant ? variant.id : '', name: p.name, nameBn: p.nameBn || '',
      variantLabel: variant ? variant.label : '', image: (p.images && p.images[0]) || '',
      unit, qty, total: money(unit * qty),
    });
  }
  const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
  const discount = couponDiscount(coupon, subtotal, now);
  const delivery = deliveryFee(shop, district, subtotal - discount);
  const total = money(subtotal - discount + delivery);
  return { lines, subtotal, discount, delivery, total };
}

export function newOrderNo(now = new Date(), rand = Math.random) {
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return `BZ-${ymd}-${s}`;
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function isShopOpen(shop, now = Date.now()) {
  if (!shop) return { ok: false, reason: 'not_found' };
  if (shop.status === 'suspended') return { ok: false, reason: 'suspended' };
  if (shop.expiresAt && Number(shop.expiresAt) < now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export function canManageShop(user, shopId) {
  if (!user) return false;
  if (user.role === 'super') return true;
  return (user.role === 'owner' || user.role === 'staff') && user.shopId === shopId;
}
