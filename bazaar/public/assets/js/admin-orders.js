import { t } from './i18n.js';
import { ic } from './icons.js';
import { $, $$, esc, toast, download, csvCell } from './util.js';
import { nextStatuses } from '../../shared/core.js';
import { A, money, num, dt, on, STATUS, statusBadge, payBadge, thumb, openDialog, guard, errMsg, printInvoice } from './admin-core.js';

const live = (o) => o.status !== 'cancelled' && o.status !== 'returned';
const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ---------------------------------------------------------------- dashboard */
export function renderDashboard(el) {
  let lowCount = null;
  A.be.db.list('products', { where: [['shopId', '==', A.shopId]] }).then((ps) => {
    lowCount = ps.filter((p) => p.trackStock !== false && p.active !== false && (p.variants?.length ? p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(p.stock) || 0) <= 5).length;
    draw();
  }).catch(() => {});
  function draw() {
    const now = Date.now(), today = dayStart(now);
    const os = A.orders;
    const td = os.filter((o) => o.createdAt >= today);
    const rev = (arr) => arr.filter(live).reduce((s, o) => s + o.total, 0);
    const pending = os.filter((o) => o.status === 'pending').length;
    const due = os.filter(live).reduce((s, o) => s + o.due, 0);
    const days = Array.from({ length: 7 }, (_, i) => { const s = dayStart(now - (6 - i) * 86400000); return { s, v: rev(os.filter((o) => o.createdAt >= s && o.createdAt < s + 86400000)) }; });
    const max = Math.max(1, ...days.map((d) => d.v));
    const top = new Map();
    os.filter((o) => live(o) && o.createdAt > now - 30 * 86400000).forEach((o) => o.items.forEach((l) => top.set(l.name, (top.get(l.name) || 0) + l.qty)));
    const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    el.innerHTML = `<div class="stats">
      <div class="stat"><div class="k"><i>${ic('box')}</i>${esc(t("Today's orders"))}</div><div class="v">${num(td.length)}</div><div class="s">${esc(t('{n} in total', { n: num(os.length) }))}</div></div>
      <div class="stat gold"><div class="k"><i>${ic('chart')}</i>${esc(t("Today's sales"))}</div><div class="v">${money(rev(td))}</div><div class="s">${esc(t('Last 7 days: {n}', { n: money(days.reduce((s, d) => s + d.v, 0)) }))}</div></div>
      <div class="stat warn"><div class="k"><i>${ic('bell')}</i>${esc(t('Waiting to confirm'))}</div><div class="v">${num(pending)}</div><div class="s">${esc(t('Orders needing action'))}</div></div>
      <div class="stat"><div class="k"><i>${ic('tag')}</i>${esc(t('Money still to collect'))}</div><div class="v">${money(due)}</div><div class="s">${lowCount == null ? '' : esc(t('Low-stock products: {n}', { n: num(lowCount) }))}</div></div></div>
    <div class="two-col"><div class="panel"><header><h2>${esc(t('Sales, last 7 days'))}</h2></header><div class="body"><div class="chart">${days.map((d) => `<div class="b"><div class="bar" style="height:${Math.round((d.v / max) * 100)}%" data-v="${money(d.v)}"></div><span>${new Date(d.s).getDate()}</span></div>`).join('')}</div></div></div>
      <div class="panel"><header><h2>${esc(t('Top products (30 days)'))}</h2></header><div class="body">${topList.length ? topList.map(([n, q]) => `<div class="row" style="padding:6px 0"><span>${esc(n)}</span><strong>${num(q)}</strong></div>`).join('') : `<p class="hint">${esc(t('No sales yet.'))}</p>`}</div></div></div>
    <div class="panel"><header><h2>${esc(t('Recent orders'))}</h2><a class="btn ghost sm" href="#/orders">${esc(t('See all'))}</a></header>${ordersTable(os.slice(0, 8))}</div>`;
    bindRows(el);
  }
  draw();
  return on('orders', draw);
}

