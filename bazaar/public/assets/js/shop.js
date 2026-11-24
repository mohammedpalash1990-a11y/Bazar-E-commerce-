import { CONFIG } from './config.js';
import { initBackend } from './backend.js';
import { t, getLang, setLang, pick } from './i18n.js';
import { ic } from './icons.js';
import { $, $$, esc, safeUrl, fmtMoney, fmtDate, fmtNum, toast, debounce, uid } from './util.js';
import { priceOrder, productUnitPrice, availableStock, deliveryFee, isShopOpen, normalizePhone, AppError } from '../../shared/core.js';

const DISTRICTS = ['Dhaka', 'Gazipur', 'Narayanganj', 'Narsingdi', 'Manikganj', 'Munshiganj', 'Tangail', 'Faridpur', 'Kishoreganj', 'Rajbari', 'Madaripur', 'Shariatpur', 'Gopalganj', 'Chattogram', "Cox's Bazar", 'Cumilla', 'Feni', 'Noakhali', 'Lakshmipur', 'Chandpur', 'Brahmanbaria', 'Khagrachhari', 'Rangamati', 'Bandarban', 'Rajshahi', 'Bogura', 'Pabna', 'Sirajganj', 'Natore', 'Naogaon', 'Joypurhat', 'Chapainawabganj', 'Khulna', 'Jashore', 'Satkhira', 'Bagerhat', 'Kushtia', 'Chuadanga', 'Meherpur', 'Magura', 'Narail', 'Jhenaidah', 'Barishal', 'Bhola', 'Patuakhali', 'Pirojpur', 'Jhalokati', 'Barguna', 'Sylhet', 'Moulvibazar', 'Habiganj', 'Sunamganj', 'Rangpur', 'Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Thakurgaon', 'Panchagarh', 'Mymensingh', 'Jamalpur', 'Netrokona', 'Sherpur'];
const PAGE = 24;
const S = { be: null, shop: null, cats: [], products: new Map(), cart: [], wish: new Set(), user: null, shown: PAGE };

