import { t, pick } from './i18n.js';
import { ic } from './icons.js';
import { $, esc, safeUrl, toast, download, csvCell, imageToDataUrl, inviteCode } from './util.js';
import { slugify, isShopOpen } from '../../shared/core.js';
import { defaultShop } from '../../shared/handlers.js';
import { A, money, num, dt, STATUS, statusBadge, openDialog, confirmBox, guard } from './admin-core.js';

const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dateVal = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');

/* ---------------------------------------------------------------- customers */
export async function renderCustomers(el) {
  let rows = [], q = '';
  const draw = () => {
    const list = rows.filter((c) => !q || `${c.name} ${c.phone} ${c.district}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.lastOrderAt || 0) - (a.lastOrderAt || 0));
    el.innerHTML = `<div class="panel"><div class="filters"><input class="input grow" id="cu-q" type="search" placeholder="${esc(t('Search name, phone or district'))}" value="${esc(q)}" aria-label="${esc(t('Search'))}"><button class="btn ghost sm" id="cu-csv">${ic('download')} CSV</button></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Customer'))}</th><th>${esc(t('District'))}</th><th class="num">${esc(t('Orders'))}</th><th class="num">${esc(t('Total spent'))}</th><th>${esc(t('Last order'))}</th></tr></thead><tbody>${list.map((c) => `<tr><td>${esc(c.name)}<div class="sub">${esc(c.phone)}</div></td><td>${esc(c.district)}</td><td class="num">${num(c.orders)}</td><td class="num"><strong>${money(c.spent)}</strong></td><td>${esc(dt(c.lastOrderAt, false))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No customers yet. They appear after the first order.'))}</div>`}</div>`;
    const i = $('#cu-q'); i.oninput = (e) => { q = e.target.value; const pos = q.length; draw(); const n = $('#cu-q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#cu-csv').onclick = () => download('customers.csv', [['Name', 'Phone', 'District', 'Address', 'Orders', 'Spent'], ...list.map((c) => [c.name, c.phone, c.district, c.address, c.orders, c.spent])].map((r) => r.map(csvCell).join(',')).join('\n'));
  };
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  rows = (await A.be.db.list('customers', { where: [['shopId', '==', A.shopId]] })).sort((a, b) => (b.lastOrderAt || 0) - (a.lastOrderAt || 0)).slice(0, 1000);
  draw();
}

