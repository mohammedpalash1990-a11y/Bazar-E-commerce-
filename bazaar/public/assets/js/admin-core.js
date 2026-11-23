// Shared admin state and helpers (dialogs, formatting, printing, live orders).
import { t, getLang } from './i18n.js';
import { esc, safeUrl, fmtMoney, fmtDate, fmtNum, toast, h } from './util.js';

export const A = { be: null, user: null, shopId: '', shop: null, orders: [], ready: false, handlers: {}, seen: null, unread: 0 };

export const sym = () => A.shop?.currency || '৳';
export const money = (n) => fmtMoney(n, sym(), getLang());
export const num = (n) => fmtNum(n, getLang());
export const dt = (ts, withTime = true) => fmtDate(ts, getLang(), withTime);
export const isOwner = () => A.user && (A.user.role === 'owner' || A.user.role === 'super');
export const isSuper = () => A.user?.role === 'super';

export function on(evt, cb) { (A.handlers[evt] ||= new Set()).add(cb); return () => A.handlers[evt].delete(cb); }
export function emit(evt, data) { A.handlers[evt]?.forEach((cb) => cb(data)); }

export const STATUS = {
  pending: ['Pending', 'warn'], confirmed: ['Confirmed', 'info'], processing: ['Processing', 'info'], shipped: ['Shipped', 'info'],
  delivered: ['Delivered', 'ok'], cancelled: ['Cancelled', 'danger'], returned: ['Returned', 'danger'],
};
export const statusBadge = (s) => `<span class="badge ${STATUS[s]?.[1] || ''}">${esc(t(STATUS[s]?.[0] || s))}</span>`;
export const payBadge = (o) => (o.due <= 0 ? `<span class="badge ok">${esc(t('Paid'))}</span>` : o.paid > 0 ? `<span class="badge gold">${esc(t('Partial'))}</span>` : `<span class="badge warn">${esc(t('Unpaid'))}</span>`);
export const thumb = (src) => `<div class="thumb">${src ? `<img src="${esc(safeUrl(src))}" alt="" loading="lazy">` : ''}</div>`;

// A <dialog> with focus trap and Esc for free. Returns {el, close}.
export function openDialog(html, { narrow = false, onClose } = {}) {
  const el = h('dialog', { class: narrow ? 'narrow' : '' });
  el.innerHTML = html;
  document.body.append(el);
  const close = () => { if (el.open) el.close(); };
  el.addEventListener('close', () => { el.remove(); onClose?.(); });
  el.addEventListener('click', (e) => { if (e.target === el) close(); if (e.target.closest('[data-close]')) close(); });
  el.showModal();
  return { el, close };
}

export function confirmBox(message, { danger = true, ok = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const d = openDialog(`<div class="dh"><h2>${esc(message)}</h2></div><div class="df"><button class="btn ghost" data-close>${esc(t('Cancel'))}</button><button class="btn ${danger ? 'danger' : ''}" id="yes">${esc(t(ok))}</button></div>`, { narrow: true, onClose: () => resolve(false) });
    d.el.querySelector('#yes').addEventListener('click', () => { resolve(true); d.close(); });
  });
}

export const errMsg = (e) => e?.message || t('Something went wrong. Please try again.');

export async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'err'); } finally { if (btn) btn.disabled = false; }
}

/* ------------------------------------------------------------ live orders */
let unwatch;
export function watchOrders() {
  unwatch?.();
  A.orders = []; A.seen = null;
  if (!A.shopId) return;
  unwatch = A.be.db.watch('orders', { where: [['shopId', '==', A.shopId]], orderBy: [['createdAt', 'desc']], limit: 300 }, (rows) => {
    if (!rows) return;
    if (A.seen) {
      const fresh = rows.filter((o) => !A.seen.has(o.id) && o.status === 'pending');
      if (fresh.length) {
        A.unread += fresh.length;
        toast(t('New order {no}', { no: fresh[0].no }));
        beep();
      }
    }
    A.seen = new Set(rows.map((o) => o.id));
    A.orders = rows;
    emit('orders', rows);
  });
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); o.stop(ctx.currentTime + 0.5);
  } catch { /* audio blocked until the user interacts */ }
}

/* ------------------------------------------------------------ invoice */
export function invoiceHtml(o, shop, thermal) {
  const c = shop.contact || {};
  const logo = shop.brand?.logo ? `<img class="lg" src="${esc(safeUrl(shop.brand.logo))}" alt="">` : '';
  return `<div class="inv ${thermal ? 'thermal' : ''}">
    <div class="hd"><div>${logo}<h1>${esc(shop.name)}</h1><div>${esc(c.phone || '')} ${esc(c.email || '')}<br>${esc(c.address || '')}</div></div>
      <div style="text-align:${thermal ? 'center' : 'right'}"><h1>${esc(t('INVOICE'))}</h1><div>${esc(o.no)}<br>${esc(dt(o.createdAt))}</div></div></div>
    <div><strong>${esc(o.customer.name)}</strong><br>${esc(o.customer.phone)}<br>${esc(o.customer.address)}, ${esc(o.customer.district)}</div>
    <table><thead><tr><th>${esc(t('Item'))}</th><th class="r">${esc(t('Qty'))}</th><th class="r">${esc(t('Price'))}</th><th class="r">${esc(t('Total'))}</th></tr></thead><tbody>
      ${o.items.map((l) => `<tr><td>${esc(l.name)}${l.variantLabel ? ` (${esc(l.variantLabel)})` : ''}</td><td class="r">${l.qty}</td><td class="r">${money(l.unit)}</td><td class="r">${money(l.total)}</td></tr>`).join('')}
      <tr><td colspan="3" class="r">${esc(t('Subtotal'))}</td><td class="r">${money(o.subtotal)}</td></tr>
      ${o.discount ? `<tr><td colspan="3" class="r">${esc(t('Discount'))}</td><td class="r">−${money(o.discount)}</td></tr>` : ''}
      <tr><td colspan="3" class="r">${esc(t('Delivery'))}</td><td class="r">${money(o.delivery)}</td></tr>
      <tr class="tot"><td colspan="3" class="r">${esc(t('Total'))}</td><td class="r">${money(o.total)}</td></tr>
      <tr><td colspan="3" class="r">${esc(t('Paid'))}</td><td class="r">${money(o.paid)}</td></tr>
      <tr class="tot"><td colspan="3" class="r">${esc(t('Due'))}</td><td class="r">${money(o.due)}</td></tr></tbody></table>
    <p style="text-align:center">${esc(t('Thank you for shopping with us!'))}</p></div>`;
}

export function printInvoice(o, thermal = false) {
  let box = document.getElementById('invoice');
  if (!box) { box = h('div', { id: 'invoice' }); document.body.append(box); }
  box.innerHTML = invoiceHtml(o, A.shop, thermal);
  document.body.classList.add('printing');
  document.body.classList.toggle('thermal', thermal);
  const done = () => { document.body.classList.remove('printing', 'thermal'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