const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const app = () => $('#app');
const sym = () => S.shop?.currency || '৳';
const money = (n) => fmtMoney(n, sym(), getLang());
const shopName = () => S.shop?.name || CONFIG.platformName;
const img = (src, alt = '') => `<img src="${esc(safeUrl(src))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
const pName = (p) => pick(p, 'name');
const stockOf = (p) => (p.trackStock === false ? Infinity : Array.isArray(p.variants) && p.variants.length ? p.variants.reduce((s, v) => s + Math.max(0, Number(v.stock) || 0), 0) : Math.max(0, Number(p.stock) || 0));

function shopIdFromUrl() {
  const m = location.pathname.match(/^\/s\/([a-z0-9-]+)/i);
  if (m) return m[1].toLowerCase();
  const q = new URLSearchParams(location.search).get('shop');
  if (q && /^[a-z0-9-]+$/i.test(q)) return q.toLowerCase();
  return CONFIG.mode === 'single' ? CONFIG.defaultShop : null;
}

async function cached(key, loader, ttl = 300000) {
  if (S.be.mode === 'demo') return loader();
  const hit = ls.get(key, null);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await loader();
  ls.set(key, { at: Date.now(), v });
  return v;
}

async function loadShopData(shopId) {
  const db = S.be.db;
  S.shop = await db.get('shops', shopId);
  if (!S.shop) return;
  const [cats, prods] = await Promise.all([
    cached(`bz_cats_${shopId}`, () => db.list('categories', { where: [['shopId', '==', shopId]] })),
    cached(`bz_prods_${shopId}`, () => db.list('products', { where: [['shopId', '==', shopId], ['active', '==', true]], limit: 500 })),
  ]);
  S.cats = cats.sort((a, b) => (a.order || 0) - (b.order || 0));
  S.products = new Map(prods.map((p) => [p.id, p]));
  S.cart = ls.get(`bz_cart_${shopId}`, []).filter((l) => S.products.has(l.productId));
  S.wish = new Set(ls.get(`bz_wish_${shopId}`, []));
  const b = S.shop.brand || {};
  if (/^#[0-9a-f]{6}$/i.test(b.primary || '')) document.documentElement.style.setProperty('--primary', b.primary);
  if (/^#[0-9a-f]{6}$/i.test(b.accent || '')) document.documentElement.style.setProperty('--accent', b.accent);
}

const saveCart = () => ls.set(`bz_cart_${S.shop.id}`, S.cart);
const saveWish = () => ls.set(`bz_wish_${S.shop.id}`, [...S.wish]);
const cartCount = () => S.cart.reduce((s, l) => s + l.qty, 0);

/* ---------------------------------------------------------------- shell */
function shell() {
  const sh = S.shop;
  const logo = sh?.brand?.logo ? `<img src="${esc(safeUrl(sh.brand.logo))}" alt="${esc(shopName())}">` : `<span>${esc(shopName())}</span>`;
  const home = CONFIG.mode === 'multi' && !sh ? '#/' : '#/';
  const multiBack = CONFIG.mode === 'multi' && sh ? `<a class="chip" href="/" style="font-size:13px;padding:5px 12px">${esc(t('All shops'))}</a>` : '';
  document.body.innerHTML = `
    ${S.be.mode === 'demo' ? `<div class="demo-bar">${esc(t('Demo mode: data stays in this browser.'))} <button data-act="reset-demo">${esc(t('Reset demo'))}</button> · <a href="/admin/" style="text-decoration:underline">${esc(t('Open admin'))}</a></div>` : ''}
    ${sh?.announcement ? `<div class="announce">${esc(sh.announcement)}</div>` : ''}
    <header class="hdr"><div class="wrap">
      <a class="logo" href="${home}" aria-label="${esc(shopName())}">${logo}</a>
      <form class="search" role="search" data-form="search">
        ${ic('search')}<input type="search" name="q" placeholder="${esc(t('Search products'))}" aria-label="${esc(t('Search products'))}" autocomplete="off">
      </form>
      <nav class="icons" aria-label="${esc(t('Main'))}">
        ${multiBack}
        <button class="ib lang" data-act="lang" aria-label="Language">${getLang() === 'bn' ? 'EN' : 'বাং'}</button>
        ${sh ? `<a class="ib" href="#/wishlist" aria-label="${esc(t('Wishlist'))}">${ic('heart')}<span class="n" id="wn" ${S.wish.size ? '' : 'hidden'}>${S.wish.size}</span></a>` : ''}
        <a class="ib" href="#/account" aria-label="${esc(t('Account'))}">${ic('user')}</a>
        ${sh ? `<button class="ib" data-act="cart" aria-label="${esc(t('Cart'))}">${ic('bag')}<span class="n" id="cn" ${cartCount() ? '' : 'hidden'}>${cartCount()}</span></button>` : ''}
      </nav>
    </div>
    <div class="catbar" id="catbar"></div></header>
    <main class="wrap" id="app"></main>
    <footer class="site"><div class="wrap">
      <div><h4>${esc(shopName())}</h4><p>${esc(sh?.about || '')}</p></div>
      <div><h4>${esc(t('Help'))}</h4><a href="#/track">${esc(t('Track order'))}</a><a href="#/about">${esc(t('About & contact'))}</a><a href="#/account">${esc(t('My account'))}</a></div>
      <div><h4>${esc(t('Contact'))}</h4>${sh?.contact?.phone ? `<a href="tel:${esc(sh.contact.phone)}">${esc(sh.contact.phone)}</a>` : ''}${sh?.contact?.email ? `<a href="mailto:${esc(sh.contact.email)}">${esc(sh.contact.email)}</a>` : ''}<span>${esc(sh?.contact?.address || '')}</span></div>
      <div class="copy">© ${new Date().getFullYear()} ${esc(shopName())}</div>
    </div></footer>
    ${sh?.contact?.whatsapp ? `<a class="wa" href="https://wa.me/${esc(String(sh.contact.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('wa')}</a>` : ''}
    <div class="drawer-bg" data-act="cart-close"></div>
    <aside class="drawer" id="drawer" aria-label="${esc(t('Cart'))}"></aside>`;
  renderCatbar();
  renderDrawer();
}

function renderCatbar() {
  const bar = $('#catbar');
  if (!bar) return;
  const cur = new URLSearchParams((location.hash.split('?')[1]) || '').get('cat');
  bar.innerHTML = S.cats.length ? `<div class="wrap"><a href="#/shop" class="${!cur && location.hash.startsWith('#/shop') ? 'on' : ''}">${esc(t('All'))}</a>${S.cats.map((c) => `<a href="#/shop?cat=${esc(c.slug)}" class="${cur === c.slug ? 'on' : ''}">${esc(pick(c, 'name'))}</a>`).join('')}</div>` : '';
}

function updateBadges() {
  const cn = $('#cn'), wn = $('#wn');
  if (cn) { cn.textContent = cartCount(); cn.hidden = !cartCount(); }
  if (wn) { wn.textContent = S.wish.size; wn.hidden = !S.wish.size; }
}

/* ---------------------------------------------------------------- cart */
function cartLines() {
  return S.cart.map((l) => {
    const p = S.products.get(l.productId);
    if (!p) return null;
    const v = l.variantId ? (p.variants || []).find((x) => x.id === l.variantId) : null;
    return { ...l, p, v, unit: productUnitPrice(p, v), max: availableStock(p, v) };
  }).filter(Boolean);
}

function addToCart(productId, variantId, qty) {
  const p = S.products.get(productId);
  const v = variantId ? (p.variants || []).find((x) => x.id === variantId) : null;
  const max = availableStock(p, v);
  const ex = S.cart.find((l) => l.productId === productId && (l.variantId || '') === (variantId || ''));
  const next = (ex ? ex.qty : 0) + qty;
  if (next > max) { toast(t('Only {n} in stock', { n: fmtNum(max, getLang()) }), 'err'); return false; }
  if (ex) ex.qty = next; else S.cart.push({ productId, variantId: variantId || '', qty });
  saveCart(); updateBadges(); renderDrawer();
  return true;
}

function renderDrawer() {
  const d = $('#drawer');
  if (!d) return;
  const lines = cartLines();
  const sub = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  d.innerHTML = `<header><h2>${esc(t('Your cart'))}</h2><button class="ib" data-act="cart-close" aria-label="${esc(t('Close'))}">${ic('x')}</button></header>
    <div class="lines">${lines.length ? lines.map((l, i) => `
      <div class="line"><a class="t" href="#/p/${esc(l.p.id)}" data-act="cart-close">${img(l.p.images?.[0], pName(l.p))}</a>
        <div><h4>${esc(pName(l.p))}</h4><div class="sub">${esc(l.v ? l.v.label : '')} ${money(l.unit)}</div>
          <div class="qty"><button data-act="q-" data-i="${i}" aria-label="−">−</button><span>${fmtNum(l.qty, getLang())}</span><button data-act="q+" data-i="${i}" aria-label="+">+</button></div>
          <button class="rm" data-act="rm" data-i="${i}">${esc(t('Remove'))}</button></div>
        <strong>${money(l.unit * l.qty)}</strong></div>`).join('') : `<div class="empty"><p>${esc(t('Your cart is empty'))}</p><a class="btn" href="#/shop" data-act="cart-close">${esc(t('Start shopping'))}</a></div>`}</div>
    ${lines.length ? `<footer><div class="row tot"><span>${esc(t('Subtotal'))}</span><span>${money(sub)}</span></div><p class="hint">${esc(t('Delivery and coupons are calculated at checkout'))}</p><a class="btn gold block" href="#/checkout" data-act="cart-close">${esc(t('Checkout'))}</a></footer>` : ''}`;
}

/* ---------------------------------------------------------------- cards */
function badgesFor(p) {
  const out = [];
  const unit = productUnitPrice(p, null);
  if (unit < Number(p.price)) out.push(`<span class="badge gold">−${fmtNum(Math.round((1 - unit / p.price) * 100), getLang())}%</span>`);
  if (stockOf(p) === 0) out.push(`<span class="badge danger">${esc(t('Sold out'))}</span>`);
  return out.join('');
}
const priceHtml = (p, big = false) => {
  const unit = productUnitPrice(p, null);
  return `<div class="price ${big ? 'lg' : ''}"><span>${money(unit)}</span>${unit < Number(p.price) ? `<s>${money(p.price)}</s>` : ''}</div>`;
};
const card = (p) => `<article class="card"><a href="#/p/${esc(p.id)}" aria-label="${esc(pName(p))}"><div class="ph">${img(p.images?.[0], pName(p))}<div class="tags">${badgesFor(p)}</div></div>
  <h3>${esc(pName(p))}</h3>${priceHtml(p)}</a>
  <button class="wish ${S.wish.has(p.id) ? 'on' : ''}" data-act="wish" data-id="${esc(p.id)}" aria-label="${esc(t('Wishlist'))}" aria-pressed="${S.wish.has(p.id)}">${ic('heart')}</button></article>`;

/* ---------------------------------------------------------------- pages */
const setTitle = (s) => { document.title = s ? `${s} · ${shopName()}` : shopName(); };
const notFound = () => `<div class="center"><h1>404</h1><p>${esc(t('We could not find that page.'))}</p><a class="btn" href="#/">${esc(t('Back to home'))}</a></div>`;

function pageHome() {
  setTitle('');
  const all = [...S.products.values()];
  const feat = all.filter((p) => p.featured && stockOf(p) > 0);
  const hero = (feat.length >= 3 ? feat : all).slice(0, 3);
  const news = [...all].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
  const sale = all.filter((p) => productUnitPrice(p, null) < Number(p.price)).slice(0, 4);
  return `<section class="hero"><div>
      <h1>${esc(S.shop.brand?.tagline || t('Good things, carefully chosen.'))}</h1>
      <p>${esc(S.shop.about || t('Order in a minute, pay when it arrives.'))}</p>
      <div class="cta"><a class="btn gold" href="#/shop">${esc(t('Shop now'))}</a><a class="btn ghost" href="#/track">${esc(t('Track order'))}</a></div></div>
    <div class="arches" aria-hidden="true">${hero.map((p) => `<div class="arch">${img(p.images?.[0], '')}</div>`).join('')}</div></section>
    <div class="trust">
      <div>${ic('truck')}${esc(t('Fast delivery'))}</div><div>${ic('shield')}${esc(t('Cash on delivery'))}</div>
      <div>${ic('refresh')}${esc(t('Easy returns'))}</div><div>${ic('phone')}${esc(t('Real human support'))}</div></div>
    ${S.cats.length ? `<section class="sec"><div class="sec-h"><h2>${esc(t('Shop by category'))}</h2></div><div class="chips">${S.cats.map((c) => `<a class="chip" href="#/shop?cat=${esc(c.slug)}">${esc(pick(c, 'name'))}</a>`).join('')}</div></section>` : ''}
    ${sale.length ? `<section class="sec"><div class="sec-h"><h2>${esc(t('On sale'))}</h2></div><div class="grid">${sale.map(card).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>${esc(t('New arrivals'))}</h2><a href="#/shop">${esc(t('See all'))}</a></div>
      ${news.length ? `<div class="grid">${news.map(card).join('')}</div>` : `<div class="empty"><p>${esc(t('No products yet. Add some from the admin panel.'))}</p></div>`}</section>`;
}