/* ---------------------------------------------------------------- reviews */
const starsText = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
export async function renderReviews(el) {
  let rows = [], tab = 'pending';
  const KINDS = { pending: ['Pending', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'danger'] };
  const draw = () => {
    const count = (k) => rows.filter((r) => r.status === k).length;
    const list = rows.filter((r) => r.status === tab).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    el.innerHTML = `<div class="panel"><header><h2>${esc(t('Reviews'))}</h2></header>
      <p class="hint" style="margin-bottom:12px">${esc(t('Reviews wait here until you approve them. Only approved reviews are shown in the shop.'))} ${esc(t('Only customers with a delivered order can write a review.'))}</p>
      <div class="chips" style="margin-bottom:14px">${Object.entries(KINDS).map(([k, [label]]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${k}">${esc(t(label))} (${num(count(k))})</button>`).join('')}</div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Product'))}</th><th>${esc(t('Rating'))}</th><th>${esc(t('Review'))}</th><th>${esc(t('Date'))}</th><th></th></tr></thead><tbody>
        ${list.map((r) => `<tr><td>${esc(r.productName || r.productId)}<div class="sub">${esc(r.name)} · ${esc(t('Order {n}', { n: r.orderNo }))}</div></td><td style="white-space:nowrap;color:var(--accent-ink)">${esc(starsText(Math.max(1, Math.min(5, Number(r.rating) || 0))))}</td><td style="max-width:360px;white-space:normal">${esc(r.text || '—')}</td><td>${esc(dt(r.createdAt, false))}</td>
          <td style="white-space:nowrap">${r.status !== 'approved' ? `<button class="btn sm" data-rv="approve" data-id="${esc(r.id)}">${esc(t('Approve'))}</button>` : ''} ${r.status !== 'rejected' ? `<button class="btn ghost sm" data-rv="reject" data-id="${esc(r.id)}">${esc(t('Reject'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty-row">${esc(t('No reviews yet.'))}</div>`}</div>`;
  };
  el.onclick = async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; draw(); return; }
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    await guard(b, async () => {
      const res = await A.be.api('adminReview', { id: b.dataset.id, action: b.dataset.rv });
      const row = rows.find((r) => r.id === b.dataset.id);
      if (row) row.status = res.status;
      toast(t('Review updated'));
      draw();
    });
  };
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  rows = await A.be.db.list('reviews', { where: [['shopId', '==', A.shopId]], limit: 500 });
  if (!rows.some((r) => r.status === 'pending') && rows.some((r) => r.status === 'approved')) tab = 'approved';
  draw();
  return () => { el.onclick = null; };
}

/* ---------------------------------------------------------------- newsletter subscribers */
export async function renderSubscribers(el) {
  let rows = [], q = '';
  const draw = () => {
    const list = rows.filter((r) => !q || r.email.includes(q.toLowerCase())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    el.innerHTML = `<div class="panel"><div class="filters"><input class="input grow" id="sb-q" type="search" placeholder="${esc(t('Search email'))}" value="${esc(q)}" aria-label="${esc(t('Search'))}"><button class="btn ghost sm" id="sb-csv">${ic('download')} CSV</button></div>
      <p class="hint" style="margin:10px 0">${esc(t('Everyone who subscribed to your newsletter appears here.'))} (${num(rows.length)})</p>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Email'))}</th><th>${esc(t('Subscribed on'))}</th></tr></thead><tbody>${list.map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(dt(r.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No subscribers yet.'))}</div>`}</div>`;
    $('#sb-q').oninput = (e) => { q = e.target.value; const pos = q.length; draw(); const n = $('#sb-q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#sb-csv').onclick = () => download('subscribers.csv', [['Email', 'Subscribed'], ...list.map((r) => [r.email, new Date(r.createdAt).toISOString()])].map((r2) => r2.map(csvCell).join(',')).join('\n'));
  };
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  rows = await A.be.db.list('subscribers', { where: [['shopId', '==', A.shopId]], limit: 5000 });
  draw();
}

/* ---------------------------------------------------------------- coupons */
export async function renderCoupons(el) {
  let rows = [];
  const load = async () => { rows = await A.be.db.list('coupons', { where: [['shopId', '==', A.shopId]] }); draw(); };
  const draw = () => {
    el.innerHTML = `<div class="panel"><header><h2>${esc(t('Coupons'))}</h2><button class="btn sm" id="cp-new">${ic('plus')} ${esc(t('Add coupon'))}</button></header>
      ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Code'))}</th><th>${esc(t('Discount'))}</th><th class="num">${esc(t('Min order'))}</th><th class="num">${esc(t('Used'))}</th><th>${esc(t('Expires'))}</th><th>${esc(t('Status'))}</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td><span class="mono">${esc(c.code)}</span></td><td>${c.type === 'percent' ? `${num(c.value)}%${c.maxDiscount ? ` (max ${money(c.maxDiscount)})` : ''}` : money(c.value)}</td><td class="num">${c.min ? money(c.min) : '—'}</td><td class="num">${num(c.used)}${c.limit ? ` / ${num(c.limit)}` : ''}</td><td>${c.expiresAt ? esc(dt(c.expiresAt, false)) : '—'}</td><td>${c.active ? `<span class="badge ok">${esc(t('Active'))}</span>` : `<span class="badge">${esc(t('Off'))}</span>`}</td><td class="num"><button class="ibtn" data-edit="${esc(c.id)}" aria-label="${esc(t('Edit'))}">${ic('edit')}</button> <button class="ibtn" data-del="${esc(c.id)}" aria-label="${esc(t('Delete'))}">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No coupons yet.'))}</div>`}</div>`;
    $('#cp-new').onclick = () => dlg(null);
  };
  const dlg = (c) => {
    const d = openDialog(`<form><div class="dh"><h2>${esc(c ? t('Edit coupon') : t('Add coupon'))}</h2></div><div class="db"><div class="form2">
      <div class="field"><label>${esc(t('Code'))} *</label><input class="input" name="code" value="${esc(c?.code || '')}" maxlength="20" pattern="[A-Za-z0-9_\\-]+" required ${c ? 'readonly' : ''}></div>
      <div class="field"><label>${esc(t('Type'))}</label><select class="input" name="type"><option value="percent" ${c?.type !== 'fixed' ? 'selected' : ''}>${esc(t('Percent'))}</option><option value="fixed" ${c?.type === 'fixed' ? 'selected' : ''}>${esc(t('Fixed amount'))}</option></select></div>
      <div class="field"><label>${esc(t('Value'))} *</label><input class="input" name="value" type="number" min="1" step="any" value="${c?.value ?? ''}" required></div>
      <div class="field"><label>${esc(t('Max discount'))}</label><input class="input" name="maxDiscount" type="number" min="0" value="${c?.maxDiscount || ''}"><span class="hint">${esc(t('For percent coupons only'))}</span></div>
      <div class="field"><label>${esc(t('Min order'))}</label><input class="input" name="min" type="number" min="0" value="${c?.min || ''}"></div>
      <div class="field"><label>${esc(t('Total uses allowed'))}</label><input class="input" name="limit" type="number" min="0" value="${c?.limit || ''}"><span class="hint">${esc(t('Empty = unlimited'))}</span></div>
      <div class="field"><label>${esc(t('Expires'))}</label><input class="input" name="expires" type="date" value="${dateVal(c?.expiresAt)}"></div>
      <div class="field" style="align-content:end"><label class="switch"><input type="checkbox" name="active" ${c?.active !== false ? 'checked' : ''}>${esc(t('Active'))}</label></div></div><p class="err" id="cerr" hidden></p></div>
      <div class="df"><button type="button" class="btn ghost" data-close>${esc(t('Cancel'))}</button><button class="btn">${esc(t('Save'))}</button></div></form>`, { narrow: true });
    d.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const code = fd.code.trim().toUpperCase();
      const value = Number(fd.value);
      if (fd.type === 'percent' && (value <= 0 || value > 100)) { const er = $('#cerr'); er.textContent = t('Percent must be between 1 and 100'); er.hidden = false; return; }
      await guard(e.target.querySelector('.btn:not(.ghost)'), async () => {
        const id = `${A.shopId}_${code}`;
        if (!c && await A.be.db.get('coupons', id)) throw new Error(t('That code already exists'));
        await A.be.db.set('coupons', id, { shopId: A.shopId, code, type: fd.type, value, maxDiscount: Number(fd.maxDiscount) || 0, min: Number(fd.min) || 0, limit: Number(fd.limit) || 0, used: c?.used || 0, active: fd.active === 'on', expiresAt: fd.expires ? new Date(`${fd.expires}T23:59:59`).getTime() : 0 });
        d.close(); toast(t('Saved')); await load();
      });
    };
  };
  el.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (ed) dlg(rows.find((c) => c.id === ed.dataset.edit));
    if (dl && await confirmBox(t('Delete this coupon?'))) await guard(null, async () => { await A.be.db.remove('coupons', dl.dataset.del); await load(); });
  };
  el.innerHTML = '<div class="skel" style="height:160px"></div>';
  await load();
  return () => { el.onclick = null; };
}