/* ---------------------------------------------------------------- orders list */
function ordersTable(list) {
  if (!list.length) return `<div class="empty-row">${esc(A.ordersError ? `${t('Could not load orders')}: ${A.ordersError}` : t('No orders to show.'))}</div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Order'))}</th><th>${esc(t('Customer'))}</th><th>${esc(t('Date'))}</th><th>${esc(t('Status'))}</th><th>${esc(t('Payment'))}</th><th class="num">${esc(t('Total'))}</th></tr></thead><tbody>
    ${list.map((o) => `<tr class="click" data-order="${esc(o.id)}" tabindex="0"><td><span class="mono">${esc(o.no)}</span></td><td>${esc(o.customer.name)}<div class="sub">${esc(o.customer.phone)} · ${esc(o.customer.district)}</div></td><td>${esc(dt(o.createdAt))}</td><td>${statusBadge(o.status)}</td><td>${payBadge(o)}<div class="sub">${esc(o.payMethod === 'cod' ? t('Cash on delivery') : o.payMethod)}</div></td><td class="num"><strong>${money(o.total)}</strong>${o.due > 0 && o.paid > 0 ? `<div class="sub">${esc(t('Due'))} ${money(o.due)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindRows(el) {
  el.onclick = (e) => { const r = e.target.closest('[data-order]'); if (r) orderDialog(r.dataset.order); };
  el.onkeydown = (e) => { if (e.key === 'Enter') { const r = e.target.closest('[data-order]'); if (r) orderDialog(r.dataset.order); } };
}

const F = { q: '', status: '', pay: '', range: 'all' };

// Steadfast booking: shows the saved tracking code once booked, otherwise the "send to courier" actions.
function courierBox(o) {
  const c = o.courier || {};
  if (c.consignmentId) return `<p class="hint" style="margin:0 0 10px"><strong>${esc(c.name)}</strong> · ${esc(c.trackingId)}${c.status ? ` · ${esc(courierStatusLabel(c.status))}` : ''}</p>`;
  if (!['confirmed', 'processing'].includes(o.status)) return '';
  return `<div class="acts-row" style="margin-bottom:10px"><button class="btn sm" data-courier="book">${esc(t('Send to Steadfast'))}</button><button class="btn ghost sm" data-courier="fraud">${esc(t('Check delivery record'))}</button></div><p class="hint" id="cf-out" style="margin:0 0 10px" role="status"></p>`;
}
export const courierStatusLabel = (s) => t({ in_review: 'In review', pending: 'Pending', hold: 'On hold', delivered: 'Delivered', partial_delivered: 'Partly delivered', cancelled: 'Cancelled', unknown: 'Unknown' }[s] || s);
export function renderOrders(el) {
  function draw() {
    const now = Date.now();
    const from = { today: dayStart(now), '7': now - 7 * 86400000, '30': now - 30 * 86400000, all: 0 }[F.range];
    const q = F.q.trim().toLowerCase();
    const list = A.orders.filter((o) => (!F.status || o.status === F.status)
      && (!F.pay || (F.pay === 'paid' ? o.due <= 0 : F.pay === 'partial' ? o.paid > 0 && o.due > 0 : o.paid === 0))
      && o.createdAt >= from
      && (!q || `${o.no} ${o.customer.name} ${o.customer.phone}`.toLowerCase().includes(q)));
    const sum = list.filter(live);
    const keep = document.activeElement?.id === 'of-q';
    el.innerHTML = `<div class="stats">
      <div class="stat"><div class="k"><i>${ic('box')}</i>${esc(t('Orders'))}</div><div class="v">${num(list.length)}</div></div>
      <div class="stat warn"><div class="k"><i>${ic('bell')}</i>${esc(t('Waiting to confirm'))}</div><div class="v">${num(list.filter((o) => o.status === 'pending').length)}</div></div>
      <div class="stat gold"><div class="k"><i>${ic('chart')}</i>${esc(t('Sales'))}</div><div class="v">${money(sum.reduce((s, o) => s + o.total, 0))}</div></div>
      <div class="stat"><div class="k"><i>${ic('tag')}</i>${esc(t('Still to collect'))}</div><div class="v">${money(sum.reduce((s, o) => s + o.due, 0))}</div></div></div>
    <div class="panel"><div class="filters">
      <input class="input grow" id="of-q" type="search" placeholder="${esc(t('Search order no, name or phone'))}" value="${esc(F.q)}" aria-label="${esc(t('Search'))}">
      <select class="input" id="of-s" aria-label="${esc(t('Status'))}"><option value="">${esc(t('All statuses'))}</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${F.status === k ? 'selected' : ''}>${esc(t(v[0]))}</option>`).join('')}</select>
      <select class="input" id="of-p" aria-label="${esc(t('Payment'))}"><option value="">${esc(t('All payments'))}</option>${[['paid', 'Paid'], ['partial', 'Partial'], ['unpaid', 'Unpaid']].map(([k, v]) => `<option value="${k}" ${F.pay === k ? 'selected' : ''}>${esc(t(v))}</option>`).join('')}</select>
      <select class="input" id="of-r" aria-label="${esc(t('Date'))}">${[['all', 'All time'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']].map(([k, v]) => `<option value="${k}" ${F.range === k ? 'selected' : ''}>${esc(t(v))}</option>`).join('')}</select>
      <button class="btn ghost sm" id="of-csv">${ic('download')} CSV</button></div>
      ${ordersTable(list)}</div>`;
    bindRows(el);
    $('#of-q').oninput = (e) => { F.q = e.target.value; draw(); };
    $('#of-s').onchange = (e) => { F.status = e.target.value; draw(); };
    $('#of-p').onchange = (e) => { F.pay = e.target.value; draw(); };
    $('#of-r').onchange = (e) => { F.range = e.target.value; draw(); };
    $('#of-csv').onclick = () => exportCsv(list);
    if (keep) { const i = $('#of-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  draw();
  return on('orders', draw);
}

function exportCsv(list) {
  const rows = [['Order', 'Date', 'Customer', 'Phone', 'District', 'Address', 'Status', 'Payment method', 'Subtotal', 'Discount', 'Delivery', 'Total', 'Paid', 'Due', 'Courier', 'Tracking', 'Items']];
  list.forEach((o) => rows.push([o.no, new Date(o.createdAt).toISOString(), o.customer.name, o.customer.phone, o.customer.district, o.customer.address, o.status, o.payMethod, o.subtotal, o.discount, o.delivery, o.total, o.paid, o.due, o.courier?.name || '', o.courier?.trackingId || '', o.items.map((l) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} x${l.qty}`).join('; ')]));
  download(`orders-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'));
}

/* ---------------------------------------------------------------- order dialog */
export function orderDialog(id) {
  const find = () => A.orders.find((o) => o.id === id);
  let o = find();
  if (!o) return;
  const d = openDialog('', { onClose: () => off() });
  let stamp = 0;
  const render = () => {
    o = find() || o;
    stamp = o.updatedAt;
    const wa = String(o.customer.phone).replace(/^0/, '880');
    const nexts = nextStatuses(o.status);
    d.el.innerHTML = `<div class="dh"><div><h2>${esc(t('Order'))} #${esc(o.no)}</h2><div class="acts-row" style="margin-top:8px">${statusBadge(o.status)}${payBadge(o)}<span class="badge">${esc(o.payMethod === 'cod' ? t('Cash on delivery') : `${o.payMethod}${o.trxId ? ` · ${o.trxId}` : ''}`)}</span><span class="hint">${esc(dt(o.createdAt))}</span></div></div>
      <div class="acts-row"><button class="btn ghost sm" data-print="a4">${ic('print')} ${esc(t('Invoice'))}</button><button class="btn ghost sm" data-print="th">${ic('print')} ${esc(t('Receipt (80mm)'))}</button><button class="ibtn" data-close aria-label="${esc(t('Close'))}">${ic('x')}</button></div></div>
    <div class="db"><div class="cols"><div style="display:grid;gap:18px">
      <div class="cardx"><h3>${esc(t('Items'))}</h3>${o.items.map((l) => `<div class="li">${thumb(l.image)}<div>${esc(l.name)}<div class="sub hint">${esc(l.variantLabel)} ${money(l.unit)} × ${num(l.qty)}</div></div><strong>${money(l.total)}</strong></div>`).join('')}
        <hr style="border:0;border-top:1px solid var(--line)"><div class="row"><span>${esc(t('Subtotal'))}</span><span>${money(o.subtotal)}</span></div>
        ${o.discount ? `<div class="row"><span>${esc(t('Discount'))} ${o.couponCode ? `(${esc(o.couponCode)})` : ''}</span><span>−${money(o.discount)}</span></div>` : ''}
        <div class="row"><span>${esc(t('Delivery'))}</span><span>${money(o.delivery)}</span></div>
        <div class="row tot"><span>${esc(t('Total'))}</span><span>${money(o.total)}</span></div></div>
      <div class="due"><div class="row"><span><strong>${esc(t('Paid'))}</strong> ${money(o.paid)}</span><span>${esc(t('Due'))}</span></div><div class="big">${money(o.due)}</div>
        ${o.due > 0 && live(o) ? `<form class="acts-row" data-f="pay"><input class="input" style="width:120px;height:38px" name="amount" type="number" min="1" max="${o.due}" step="any" value="${o.due}" aria-label="${esc(t('Amount'))}"><select class="input" style="width:120px;height:38px" name="method"><option value="cash">${esc(t('Cash'))}</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="card">${esc(t('Card'))}</option></select><button class="btn sm gold">${esc(t('Receive payment'))}</button></form>` : ''}
        ${o.payments?.length ? `<div class="hist">${o.payments.map((p) => `<div><time>${esc(dt(p.at))}</time><span>${money(p.amount)} · ${esc(p.method)} ${esc(p.note || '')}</span></div>`).join('')}</div>` : ''}</div></div>
      <div style="display:grid;gap:18px">
      <div class="cardx"><h3>${esc(t('Customer'))}</h3><dl class="kv"><dt>${esc(t('Name'))}</dt><dd>${esc(o.customer.name)}</dd><dt>${esc(t('Phone'))}</dt><dd><a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a> · <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a></dd><dt>${esc(t('District'))}</dt><dd>${esc(o.customer.district)}</dd><dt>${esc(t('Address'))}</dt><dd>${esc(o.customer.address)}</dd>${o.customer.note ? `<dt>${esc(t('Note'))}</dt><dd>${esc(o.customer.note)}</dd>` : ''}</dl></div>
      <div class="cardx"><h3>${esc(t('Courier'))}</h3>${courierBox(o)}<form class="form" data-f="courier" style="gap:8px"><input class="input" name="name" placeholder="${esc(t('Courier name (Steadfast, Pathao…)'))}" value="${esc(o.courier?.name || '')}" maxlength="60"><input class="input" name="trackingId" placeholder="${esc(t('Tracking ID'))}" value="${esc(o.courier?.trackingId || '')}" maxlength="60"><button class="btn ghost sm">${esc(t('Save courier'))}</button></form></div>
      <div class="cardx"><h3>${esc(t('History'))}</h3><div class="hist">${[...o.history].reverse().map((h) => `<div><time>${esc(dt(h.at))}</time><span>${esc(h.text)} <span class="hint">· ${esc(h.by)}</span></span></div>`).join('')}</div>
        <form class="acts-row" data-f="note"><input class="input" style="flex:1;height:38px" name="text" placeholder="${esc(t('Add an internal note'))}" maxlength="300" required><button class="btn ghost sm">${esc(t('Add'))}</button></form></div></div></div></div>
    <div class="df">${nexts.filter((s) => s !== 'cancelled').map((s) => `<button class="btn" data-status="${s}">${esc(t('Mark as {s}', { s: t(STATUS[s][0]) }))}</button>`).join('')}${nexts.includes('cancelled') ? `<button class="btn danger" data-status="cancelled">${esc(t('Cancel order'))}</button>` : ''}</div>`;
  };
  const call = (body, btn) => guard(btn, async () => { const r = await A.be.api('adminUpdateOrder', { id, ...body }); const i = A.orders.findIndex((x) => x.id === id); if (i >= 0) A.orders[i] = r; o = r; render(); toast(t('Saved')); });
  d.el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-status]');
    if (s) {
      if (s.dataset.status === 'cancelled' && !confirm(t('Cancel this order? Stock goes back to the shelf.'))) return;
      return call({ action: 'status', status: s.dataset.status }, s);
    }
    const p = e.target.closest('[data-print]');
    if (p) { d.close(); printInvoice(o, p.dataset.print === 'th'); }
    const cb = e.target.closest('[data-courier]');
    if (cb && cb.dataset.courier === 'book') {
      if (!confirm(t('Send this order to Steadfast now? It will be marked Shipped.'))) return;
      return guard(cb, async () => { try { const r = await A.be.api('bookCourier', { id }); const i = A.orders.findIndex((x) => x.id === id); if (i >= 0) A.orders[i] = r; o = r; render(); toast(t('Sent to courier')); } catch (er) { toast(errMsg(er), 'err'); } });
    }
    if (cb && cb.dataset.courier === 'fraud') {
      return guard(cb, async () => {
        const out = d.el.querySelector('#cf-out');
        try { const r = await A.be.api('courierFraud', { id }); out.textContent = t('Delivery record: {d} delivered, {c} cancelled, {p} parcels in total', { d: num(r.delivered), c: num(r.cancelled), p: num(r.parcels) }) + (r.reports ? ` · ${t('Fraud reports')}: ${num(r.reports)}` : ''); } catch (er) { out.textContent = errMsg(er); }
      });
    }
  });
  d.el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.closest('[data-f]'), fd = Object.fromEntries(new FormData(f)), b = f.querySelector('button');
    if (f.dataset.f === 'pay') call({ action: 'payment', amount: Number(fd.amount), method: fd.method }, b);
    if (f.dataset.f === 'courier') call({ action: 'courier', name: fd.name, trackingId: fd.trackingId }, b);
    if (f.dataset.f === 'note') call({ action: 'note', text: fd.text }, b);
  });
  const off = on('orders', () => { const n = find(); if (n && n.updatedAt !== stamp && !d.el.contains(document.activeElement?.closest('form'))) render(); });
  render();
}