function query() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}
function setQuery(obj) {
  const q = query();
  for (const [k, v] of Object.entries(obj)) { if (v === '' || v == null) q.delete(k); else q.set(k, v); }
  S.shown = PAGE;
  location.hash = `#/shop${q.toString() ? `?${q}` : ''}`;
}

function pageShop() {
  const q = query();
  const cat = q.get('cat') || '', term = (q.get('q') || '').trim().toLowerCase(), sort = q.get('sort') || 'new';
  const min = Number(q.get('min')) || 0, max = Number(q.get('max')) || 0, inStock = q.get('stock') === '1';
  let items = [...S.products.values()].filter((p) => {
    if (cat && p.category !== cat) return false;
    if (term && !`${p.name} ${p.nameBn || ''} ${p.sku || ''}`.toLowerCase().includes(term)) return false;
    const u = productUnitPrice(p, null);
    if (min && u < min) return false;
    if (max && u > max) return false;
    return !(inStock && stockOf(p) === 0);
  });
  const by = { new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), low: (a, b) => productUnitPrice(a, null) - productUnitPrice(b, null), high: (a, b) => productUnitPrice(b, null) - productUnitPrice(a, null), pop: (a, b) => (b.sold || 0) - (a.sold || 0) };
  items.sort(by[sort] || by.new);
  const total = items.length;
  items = items.slice(0, S.shown);
  const catName = S.cats.find((c) => c.slug === cat);
  setTitle(catName ? pick(catName, 'name') : t('Shop'));
  return `<div class="sec-h" style="margin-top:32px"><h2>${esc(catName ? pick(catName, 'name') : term ? t('Results for "{q}"', { q: term }) : t('All products'))}</h2><span class="hint">${esc(t('{n} products', { n: fmtNum(total, getLang()) }))}</span></div>
    <form class="toolbar" data-form="filters">
      <select class="input" name="sort" aria-label="${esc(t('Sort'))}"><option value="new" ${sort === 'new' ? 'selected' : ''}>${esc(t('Newest'))}</option><option value="pop" ${sort === 'pop' ? 'selected' : ''}>${esc(t('Most popular'))}</option><option value="low" ${sort === 'low' ? 'selected' : ''}>${esc(t('Price: low to high'))}</option><option value="high" ${sort === 'high' ? 'selected' : ''}>${esc(t('Price: high to low'))}</option></select>
      <input class="input" style="width:110px;min-width:0" type="number" min="0" name="min" placeholder="${esc(t('Min price'))}" value="${min || ''}" aria-label="${esc(t('Min price'))}">
      <input class="input" style="width:110px;min-width:0" type="number" min="0" name="max" placeholder="${esc(t('Max price'))}" value="${max || ''}" aria-label="${esc(t('Max price'))}">
      <label class="chip ${inStock ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" name="stock" class="sr" ${inStock ? 'checked' : ''}>${esc(t('In stock only'))}</label>
      ${term ? `<button class="chip" type="button" data-act="clear-q">${esc(t('Clear search'))} ✕</button>` : ''}</form>
    ${items.length ? `<div class="grid">${items.map(card).join('')}</div>${total > items.length ? `<div style="text-align:center;margin-top:32px"><button class="btn ghost" data-act="more">${esc(t('Show more'))}</button></div>` : ''}`
      : `<div class="empty"><p>${esc(t('Nothing matches your filters.'))}</p><a class="btn ghost" href="#/shop">${esc(t('Clear filters'))}</a></div>`}`;
}