/* ---------------------------------------------------------------- reports */
export async function renderReports(el) {
  let range = '30', from = '', to = '';
  const draw = async () => {
    const now = Date.now();
    const start = range === 'custom' && from ? new Date(`${from}T00:00:00`).getTime() : dayStart(now - (Number(range) - 1) * 86400000);
    const end = range === 'custom' && to ? new Date(`${to}T23:59:59`).getTime() : now;
    const rows = (await A.be.db.list('orders', { where: [['shopId', '==', A.shopId]] })).filter((o) => o.createdAt >= start && o.createdAt <= end).sort((a, b) => b.createdAt - a.createdAt).slice(0, 2000);
    const live = rows.filter((o) => o.status !== 'cancelled' && o.status !== 'returned');
    const sum = (a, k) => a.reduce((s, o) => s + o[k], 0);
    const byStatus = Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((o) => o.status === k).length]));
    const days = new Map();
    live.forEach((o) => { const k = dateVal(dayStart(o.createdAt)); const d = days.get(k) || { n: 0, v: 0 }; d.n += 1; d.v += o.total; days.set(k, d); });
    const dayList = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const prod = new Map();
    live.forEach((o) => o.items.forEach((l) => { const p = prod.get(l.name) || { q: 0, v: 0 }; p.q += l.qty; p.v += l.total; prod.set(l.name, p); }));
    const prodList = [...prod.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 10);
    const methods = {}; live.forEach((o) => { methods[o.payMethod] = (methods[o.payMethod] || 0) + 1; });
    el.innerHTML = `<div class="panel"><div class="filters"><select class="input" id="rp-r">${[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['custom', 'Custom']].map(([k, v]) => `<option value="${k}" ${range === k ? 'selected' : ''}>${esc(t(v))}</option>`).join('')}</select>
      ${range === 'custom' ? `<input class="input" type="date" id="rp-f" value="${esc(from)}" aria-label="${esc(t('From'))}"><input class="input" type="date" id="rp-t" value="${esc(to)}" aria-label="${esc(t('To'))}">` : ''}
      <button class="btn ghost sm" id="rp-csv">${ic('download')} CSV</button></div></div>
    <div class="stats"><div class="stat gold"><div class="k"><i>${ic('chart')}</i>${esc(t('Sales'))}</div><div class="v">${money(sum(live, 'total'))}</div><div class="s">${esc(t('{n} orders', { n: num(live.length) }))}</div></div>
      <div class="stat"><div class="k"><i>${ic('tag')}</i>${esc(t('Average order'))}</div><div class="v">${money(live.length ? sum(live, 'total') / live.length : 0)}</div></div>
      <div class="stat"><div class="k"><i>${ic('box')}</i>${esc(t('Collected'))}</div><div class="v">${money(sum(live, 'paid'))}</div><div class="s">${esc(t('Still to collect'))}: ${money(sum(live, 'due'))}</div></div>
      <div class="stat warn"><div class="k"><i>${ic('x')}</i>${esc(t('Cancelled / returned'))}</div><div class="v">${num(byStatus.cancelled + byStatus.returned)}</div><div class="s">${rows.length ? Math.round(((byStatus.cancelled + byStatus.returned) / rows.length) * 100) : 0}%</div></div></div>
    <div class="two-col"><div class="panel"><header><h2>${esc(t('By day'))}</h2></header>${dayList.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Date'))}</th><th class="num">${esc(t('Orders'))}</th><th class="num">${esc(t('Sales'))}</th></tr></thead><tbody>${dayList.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${num(v.n)}</td><td class="num">${money(v.v)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No sales in this period.'))}</div>`}</div>
      <div style="display:grid;gap:18px;align-content:start"><div class="panel"><header><h2>${esc(t('Top products'))}</h2></header><div class="body">${prodList.map(([n, p]) => `<div class="row" style="padding:5px 0"><span>${esc(n)} <span class="hint">× ${num(p.q)}</span></span><strong>${money(p.v)}</strong></div>`).join('') || `<p class="hint">—</p>`}</div></div>
      <div class="panel"><header><h2>${esc(t('Order status'))}</h2></header><div class="body">${Object.entries(byStatus).filter(([, n]) => n).map(([k, n]) => `<div class="row" style="padding:5px 0">${statusBadge(k)}<strong>${num(n)}</strong></div>`).join('') || '—'}<hr style="border:0;border-top:1px solid var(--line);margin:10px 0">${Object.entries(methods).map(([k, n]) => `<div class="row" style="padding:3px 0"><span>${esc(k === 'cod' ? t('Cash on delivery') : k)}</span><strong>${num(n)}</strong></div>`).join('')}</div></div></div></div>`;
    $('#rp-r').onchange = (e) => { range = e.target.value; draw(); };
    if (range === 'custom') { $('#rp-f').onchange = (e) => { from = e.target.value; draw(); }; $('#rp-t').onchange = (e) => { to = e.target.value; draw(); }; }
    $('#rp-csv').onclick = () => download('report-by-day.csv', [['Date', 'Orders', 'Sales'], ...dayList.map(([k, v]) => [k, v.n, v.v])].map((r) => r.map(csvCell).join(',')).join('\n'));
  };
  el.innerHTML = '<div class="skel" style="height:240px"></div>';
  await draw();
}

/* ---------------------------------------------------------------- settings + team */
export async function renderSettings(el) {
  const s = A.shop, b = s.brand || {}, c = s.contact || {}, dl = s.delivery || {}, pay = s.pay || {};
  let logo = b.logo || '';
  const draw = async () => {
    const [team, invites] = await Promise.all([
      A.be.db.list('users', { where: [['shopId', '==', A.shopId]] }).catch(() => []),
      A.be.db.list('invites', { where: [['shopId', '==', A.shopId]] }).catch(() => []),
    ]);
    const open = invites.filter((i) => !i.used && i.role === 'staff' && i.expiresAt > Date.now());
    el.innerHTML = `<form class="panel" id="sform" novalidate><header><h2>${esc(t('Shop settings'))}</h2><button class="btn sm">${esc(t('Save changes'))}</button></header><div class="body"><div class="form2">
      <div class="field"><label>${esc(t('Shop name'))} *</label><input class="input" name="name" value="${esc(s.name)}" maxlength="60" required></div>
      <div class="field"><label>${esc(t('Tagline'))}</label><input class="input" name="tagline" value="${esc(b.tagline || '')}" maxlength="80"></div>
      <div class="field full"><label>${esc(t('About the shop'))}</label><textarea class="input" name="about" maxlength="600">${esc(s.about || '')}</textarea></div>
      <div class="field full"><label>${esc(t('Announcement bar'))}</label><input class="input" name="announcement" value="${esc(s.announcement || '')}" maxlength="140"></div>
      <div class="field"><label>${esc(t('Logo'))}</label><div class="cell">${logo ? `<img src="${esc(safeUrl(logo))}" alt="" style="height:48px;max-width:140px;object-fit:contain">` : ''}<label class="btn ghost sm" style="cursor:pointer">${esc(t('Upload logo'))}<input type="file" accept="image/*" id="logo-in" hidden></label>${logo ? `<button type="button" class="btn ghost sm" id="logo-rm">${esc(t('Remove'))}</button>` : ''}</div></div>
      <div class="field"><label>${esc(t('Brand colors'))}</label><div class="cell"><input type="color" name="primary" value="${esc(b.primary || '#1B5E43')}" aria-label="${esc(t('Main color'))}"><input type="color" name="accent" value="${esc(b.accent || '#C9A24B')}" aria-label="${esc(t('Accent color'))}"></div></div>
      <div class="field"><label>${esc(t('Phone'))}</label><input class="input" name="phone" value="${esc(c.phone || '')}" maxlength="20"></div>
      <div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" value="${esc(c.whatsapp || '')}" maxlength="20"></div>
      <div class="field"><label>${esc(t('Email'))}</label><input class="input" name="email" type="email" value="${esc(c.email || '')}" maxlength="100"></div>
      <div class="field"><label>${esc(t('Address'))}</label><input class="input" name="address" value="${esc(c.address || '')}" maxlength="200"></div>
      <div class="field"><label>${esc(t('Currency symbol'))}</label><input class="input" name="currency" value="${esc(s.currency || '৳')}" maxlength="4"></div>
      <div class="field"><label>${esc(t('Home district (cheaper delivery)'))}</label><input class="input" name="insideDistrict" value="${esc(dl.insideDistrict || '')}" maxlength="40"></div>
      <div class="field"><label>${esc(t('Delivery fee inside home district'))}</label><input class="input" name="insideFee" type="number" min="0" value="${dl.insideFee ?? 0}"></div>
      <div class="field"><label>${esc(t('Delivery fee elsewhere'))}</label><input class="input" name="outsideFee" type="number" min="0" value="${dl.outsideFee ?? 0}"></div>
      <div class="field"><label>${esc(t('Delivery time inside home district (days)'))}</label><input class="input" name="etaInside" maxlength="12" placeholder="1-2" value="${esc(dl.etaInside || '')}"></div>
      <div class="field"><label>${esc(t('Delivery time elsewhere (days)'))}</label><input class="input" name="etaOutside" maxlength="12" placeholder="3-5" value="${esc(dl.etaOutside || '')}"></div>
      <div class="field"><label>${esc(t('Free delivery above'))}</label><input class="input" name="freeAbove" type="number" min="0" value="${dl.freeAbove || ''}"><span class="hint">${esc(t('Empty = never free'))}</span></div>
      <div class="field"><label>bKash ${esc(t('number'))}</label><input class="input" name="bkash" value="${esc(pay.bkash || '')}" maxlength="20"><span class="hint">${esc(t('Leave empty to hide. Customers send money, then enter the transaction ID.'))}</span></div>
      <div class="field"><label>Nagad ${esc(t('number'))}</label><input class="input" name="nagad" value="${esc(pay.nagad || '')}" maxlength="20"></div>
      <div class="field full"><label>${esc(t('Telegram chat ID for daily reports'))}</label><input class="input" name="telegramChatId" value="${esc(s.notify?.telegramChatId || '')}" maxlength="30" inputmode="numeric" pattern="-?[0-9]+"><span class="hint">${esc(t('You get a sales summary and low-stock alert twice a day. Leave empty to turn off.'))}</span></div></div></div></form>
    <div class="panel"><header><h2>${esc(t('Team'))}</h2><button class="btn sm" id="inv-new">${ic('plus')} ${esc(t('Invite staff'))}</button></header>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Email'))}</th><th>${esc(t('Role'))}</th><th></th></tr></thead><tbody>${team.map((u) => `<tr><td>${esc(u.email)}</td><td><span class="badge ${u.role === 'owner' ? 'gold' : ''}">${esc(t(u.role === 'owner' ? 'Owner' : 'Staff'))}</span></td><td class="num">${u.role === 'staff' ? `<button class="btn ghost sm" data-rm="${esc(u.id)}">${esc(t('Remove'))}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="3" class="empty-row">—</td></tr>`}</tbody></table></div>
      ${open.length ? `<div class="body"><p class="lbl" style="margin-bottom:8px">${esc(t('Open invites'))}</p>${open.map((i) => `<div class="row" style="padding:4px 0"><span class="mono">${esc(i.id)}</span><span class="hint">${esc(t('expires'))} ${esc(dt(i.expiresAt, false))} <button class="btn ghost sm" data-revoke="${esc(i.id)}">${esc(t('Revoke'))}</button></span></div>`).join('')}</div>` : ''}</div>
    <div class="panel"><header><h2>${esc(t('Your shop link'))}</h2></header><div class="body"><div class="codebox">${esc(location.origin)}${A.be.mode === 'demo' || (await modeIsSingle()) ? '/' : `/s/${esc(s.id)}/`}</div></div></div>`;
    $('#sform').onsubmit = save;
    const li = $('#logo-in');
    li.onchange = async () => { try { logo = await imageToDataUrl(li.files[0], 360, 0.85); draw(); } catch { toast(t('That file is not a usable image'), 'err'); } };
    $('#logo-rm')?.addEventListener('click', () => { logo = ''; draw(); });
    $('#inv-new').onclick = newInvite;
  };
  const modeIsSingle = async () => (await import('./config.js')).CONFIG.mode === 'single';
  const save = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.name.trim().length < 2) return toast(t('Enter the shop name'), 'err');
    await guard(e.target.querySelector('.btn'), async () => {
      const patch = {
        name: fd.name.trim(), about: fd.about.trim(), announcement: fd.announcement.trim(), currency: fd.currency.trim() || '৳',
        brand: { logo, tagline: fd.tagline.trim(), primary: fd.primary, accent: fd.accent },
        contact: { phone: fd.phone.trim(), whatsapp: fd.whatsapp.trim(), email: fd.email.trim(), address: fd.address.trim() },
        delivery: { insideDistrict: fd.insideDistrict.trim(), insideFee: Number(fd.insideFee) || 0, outsideFee: Number(fd.outsideFee) || 0, freeAbove: Number(fd.freeAbove) || 0, etaInside: String(fd.etaInside || '').trim().slice(0, 12), etaOutside: String(fd.etaOutside || '').trim().slice(0, 12) },
        pay: { bkash: fd.bkash.trim(), nagad: fd.nagad.trim() },
        notify: { telegramChatId: fd.telegramChatId.trim() },
      };
      await A.be.db.update('shops', A.shopId, patch);
      Object.assign(A.shop, patch);
      A.onShopChange?.();
      toast(t('Saved'));
    });
  };
  const newInvite = async () => {
    const code = inviteCode();
    await guard(null, async () => {
      await A.be.db.set('invites', code, { shopId: A.shopId, role: 'staff', used: false, createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 });
      openDialog(`<div class="dh"><h2>${esc(t('Staff invite'))}</h2></div><div class="db"><p>${esc(t('Send this code to your staff member. It works once and expires in 7 days.'))}</p><div class="codebox">${esc(code)}</div><p class="hint">${esc(t('They open the admin page, choose "I have an invite code" and sign up.'))}</p></div><div class="df"><button class="btn" data-close>${esc(t('Done'))}</button></div>`, { narrow: true });
      draw();
    });
  };
  el.onclick = async (e) => {
    const rm = e.target.closest('[data-rm]'), rv = e.target.closest('[data-revoke]');
    if (rm && await confirmBox(t('Remove this staff member?'))) await guard(null, async () => { await A.be.api('removeStaff', { uid: rm.dataset.rm }); toast(t('Removed')); draw(); });
    if (rv) await guard(null, async () => { await A.be.db.remove('invites', rv.dataset.revoke); draw(); });
  };
  el.innerHTML = '<div class="skel" style="height:300px"></div>';
  await draw();
  return () => { el.onclick = null; };
}

/* ---------------------------------------------------------------- shops (platform admin) */
export async function renderShops(el) {
  let rows = [];
  const load = async () => { rows = await A.be.db.list('shops'); draw(); };
  const draw = () => {
    el.innerHTML = `<div class="panel"><header><h2>${esc(t('Shops'))}</h2><button class="btn sm" id="sh-new">${ic('plus')} ${esc(t('New shop'))}</button></header>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Shop'))}</th><th>${esc(t('Plan'))}</th><th>${esc(t('Expires'))}</th><th>${esc(t('Status'))}</th><th></th></tr></thead><tbody>${rows.map((s) => {
    const open = isShopOpen(s, Date.now());
    return `<tr><td><strong>${esc(s.name)}</strong><div class="sub">/s/${esc(s.id)}/</div></td><td>${esc(s.plan || '')}</td><td>${s.expiresAt ? esc(dt(s.expiresAt, false)) : esc(t('Never'))}</td><td>${open.ok ? `<span class="badge ok">${esc(t('Active'))}</span>` : `<span class="badge danger">${esc(t(open.reason === 'expired' ? 'Expired' : 'Suspended'))}</span>`}</td>
      <td class="num"><div class="acts-row" style="justify-content:flex-end"><button class="btn ghost sm" data-manage="${esc(s.id)}">${esc(t('Manage'))}</button><button class="btn ghost sm" data-ext="${esc(s.id)}">+30 ${esc(t('days'))}</button><button class="btn ghost sm" data-owner="${esc(s.id)}">${esc(t('Owner invite'))}</button><button class="btn ${s.status === 'suspended' ? '' : 'danger'} sm" data-tog="${esc(s.id)}">${esc(s.status === 'suspended' ? t('Activate') : t('Suspend'))}</button></div></td></tr>`; }).join('')}</tbody></table></div></div>`;
    $('#sh-new').onclick = newShop;
  };
  const showCode = (title, code) => openDialog(`<div class="dh"><h2>${esc(title)}</h2></div><div class="db"><p>${esc(t('Give this code to the shop owner. It works once and expires in 7 days.'))}</p><div class="codebox">${esc(code)}</div><p class="hint">${esc(t('The owner opens the admin page, chooses "I have an invite code" and signs up.'))}</p></div><div class="df"><button class="btn" data-close>${esc(t('Done'))}</button></div>`, { narrow: true });
  const ownerInvite = async (shopId) => { const code = inviteCode(); await A.be.db.set('invites', code, { shopId, role: 'owner', used: false, createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 }); return code; };
  const newShop = () => {
    const d = openDialog(`<form><div class="dh"><h2>${esc(t('New shop'))}</h2></div><div class="db"><div class="form2"><div class="field"><label>${esc(t('Shop name'))} *</label><input class="input" name="name" maxlength="60" required></div><div class="field"><label>${esc(t('Link name'))} *</label><input class="input" name="slug" maxlength="40" pattern="[a-z0-9\\-]+" placeholder="my-shop" required><span class="hint">${esc(t('Letters, numbers and dashes. Cannot change later.'))}</span></div><div class="field"><label>${esc(t('Plan'))}</label><input class="input" name="plan" value="standard" maxlength="30"></div><div class="field"><label>${esc(t('Subscription ends'))}</label><input class="input" type="date" name="expires"><span class="hint">${esc(t('Empty = never expires'))}</span></div></div><p class="err" id="serr" hidden></p></div><div class="df"><button type="button" class="btn ghost" data-close>${esc(t('Cancel'))}</button><button class="btn">${esc(t('Create shop'))}</button></div></form>`, { narrow: true });
    d.el.querySelector('input[name=name]').oninput = (e) => { const s = d.el.querySelector('input[name=slug]'); if (!s.dataset.touched) s.value = slugify(e.target.value); };
    d.el.querySelector('input[name=slug]').oninput = (e) => { e.target.dataset.touched = '1'; };
    d.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const id = slugify(fd.slug);
      await guard(e.target.querySelector('.btn:not(.ghost)'), async () => {
        if (!id || ['admin', 'api', 'assets', 's'].includes(id)) throw new Error(t('Choose a different link name'));
        if (await A.be.db.get('shops', id)) throw new Error(t('That link name is already taken'));
        const shop = { ...defaultShop(id, fd.name.trim(), Date.now()), plan: fd.plan.trim() || 'standard', expiresAt: fd.expires ? new Date(`${fd.expires}T23:59:59`).getTime() : 0 };
        delete shop.id;
        await A.be.db.set('shops', id, shop);
        const code = await ownerInvite(id);
        d.close(); showCode(t('Shop created'), code); await load();
      });
    };
  };
  el.onclick = async (e) => {
    const g = (k) => e.target.closest(`[data-${k}]`)?.dataset[k];
    const manage = g('manage'), ext = g('ext'), tog = g('tog'), own = g('owner');
    if (manage) { A.switchShop(manage); location.hash = '#/dashboard'; }
    if (ext) await guard(null, async () => { const s = rows.find((x) => x.id === ext); const base = Math.max(Date.now(), s.expiresAt || 0); await A.be.db.update('shops', ext, { expiresAt: base + 30 * 86400000 }); toast(t('Extended by 30 days')); await load(); });
    if (tog) { const s = rows.find((x) => x.id === tog); if (s.status !== 'suspended' && !(await confirmBox(t('Suspend this shop? Customers will not be able to order.')))) return; await guard(null, async () => { await A.be.db.update('shops', tog, { status: s.status === 'suspended' ? 'active' : 'suspended' }); await load(); }); }
    if (own) await guard(null, async () => showCode(t('Owner invite'), await ownerInvite(own)));
  };
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  await load();
  return () => { el.onclick = null; };
}