let pdp = { sel: {}, qty: 1, img: 0 };
function pickVariant(p) {
  if (!p.variants?.length) return null;
  const names = (p.options || []).map((o) => o.name);
  if (!names.every((n) => pdp.sel[n])) return null;
  return p.variants.find((v) => names.every((n) => (v.opts ? v.opts[n] === pdp.sel[n] : v.label === pdp.sel[n]))) || null;
}
function pagePdp(id) {
  const p = S.products.get(id);
  if (!p) return notFound();
  if (pdp.id !== id) pdp = { id, sel: {}, qty: 1, img: 0 };
  setTitle(pName(p));
  const v = pickVariant(p);
  const stock = v ? availableStock(p, v) : stockOf(p);
  const cat = S.cats.find((c) => c.slug === p.category);
  const imgs = p.images?.length ? p.images : [''];
  const unit = productUnitPrice(p, v);
  const related = [...S.products.values()].filter((x) => x.id !== id && x.category === p.category).slice(0, 4);
  const opts = (p.options || []).map((o) => `<div class="opt"><span class="lbl">${esc(o.name)}</span><div class="chips">${o.values.map((val) => {
    const out = p.variants.filter((x) => (x.opts ? x.opts[o.name] === val : x.label === val)).every((x) => availableStock(p, x) === 0);
    return `<button type="button" class="chip ${pdp.sel[o.name] === val ? 'on' : ''}" data-act="opt" data-name="${esc(o.name)}" data-val="${esc(val)}" ${out ? 'disabled' : ''}>${esc(val)}</button>`;
  }).join('')}</div></div>`).join('');
  const needOpt = p.variants?.length && !v;
  return `<div class="pdp"><div class="gal"><div class="main">${img(imgs[pdp.img] || imgs[0], pName(p))}</div>
      ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((s, i) => `<button class="${i === pdp.img ? 'on' : ''}" data-act="thumb" data-i="${i}" aria-label="${esc(t('Photo {n}', { n: i + 1 }))}">${img(s)}</button>`).join('')}</div>` : ''}</div>
    <div class="info"><div class="crumbs"><a href="#/">${esc(t('Home'))}</a> / ${cat ? `<a href="#/shop?cat=${esc(cat.slug)}">${esc(pick(cat, 'name'))}</a>` : `<a href="#/shop">${esc(t('Shop'))}</a>`}</div>
      <h1>${esc(pName(p))}</h1>
      <div class="price lg"><span>${money(unit)}</span>${unit < (v && Number(v.price) > 0 ? Number(v.price) : Number(p.price)) ? `<s>${money(v && Number(v.price) > 0 ? v.price : p.price)}</s>` : ''}</div>
      ${stock === 0 ? `<p class="stock-out">${esc(t('Sold out'))}</p>` : stock <= 5 && stock !== Infinity ? `<p class="stock-low">${esc(t('Only {n} left', { n: fmtNum(stock, getLang()) }))}</p>` : `<p class="hint">${esc(t('In stock'))}</p>`}
      ${opts}
      <div class="buy"><div class="qty"><button data-act="pq-" aria-label="−">−</button><span id="pq">${fmtNum(pdp.qty, getLang())}</span><button data-act="pq+" aria-label="+">+</button></div>
        <button class="btn" data-act="add" data-id="${esc(id)}" ${stock === 0 ? 'disabled' : ''}>${esc(needOpt ? t('Choose an option') : t('Add to cart'))}</button>
        <button class="btn gold" data-act="buy" data-id="${esc(id)}" ${stock === 0 ? 'disabled' : ''}>${esc(t('Buy now'))}</button>
        <button class="ib wish ${S.wish.has(id) ? 'on' : ''}" style="${S.wish.has(id) ? 'color:var(--danger)' : ''}" data-act="wish" data-id="${esc(id)}" aria-label="${esc(t('Wishlist'))}">${ic('heart')}</button></div>
      <p class="prose">${esc(pick(p, 'description'))}</p>
      <div class="facts"><div>${ic('truck')}${esc(t('Delivery across Bangladesh'))}</div><div>${ic('shield')}${esc(t('Pay cash when your order arrives'))}</div></div>
    </div></div>
    ${related.length ? `<section class="sec"><div class="sec-h"><h2>${esc(t('You may also like'))}</h2></div><div class="grid">${related.map(card).join('')}</div></section>` : ''}`;
}

/* ---- checkout */
let CO = { code: '', server: null, pay: 'cod' };
function localTotals(district) {
  const items = cartLines().map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty }));
  return priceOrder({ items, products: S.products, shop: S.shop, district });
}
function totalsNow(district) {
  if (CO.server) return { ...CO.server, lines: localTotals(district).lines };
  return localTotals(district);
}
function summaryHtml(district) {
  let tot;
  try { tot = totalsNow(district); } catch (e) { return `<p class="err">${esc(e.message)}</p>`; }
  return `${tot.lines.map((l) => `<div class="sum-line"><div class="t">${img(l.image)}</div><div>${esc(pick(l, 'name'))}<div class="hint">${esc(l.variantLabel)} × ${fmtNum(l.qty, getLang())}</div></div><strong>${money(l.total)}</strong></div>`).join('')}
    <div class="coupon"><input class="input" id="cpn" placeholder="${esc(t('Coupon code'))}" value="${esc(CO.code)}" aria-label="${esc(t('Coupon code'))}"><button class="btn ghost" type="button" data-act="coupon">${esc(CO.server ? t('Remove') : t('Apply'))}</button></div>
    <div class="row"><span>${esc(t('Subtotal'))}</span><span>${money(tot.subtotal)}</span></div>
    ${tot.discount ? `<div class="row" style="color:var(--ok)"><span>${esc(t('Discount'))}</span><span>−${money(tot.discount)}</span></div>` : ''}
    <div class="row"><span>${esc(t('Delivery'))}</span><span>${tot.delivery ? money(tot.delivery) : esc(t('Free'))}</span></div>
    <div class="row tot" style="margin-top:8px;padding-top:12px;border-top:1px solid var(--line)"><span>${esc(t('Total'))}</span><span>${money(tot.total)}</span></div>`;
}
function pageCheckout() {
  setTitle(t('Checkout'));
  if (!S.cart.length) return `<div class="center"><h1>${esc(t('Your cart is empty'))}</h1><a class="btn" href="#/shop">${esc(t('Start shopping'))}</a></div>`;
  const u = S.user || {};
  const pay = S.shop.pay || {};
  return `<form class="co" data-form="checkout" novalidate>
    <div class="box"><h2>${esc(t('Delivery details'))}</h2><div class="form">
      <div class="two"><div class="field"><label for="f-name">${esc(t('Full name'))}</label><input class="input" id="f-name" name="name" autocomplete="name" required value="${esc(u.name || '')}"></div>
        <div class="field"><label for="f-phone">${esc(t('Mobile number'))}</label><input class="input" id="f-phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required value="${esc(u.phone || '')}"></div></div>
      <div class="field"><label for="f-addr">${esc(t('Full address'))}</label><textarea class="input" id="f-addr" name="address" autocomplete="street-address" required placeholder="${esc(t('House, road, area'))}">${esc(u.address || '')}</textarea></div>
      <div class="field"><label for="f-dist">${esc(t('District'))}</label><input class="input" id="f-dist" name="district" list="dl" autocomplete="off" required value="${esc(u.district || S.shop.delivery?.insideDistrict || '')}"><datalist id="dl">${DISTRICTS.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
      <div class="field"><label for="f-note">${esc(t('Note for the shop (optional)'))}</label><input class="input" id="f-note" name="note" maxlength="300"></div>
      <div class="field"><span class="lbl">${esc(t('Payment'))}</span><div class="pay">
        <label><input type="radio" name="pay" value="cod" checked><span><b>${esc(t('Cash on delivery'))}</b><small>${esc(t('Pay when your order arrives'))}</small></span></label>
        ${['bkash', 'nagad'].filter((m) => pay[m]).map((m) => `<label><input type="radio" name="pay" value="${m}"><span><b>${m === 'bkash' ? 'bKash' : 'Nagad'}</b><small>${esc(t('Send money to {n}, then enter the transaction ID', { n: pay[m] }))}</small></span></label>`).join('')}</div></div>
      <div class="field" id="trx" hidden><label for="f-trx">${esc(t('Transaction ID'))}</label><input class="input" id="f-trx" name="trxId" maxlength="40" autocomplete="off"></div>
      ${CONFIG.turnstileSiteKey ? '<div id="ts"></div>' : ''}
      <p class="err" id="co-err" role="alert" hidden></p>
      <button class="btn gold block" type="submit" id="place">${esc(t('Place order'))}</button>
      <p class="hint">${esc(t('By placing the order you agree to be contacted on this number.'))}</p></div></div>
    <aside class="box sticky"><h2>${esc(t('Order summary'))}</h2><div id="sum">${summaryHtml(u.district || S.shop.delivery?.insideDistrict || '')}</div></aside></form>`;
}

async function applyCoupon() {
  const district = $('#f-dist')?.value || '';
  if (CO.server) { CO = { ...CO, code: '', server: null }; $('#sum').innerHTML = summaryHtml(district); return; }
  const code = $('#cpn').value.trim();
  if (!code) return;
  try {
    const items = cartLines().map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty }));
    CO.server = await S.be.api('previewCoupon', { shopId: S.shop.id, items, couponCode: code, district });
    CO.code = code;
    toast(t('Coupon applied'));
  } catch (e) { CO.server = null; toast(errText(e), 'err'); }
  $('#sum').innerHTML = summaryHtml(district);
}

const ERR = { bad_name: 'Enter your full name', bad_phone: 'Enter a valid mobile number', bad_address: 'Enter your full address', out_of_stock: null, rate_limited: 'Too many attempts. Please wait a minute.' };
function errText(e) { return e?.code && ERR[e.code] ? t(ERR[e.code]) : e?.message || t('Something went wrong. Please try again.'); }

let tsToken = '';
function mountTurnstile() {
  const box = $('#ts');
  if (!box || !CONFIG.turnstileSiteKey) return;
  const go = () => window.turnstile.render(box, { sitekey: CONFIG.turnstileSiteKey, callback: (tk) => { tsToken = tk; } });
  if (window.turnstile) return go();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.onload = go; document.head.append(s);
}

async function submitCheckout(form) {
  const fd = Object.fromEntries(new FormData(form));
  const err = $('#co-err'), btn = $('#place');
  err.hidden = true;
  if (!S.cart.length) return;
  btn.disabled = true; btn.textContent = t('Placing order…');
  const idem = sessionStorage.getItem('bz_idem') || uid(16);
  sessionStorage.setItem('bz_idem', idem);
  try {
    const items = cartLines().map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty }));
    const r = await S.be.api('createOrder', {
      shopId: S.shop.id, items, couponCode: CO.server ? CO.code : '', payMethod: fd.pay || 'cod', trxId: fd.trxId || '', idempotencyKey: idem, turnstile: tsToken,
      customer: { name: fd.name, phone: fd.phone, address: fd.address, district: fd.district, note: fd.note, email: S.user?.email || '' },
    });
    sessionStorage.removeItem('bz_idem');
    ls.set('bz_last', { no: r.no, phone: normalizePhone(fd.phone) });
    S.cart = []; saveCart(); updateBadges(); renderDrawer();
    CO = { code: '', server: null, pay: 'cod' };
    if (S.be.mode !== 'demo') localStorage.removeItem(`bz_prods_${S.shop.id}`);
    location.hash = `#/done/${encodeURIComponent(r.no)}`;
  } catch (e) {
    if (['out_of_stock', 'product_gone', 'variant_gone'].includes(e.code)) { localStorage.removeItem(`bz_prods_${S.shop.id}`); sessionStorage.removeItem('bz_idem'); }
    err.textContent = errText(e); err.hidden = false;
    btn.disabled = false; btn.textContent = t('Place order');
    if (window.turnstile) { window.turnstile.reset(); tsToken = ''; }
  }
}

function pageDone(no) {
  setTitle(t('Order placed'));
  const last = ls.get('bz_last', {});
  return `<div class="center"><div class="seal">${ic('check')}</div><h1>${esc(t('Thank you! Your order is placed.'))}</h1>
    <p>${esc(t('Your order number is'))} <strong style="font-size:20px">${esc(no)}</strong></p>
    <p class="hint">${esc(t('Save this number. You can track your order with it and your phone number.'))}</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center"><a class="btn" href="#/track?no=${encodeURIComponent(no)}&phone=${encodeURIComponent(last.phone || '')}">${esc(t('Track order'))}</a><a class="btn ghost" href="#/shop">${esc(t('Continue shopping'))}</a></div></div>`;
}

/* ---- tracking */
const STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
const statusLabel = (s) => t({ pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned' }[s] || s);
const statusKind = (s) => ({ pending: 'warn', confirmed: 'info', processing: 'info', shipped: 'info', delivered: 'ok', cancelled: 'danger', returned: 'danger' }[s] || '');
function orderCard(o) {
  return `<div class="box" style="margin-top:20px"><div class="row" style="flex-wrap:wrap"><div><h2 style="margin:0">${esc(o.no)}</h2><span class="hint">${esc(fmtDate(o.createdAt, getLang()))}</span></div><span class="badge ${statusKind(o.status)}">${esc(statusLabel(o.status))}</span></div>
    <ul class="timeline" style="padding:0;margin:20px 0 6px">${(o.history || []).map((h) => `<li><i></i><div>${esc(h.text)}<div class="time">${esc(fmtDate(h.at, getLang()))}</div></div></li>`).join('')}</ul>
    ${o.courier?.name ? `<p class="hint">${esc(t('Courier'))}: ${esc(o.courier.name)} ${esc(o.courier.trackingId)}</p>` : ''}
    <div style="margin-top:12px">${o.items.map((l) => `<div class="sum-line"><div class="t">${img(l.image)}</div><div>${esc(pick(l, 'name'))}<div class="hint">${esc(l.variantLabel)} × ${fmtNum(l.qty, getLang())}</div></div><strong>${money(l.total)}</strong></div>`).join('')}</div>
    <div class="row tot" style="margin-top:10px"><span>${esc(t('Total'))}</span><span>${money(o.total)}</span></div>
    ${o.due > 0 && o.status !== 'cancelled' ? `<div class="row"><span>${esc(t('Due on delivery'))}</span><span>${money(o.due)}</span></div>` : ''}
    ${o.status === 'pending' ? `<button class="btn ghost sm" style="margin-top:16px" data-act="cancel-order" data-no="${esc(o.no)}">${esc(t('Cancel order'))}</button>` : ''}</div>`;
}
function pageTrack() {
  setTitle(t('Track order'));
  const q = query(), last = ls.get('bz_last', {});
  return `<div style="max-width:620px;margin:40px auto"><h1 style="font-size:32px">${esc(t('Track your order'))}</h1>
    <form class="box form" style="margin-top:20px" data-form="track">
      <div class="field"><label for="t-no">${esc(t('Order number'))}</label><input class="input" id="t-no" name="no" placeholder="BZ-261123-ABCD" required value="${esc(q.get('no') || last.no || '')}"></div>
      <div class="field"><label for="t-ph">${esc(t('Mobile number'))}</label><input class="input" id="t-ph" name="phone" inputmode="tel" required value="${esc(q.get('phone') || last.phone || '')}"></div>
      <p class="err" id="t-err" role="alert" hidden></p><button class="btn" type="submit">${esc(t('Track'))}</button></form><div id="t-out"></div></div>`;
}
async function runTrack(form) {
  const fd = Object.fromEntries(new FormData(form));
  const out = $('#t-out'), err = $('#t-err');
  err.hidden = true;
  stopTrackPoll();
  try {
    const o = await S.be.api('trackOrder', { no: fd.no, phone: fd.phone, turnstile: tsToken });
    out.innerHTML = orderCard(o);
    startTrackPoll({ no: fd.no, phone: fd.phone }, o);
  } catch (e) { out.innerHTML = ''; err.textContent = errText(e); err.hidden = false; }
}

/* Live tracking for guests: they cannot read Firestore directly (rules keep orders private), so the page
   re-asks the Worker every few seconds while it is visible, and immediately when the tab wakes or the
   connection returns. Skipped when a bot check is configured, because its token is single-use. */
const TRACK_DONE = new Set(['delivered', 'cancelled', 'returned']);
let trackPoll = null;
const orderSig = (o) => `${o.status}|${(o.history || []).length}|${o.due}|${o.courier?.trackingId || ''}`;
function stopTrackPoll() {
  if (!trackPoll) return;
  clearInterval(trackPoll.timer);
  document.removeEventListener('visibilitychange', trackPoll.wake);
  window.removeEventListener('online', trackPoll.wake);
  trackPoll = null;
}
function startTrackPoll(args, first) {
  if (CONFIG.turnstileSiteKey || TRACK_DONE.has(first.status)) return;
  const st = { sig: orderSig(first), busy: false };
  const tick = async () => {
    if (trackPoll !== st || st.busy || document.hidden || navigator.onLine === false) return;
    const out = $('#t-out');
    if (!out || !location.hash.startsWith('#/track')) { stopTrackPoll(); return; }
    st.busy = true;
    try {
      const o = await S.be.api('trackOrder', { ...args, turnstile: '' });
      if (trackPoll !== st) return;
      const sig = orderSig(o);
      if (sig !== st.sig) { st.sig = sig; out.innerHTML = orderCard(o); if (!TRACK_DONE.has(o.status)) toast(t('Order status updated')); }
      if (TRACK_DONE.has(o.status)) stopTrackPoll();
    } catch { /* offline or busy: keep the last shown status and try again */ } finally { st.busy = false; }
  };
  st.wake = () => { if (!document.hidden) tick(); };
  st.timer = setInterval(tick, 8000);
  document.addEventListener('visibilitychange', st.wake);
  window.addEventListener('online', st.wake);
  trackPoll = st;
}

/* ---- account */
function pageWishlist() {
  setTitle(t('Wishlist'));
  const items = [...S.wish].map((id) => S.products.get(id)).filter(Boolean);
  return `<div class="sec-h" style="margin-top:32px"><h2>${esc(t('Wishlist'))}</h2></div>${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : `<div class="empty"><p>${esc(t('Tap the heart on a product to save it here.'))}</p><a class="btn" href="#/shop">${esc(t('Browse products'))}</a></div>`}`;
}

let acctTab = 'in';
function pageAccount() {
  setTitle(t('Account'));
  const u = S.user;
  if (!u) {
    return `<div style="max-width:460px;margin:48px auto"><div class="box"><div class="otab"><button class="${acctTab === 'in' ? 'on' : ''}" data-act="atab" data-tab="in">${esc(t('Sign in'))}</button><button class="${acctTab === 'up' ? 'on' : ''}" data-act="atab" data-tab="up">${esc(t('Create account'))}</button></div>
      <form class="form" data-form="auth" novalidate>
        ${acctTab === 'up' ? `<div class="field"><label for="a-name">${esc(t('Full name'))}</label><input class="input" id="a-name" name="name" autocomplete="name"></div>` : ''}
        <div class="field"><label for="a-email">${esc(t('Email'))}</label><input class="input" id="a-email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="a-pw">${esc(t('Password'))}</label><input class="input" id="a-pw" name="password" type="password" autocomplete="${acctTab === 'up' ? 'new-password' : 'current-password'}" minlength="6" required></div>
        <p class="err" id="a-err" role="alert" hidden></p><button class="btn" type="submit">${esc(acctTab === 'up' ? t('Create account') : t('Sign in'))}</button>
        ${acctTab === 'in' ? `<button class="btn ghost sm" type="button" data-act="forgot">${esc(t('Forgot password?'))}</button>` : ''}</form></div>
      <p class="hint" style="text-align:center;margin-top:16px">${esc(t('You can also order without an account.'))}</p></div>`;
  }
  const staff = ['owner', 'staff', 'super'].includes(u.role);
  return `<div class="co" style="grid-template-columns:1fr 1.3fr"><div class="box"><h2>${esc(t('My details'))}</h2><form class="form" data-form="profile">
      <p class="hint">${esc(u.email)}</p>
      <div class="field"><label for="p-name">${esc(t('Full name'))}</label><input class="input" id="p-name" name="name" value="${esc(u.name || '')}"></div>
      <div class="field"><label for="p-phone">${esc(t('Mobile number'))}</label><input class="input" id="p-phone" name="phone" inputmode="tel" value="${esc(u.phone || '')}"></div>
      <div class="field"><label for="p-addr">${esc(t('Full address'))}</label><textarea class="input" id="p-addr" name="address">${esc(u.address || '')}</textarea></div>
      <div class="field"><label for="p-dist">${esc(t('District'))}</label><input class="input" id="p-dist" name="district" list="dl2" value="${esc(u.district || '')}"><datalist id="dl2">${DISTRICTS.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
      <button class="btn" type="submit">${esc(t('Save'))}</button></form>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">${staff ? `<a class="btn gold sm" href="/admin/">${esc(t('Open admin'))}</a>` : ''}<button class="btn ghost sm" data-act="logout">${esc(t('Sign out'))}</button></div></div>
    <div class="box"><h2>${esc(t('My orders'))}</h2><div id="my-orders"><div class="skel" style="height:80px"></div></div></div></div>`;
}
async function loadMyOrders() {
  const box = $('#my-orders');
  if (!box || !S.user) return;
  try {
    const list = await S.be.db.list('orders', { where: [['uid', '==', S.user.uid]], orderBy: [['createdAt', 'desc']], limit: 30 });
    box.innerHTML = list.length ? list.filter((o) => o.shopId === S.shop.id).map((o) => `<div class="ord"><div><strong>${esc(o.no)}</strong><div class="hint">${esc(fmtDate(o.createdAt, getLang()))}</div></div><span class="badge ${statusKind(o.status)}">${esc(statusLabel(o.status))}</span><strong>${money(o.total)}</strong><a class="btn ghost sm" href="#/track?no=${encodeURIComponent(o.no)}&phone=${encodeURIComponent(o.customer?.phone || '')}">${esc(t('Track'))}</a></div>`).join('') || `<p class="hint">${esc(t('No orders yet.'))}</p>` : `<p class="hint">${esc(t('No orders yet.'))}</p>`;
  } catch { box.innerHTML = `<p class="hint">${esc(t('No orders yet.'))}</p>`; }
}

function pageAbout() {
  setTitle(t('About & contact'));
  const c = S.shop.contact || {}, d = S.shop.delivery || {};
  return `<div style="max-width:720px;margin:40px auto"><h1 style="font-size:34px">${esc(shopName())}</h1><p class="prose" style="margin:16px 0">${esc(S.shop.about || '')}</p>
    <div class="box"><h2>${esc(t('Contact'))}</h2><p>${esc(c.phone || '')}</p><p>${esc(c.email || '')}</p><p>${esc(c.address || '')}</p></div>
    <div class="box" style="margin-top:18px"><h2>${esc(t('Delivery'))}</h2><p>${esc(t('Inside {d}', { d: d.insideDistrict || '' }))}: ${money(d.insideFee || 0)}</p><p>${esc(t('Outside {d}', { d: d.insideDistrict || '' }))}: ${money(d.outsideFee || 0)}</p>${d.freeAbove ? `<p>${esc(t('Free delivery above {n}', { n: money(d.freeAbove) }))}</p>` : ''}</div></div>`;
}

async function pageDirectory() {
  document.title = CONFIG.platformName;
  const shops = (await S.be.db.list('shops')).filter((s) => isShopOpen(s, Date.now()).ok);
  return `<section class="hero" style="grid-template-columns:1fr"><div><h1>${esc(CONFIG.platformName)}</h1><p>${esc(t('Pick a shop to start browsing.'))}</p></div></section>
    <div class="shops">${shops.map((s) => `<a class="shopcard" href="/s/${esc(s.id)}/">${s.brand?.logo ? `<img src="${esc(safeUrl(s.brand.logo))}" alt="">` : ''}<h3>${esc(s.name)}</h3><p class="hint">${esc(s.brand?.tagline || s.about || '')}</p></a>`).join('') || `<div class="empty"><p>${esc(t('No shops yet.'))}</p></div>`}</div>`;
}

const closedPage = (reason) => `<div class="center"><h1>${esc(shopName())}</h1><p>${esc(reason === 'not_found' ? t('This shop does not exist.') : t('This shop is closed for now. Please check back later.'))}</p></div>`;

/* ---------------------------------------------------------------- router */
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path] = hash.split('?');
  const seg = path.split('/').filter(Boolean);
  const el = app();
  if (!S.shop) { el.innerHTML = closedPage('not_found'); return; }
  const open = isShopOpen(S.shop, Date.now());
  if (!open.ok) { el.innerHTML = closedPage(open.reason); return; }
  let html;
  switch (seg[0]) {
    case undefined: html = pageHome(); break;
    case 'shop': html = pageShop(); break;
    case 'p': html = pagePdp(decodeURIComponent(seg[1] || '')); break;
    case 'checkout': html = pageCheckout(); break;
    case 'done': html = pageDone(decodeURIComponent(seg[1] || '')); break;
    case 'track': html = pageTrack(); break;
    case 'wishlist': html = pageWishlist(); break;
    case 'account': html = pageAccount(); break;
    case 'about': html = pageAbout(); break;
    default: html = notFound();
  }
  el.innerHTML = html;
  renderCatbar();
  if (seg[0] === 'checkout') { mountTurnstile(); }
  if (seg[0] === 'track') { mountTurnstile(); const f = $('[data-form=track]'); if ((query().get('no') || '') && query().get('phone')) runTrack(f); }
  if (seg[0] === 'account') loadMyOrders();
  if (!pdpKeep) window.scrollTo({ top: 0 });
  pdpKeep = false;
}
let pdpKeep = false;
const rerender = () => { pdpKeep = true; route(); };

/* ---------------------------------------------------------------- events */
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act, i = Number(a.dataset.i);
  switch (act) {
    case 'lang': setLang(getLang() === 'bn' ? 'en' : 'bn'); shell(); rerender(); break;
    case 'cart': document.body.classList.add('cart-open'); break;
    case 'cart-close': document.body.classList.remove('cart-open'); break;
    case 'reset-demo': S.be.resetDemo(); break;
    case 'q+': { const l = cartLines()[i]; if (l && l.qty + 1 > l.max) toast(t('Only {n} in stock', { n: fmtNum(l.max, getLang()) }), 'err'); else if (l) { S.cart[i].qty += 1; } saveCart(); updateBadges(); renderDrawer(); break; }
    case 'q-': if (S.cart[i]) { S.cart[i].qty -= 1; if (S.cart[i].qty < 1) S.cart.splice(i, 1); saveCart(); updateBadges(); renderDrawer(); if (location.hash.startsWith('#/checkout')) { CO.server = null; rerender(); } } break;
    case 'rm': S.cart.splice(i, 1); saveCart(); updateBadges(); renderDrawer(); if (location.hash.startsWith('#/checkout')) rerender(); break;
    case 'wish': { e.preventDefault(); const id = a.dataset.id; if (S.wish.has(id)) S.wish.delete(id); else S.wish.add(id); saveWish(); updateBadges(); if (location.hash.startsWith('#/wishlist') || location.hash.startsWith('#/p/') || location.hash.startsWith('#/shop') || location.hash === '#/' || !location.hash) rerender(); break; }
    case 'opt': pdp.sel[a.dataset.name] = a.dataset.val; rerender(); break;
    case 'thumb': pdp.img = i; rerender(); break;
    case 'pq+': { const p = S.products.get(pdp.id); const v = pickVariant(p); const max = v ? availableStock(p, v) : stockOf(p); if (pdp.qty < Math.min(max, 99)) pdp.qty += 1; $('#pq').textContent = fmtNum(pdp.qty, getLang()); break; }
    case 'pq-': pdp.qty = Math.max(1, pdp.qty - 1); $('#pq').textContent = fmtNum(pdp.qty, getLang()); break;
    case 'add': case 'buy': {
      const p = S.products.get(a.dataset.id); const v = pickVariant(p);
      if (p.variants?.length && !v) { toast(t('Please choose an option first'), 'err'); break; }
      if (addToCart(p.id, v ? v.id : '', pdp.qty)) { if (act === 'buy') location.hash = '#/checkout'; else { toast(t('Added to cart')); } }
      break;
    }
    case 'more': S.shown += PAGE; rerender(); break;
    case 'clear-q': setQuery({ q: '' }); break;
    case 'coupon': applyCoupon(); break;
    case 'atab': acctTab = a.dataset.tab; rerender(); break;
    case 'logout': await S.be.auth.signOut(); break;
    case 'forgot': { const em = $('#a-email')?.value.trim(); if (!em) { toast(t('Enter your email first'), 'err'); break; } try { await S.be.auth.reset(em); toast(t('Password reset email sent')); } catch (er) { toast(er.message, 'err'); } break; }
    case 'cancel-order': {
      if (!confirm(t('Cancel this order?'))) break;
      try { const ph = $('#t-ph')?.value || ls.get('bz_last', {}).phone; const o = await S.be.api('customerCancel', { no: a.dataset.no, phone: ph, turnstile: tsToken }); $('#t-out').innerHTML = orderCard(o); toast(t('Order cancelled')); } catch (er) { toast(errText(er), 'err'); }
      break;
    }
    default:
  }
});
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-form=filters]');
  if (f) { const fd = new FormData(f); setQuery({ sort: fd.get('sort') === 'new' ? '' : fd.get('sort'), min: fd.get('min'), max: fd.get('max'), stock: fd.get('stock') ? '1' : '' }); return; }
  if (e.target.name === 'pay') { $('#trx').hidden = e.target.value === 'cod'; }
  if (e.target.id === 'f-dist' && $('#sum')) { if (CO.server) applyCouponRefresh(); else $('#sum').innerHTML = summaryHtml(e.target.value); }
});
async function applyCouponRefresh() { CO.server = null; await applyCoupon(); }
document.addEventListener('input', debounce((e) => { const sum = $('#sum'); if (e.target.id === 'f-dist' && !CO.server && sum) sum.innerHTML = summaryHtml(e.target.value); }, 250));
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  if (kind === 'search') { const q = new FormData(f).get('q').toString().trim(); location.hash = `#/shop${q ? `?q=${encodeURIComponent(q)}` : ''}`; }
  if (kind === 'checkout') submitCheckout(f);
  if (kind === 'track') runTrack(f);
  if (kind === 'auth') {
    const fd = Object.fromEntries(new FormData(f)), err = $('#a-err');
    err.hidden = true;
    try { if (acctTab === 'up') await S.be.auth.signUp(fd.email, fd.password, { name: fd.name }); else await S.be.auth.signIn(fd.email, fd.password); }
    catch (er) { err.textContent = er.message; err.hidden = false; }
  }
  if (kind === 'profile') {
    const fd = Object.fromEntries(new FormData(f));
    try { await S.be.db.update('users', S.user.uid, { name: fd.name.slice(0, 80), phone: normalizePhone(fd.phone), address: fd.address.slice(0, 300), district: fd.district.slice(0, 60) }); await S.be.auth.refresh(); toast(t('Saved')); } catch (er) { toast(er.message, 'err'); }
  }
});
window.addEventListener('hashchange', () => { document.body.classList.remove('cart-open'); if (!location.hash.startsWith('#/track')) stopTrackPoll(); route(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('cart-open'); });

/* ---------------------------------------------------------------- boot */
async function boot() {
  S.be = await initBackend();
  await S.be.ready;
  S.user = S.be.auth.user;
  const shopId = shopIdFromUrl();
  document.body.innerHTML = '<div class="wrap"><div class="skel" style="height:300px;margin-top:40px"></div></div>';
  if (shopId) await loadShopData(shopId);
  shell();
  S.be.auth.onChange((u) => { S.user = u; if (location.hash.startsWith('#/account') || location.hash.startsWith('#/checkout')) rerender(); });
  if (!shopId) { app().innerHTML = await pageDirectory(); return; }
  if (!S.shop) { app().innerHTML = `<div class="center"><h1>${esc(t('This shop is not set up yet.'))}</h1><a class="btn" href="/admin/">${esc(t('Open admin'))}</a></div>`; return; }
  route();
}
boot().catch((e) => { console.error(e); document.body.innerHTML = '<div style="padding:40px;font-family:system-ui">Could not start the shop. Please refresh.</div>'; });
