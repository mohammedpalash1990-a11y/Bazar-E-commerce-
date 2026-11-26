import { t, pick } from './i18n.js';
import { ic } from './icons.js';
import { $, esc, safeUrl, toast, uid, imageToDataUrl, makeThumb, debounce } from './util.js';
import { slugify } from '../../shared/core.js';
import { A, money, num, thumb, openDialog, confirmBox, guard, errMsg } from './admin-core.js';

const totalStock = (p) => (p.variants?.length ? p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(p.stock) || 0);
const PF = { q: '', cat: '', st: '' };
let cats = [];

async function loadCats() { cats = (await A.be.db.list('categories', { where: [['shopId', '==', A.shopId]] })).sort((a, b) => (a.order || 0) - (b.order || 0)); }

export async function renderProducts(el) {
  let items = [];
  const syncCat = () => A.be.api('rebuildCatalog', { shopId: A.shopId }).catch(() => {});
  const load = async () => { [items] = await Promise.all([A.be.db.list('products', { where: [['shopId', '==', A.shopId]] }), loadCats()]); draw(); if (!A.catSynced) { A.catSynced = true; syncCat(); } };
  function draw() {
    const q = PF.q.trim().toLowerCase();
    const list = items.filter((p) => (!PF.cat || p.category === PF.cat) && (!PF.st || (PF.st === 'low' ? p.trackStock !== false && totalStock(p) <= 5 : PF.st === 'off' ? p.active === false : p.active !== false))
      && (!q || `${p.name} ${p.nameBn || ''} ${p.sku || ''}`.toLowerCase().includes(q))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const keep = document.activeElement?.id === 'pf-q';
    el.innerHTML = `<div class="panel"><div class="filters">
      <input class="input grow" id="pf-q" type="search" placeholder="${esc(t('Search products or SKU'))}" value="${esc(PF.q)}" aria-label="${esc(t('Search'))}">
      <select class="input" id="pf-c" aria-label="${esc(t('Category'))}"><option value="">${esc(t('All categories'))}</option>${cats.map((c) => `<option value="${esc(c.slug)}" ${PF.cat === c.slug ? 'selected' : ''}>${esc(pick(c, 'name'))}</option>`).join('')}</select>
      <select class="input" id="pf-s" aria-label="${esc(t('Status'))}"><option value="">${esc(t('All'))}</option><option value="on" ${PF.st === 'on' ? 'selected' : ''}>${esc(t('Visible'))}</option><option value="off" ${PF.st === 'off' ? 'selected' : ''}>${esc(t('Hidden'))}</option><option value="low" ${PF.st === 'low' ? 'selected' : ''}>${esc(t('Low stock'))}</option></select>
      <button class="btn sm" id="pf-new">${ic('plus')} ${esc(t('Add product'))}</button></div>
      ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Product'))}</th><th>${esc(t('Category'))}</th><th class="num">${esc(t('Price'))}</th><th class="num">${esc(t('Stock'))}</th><th>${esc(t('Visible'))}</th><th></th></tr></thead><tbody>
      ${list.map((p) => { const s = totalStock(p); return `<tr><td><div class="cell">${thumb(p.images?.[0])}<div>${esc(p.name)}<div class="sub">${esc(p.sku || '')}${p.variants?.length ? ` · ${num(p.variants.length)} ${esc(t('variants'))}` : ''}</div></div></div></td>
        <td>${esc(pick(cats.find((c) => c.slug === p.category) || {}, 'name') || '—')}</td>
        <td class="num">${p.salePrice > 0 && p.salePrice < p.price ? `<s class="sub">${money(p.price)}</s> ` : ''}<strong>${money(p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price)}</strong></td>
        <td class="num">${p.variants?.length || p.trackStock === false ? `<span class="${s <= 5 && p.trackStock !== false ? 'badge warn' : ''}">${p.trackStock === false ? '∞' : num(s)}</span>` : `<input class="input" style="width:84px;height:34px;text-align:right" type="number" min="0" value="${s}" data-stock="${esc(p.id)}" aria-label="${esc(t('Stock'))}">`}</td>
        <td><label class="switch"><input type="checkbox" data-active="${esc(p.id)}" ${p.active !== false ? 'checked' : ''} aria-label="${esc(t('Visible'))}"></label></td>
        <td class="num"><button class="ibtn" data-edit="${esc(p.id)}" aria-label="${esc(t('Edit'))}">${ic('edit')}</button> <button class="ibtn" data-del="${esc(p.id)}" aria-label="${esc(t('Delete'))}">${ic('trash')}</button></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No products yet.'))}</div>`}</div>`;
    $('#pf-q').oninput = debounce((e) => { PF.q = e.target.value; draw(); }, 150);
    $('#pf-c').onchange = (e) => { PF.cat = e.target.value; draw(); };
    $('#pf-s').onchange = (e) => { PF.st = e.target.value; draw(); };
    $('#pf-new').onclick = () => productDialog(null, load);
    if (keep) { const i = $('#pf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  el.onchange = async (e) => {
    const sid = e.target.dataset.stock, aid = e.target.dataset.active;
    if (sid) { const n = Math.max(0, Math.floor(Number(e.target.value) || 0)); await guard(e.target, async () => { await A.be.db.update('products', sid, { stock: n, updatedAt: Date.now() }); syncCat(); items.find((p) => p.id === sid).stock = n; toast(t('Saved')); }); }
    if (aid) await guard(e.target, async () => { await A.be.db.update('products', aid, { active: e.target.checked, updatedAt: Date.now() }); syncCat(); items.find((p) => p.id === aid).active = e.target.checked; toast(t('Saved')); });
  };
  el.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (ed) productDialog(items.find((p) => p.id === ed.dataset.edit), load);
    if (dl && await confirmBox(t('Delete this product?'))) { await guard(null, async () => { await A.be.db.remove('products', dl.dataset.del); syncCat(); toast(t('Deleted')); await load(); }); }
  };
  el.innerHTML = '<div class="skel" style="height:240px"></div>';
  await load();
  return () => { el.onclick = el.onchange = null; };
}

function productDialog(p, done) {
  const isNew = !p;
  const cur = JSON.parse(JSON.stringify(p || { name: '', nameBn: '', category: cats[0]?.slug || '', sku: '', price: '', salePrice: 0, stock: 10, trackStock: true, active: true, featured: false, images: [], description: '', descriptionBn: '', options: [], variants: [] }));
  const d = openDialog('');
  const draw = () => {
    d.el.innerHTML = `<form id="pform" novalidate><div class="dh"><h2>${esc(isNew ? t('Add product') : t('Edit product'))}</h2><button type="button" class="ibtn" data-close aria-label="${esc(t('Close'))}">${ic('x')}</button></div>
    <div class="db"><div class="form2">
      <div class="field"><label>${esc(t('Name'))} (EN) *</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="140" required></div>
      <div class="field"><label>${esc(t('Name'))} (বাংলা)</label><input class="input" name="nameBn" value="${esc(cur.nameBn || '')}" maxlength="140"></div>
      <div class="field"><label>${esc(t('Category'))}</label><select class="input" name="category"><option value="">—</option>${cats.map((c) => `<option value="${esc(c.slug)}" ${cur.category === c.slug ? 'selected' : ''}>${esc(pick(c, 'name'))}</option>`).join('')}</select></div>
      <div class="field"><label>SKU</label><input class="input" name="sku" value="${esc(cur.sku || '')}" maxlength="40"></div>
      <div class="field"><label>${esc(t('Price'))} *</label><input class="input" name="price" type="number" min="0" step="any" value="${esc(cur.price)}" required></div>
      <div class="field"><label>${esc(t('Sale price'))}</label><input class="input" name="salePrice" type="number" min="0" step="any" value="${cur.salePrice || ''}"><span class="hint">${esc(t('Leave empty for no sale'))}</span></div>
      <div class="field"><label>${esc(t('Stock'))}</label><input class="input" name="stock" type="number" min="0" value="${cur.stock ?? 0}" ${cur.variants.length ? 'disabled' : ''}><span class="hint">${esc(cur.variants.length ? t('Stock is set per variant below') : '')}</span></div>
      <div class="field" style="align-content:center;gap:12px"><label class="switch"><input type="checkbox" name="trackStock" ${cur.trackStock !== false ? 'checked' : ''}>${esc(t('Track stock'))}</label><label class="switch"><input type="checkbox" name="active" ${cur.active !== false ? 'checked' : ''}>${esc(t('Visible in shop'))}</label><label class="switch"><input type="checkbox" name="featured" ${cur.featured ? 'checked' : ''}>${esc(t('Featured on home page'))}</label></div>
      <div class="field full"><label>${esc(t('Photos'))} (${esc(t('up to 5'))})</label><div class="imgs">${cur.images.map((s, i) => `<div class="im"><img src="${esc(safeUrl(s))}" alt=""><button type="button" data-rmimg="${i}" aria-label="${esc(t('Remove'))}">×</button></div>`).join('')}${cur.images.length < 5 ? `<label class="add" title="${esc(t('Add photo'))}">${ic('plus')}<input type="file" accept="image/*" multiple hidden id="imgin"></label>` : ''}</div></div>
      <div class="field full"><label>${esc(t('Description'))} (EN)</label><textarea class="input" name="description" maxlength="2000">${esc(cur.description || '')}</textarea></div>
      <div class="field full"><label>${esc(t('Description'))} (বাংলা)</label><textarea class="input" name="descriptionBn" maxlength="2000">${esc(cur.descriptionBn || '')}</textarea></div>
      <div class="field full"><label>${esc(t('Options (size, color…)'))}</label>
        ${[0, 1].map((i) => `<div class="form2" style="margin-bottom:8px"><input class="input" data-oname="${i}" placeholder="${esc(i ? t('Option 2 name, e.g. Color') : t('Option 1 name, e.g. Size'))}" value="${esc(cur.options[i]?.name || '')}" maxlength="30"><input class="input" data-ovals="${i}" placeholder="${esc(t('Values separated by commas'))}" value="${esc((cur.options[i]?.values || []).join(', '))}"></div>`).join('')}
        <button type="button" class="btn ghost sm" id="genv">${esc(t('Build variants'))}</button>
        ${cur.variants.length ? `<div class="vgrid" style="margin-top:10px"><div class="vr h"><span>${esc(t('Variant'))}</span><span>${esc(t('Price (optional)'))}</span><span>${esc(t('Sale (optional)'))}</span><span>${esc(t('Stock'))}</span></div>${cur.variants.map((v, i) => `<div class="vr"><span>${esc(v.label)}</span><input class="input" type="number" min="0" step="any" data-vp="${i}" value="${v.price || ''}"><input class="input" type="number" min="0" step="any" data-vs="${i}" value="${v.salePrice || ''}"><input class="input" type="number" min="0" data-vk="${i}" value="${v.stock ?? 0}"></div>`).join('')}</div>` : ''}</div>
    </div><p class="err" id="perr" role="alert" hidden></p></div>
    <div class="df"><button type="button" class="btn ghost" data-close>${esc(t('Cancel'))}</button><button class="btn" id="psave">${esc(t('Save product'))}</button></div></form>`;
  };
  const readForm = () => {
    const f = d.el.querySelector('#pform'), fd = new FormData(f);
    for (const k of ['name', 'nameBn', 'category', 'sku', 'description', 'descriptionBn']) cur[k] = String(fd.get(k) ?? '').trim();
    cur.price = Number(fd.get('price')); cur.salePrice = Number(fd.get('salePrice')) || 0;
    if (!cur.variants.length) cur.stock = Math.max(0, Math.floor(Number(fd.get('stock')) || 0));
    cur.trackStock = fd.get('trackStock') === 'on'; cur.active = fd.get('active') === 'on'; cur.featured = fd.get('featured') === 'on';
    cur.variants.forEach((v, i) => {
      v.price = Number(d.el.querySelector(`[data-vp="${i}"]`).value) || 0;
      v.salePrice = Number(d.el.querySelector(`[data-vs="${i}"]`).value) || 0;
      v.stock = Math.max(0, Math.floor(Number(d.el.querySelector(`[data-vk="${i}"]`).value) || 0));
    });
  };
  const readOptions = () => [0, 1].map((i) => ({ name: d.el.querySelector(`[data-oname="${i}"]`).value.trim(), values: [...new Set(d.el.querySelector(`[data-ovals="${i}"]`).value.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 20) })).filter((o) => o.name && o.values.length);
  draw();
  d.el.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rmimg]');
    if (rm) { readForm(); cur.images.splice(Number(rm.dataset.rmimg), 1); draw(); }
    if (e.target.closest('#genv')) {
      readForm();
      const opts = readOptions();
      cur.options = opts;
      if (!opts.length) { cur.variants = []; return draw(); }
      const combos = opts.reduce((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v }))), [{}]).slice(0, 60);
      const old = new Map(cur.variants.map((v) => [v.label, v]));
      cur.variants = combos.map((c) => { const label = Object.values(c).join(' / '); return { ...(old.get(label) || { id: `v${uid(6)}`, price: 0, salePrice: 0, stock: 0 }), label, opts: c }; });
      draw();
    }
  });
  d.el.addEventListener('change', async (e) => {
    if (e.target.id !== 'imgin') return;
    readForm();
    for (const f of [...e.target.files].slice(0, 5 - cur.images.length)) {
      try { cur.images.push(await imageToDataUrl(f)); } catch { toast(t('That file is not a usable image'), 'err'); }
    }
    draw();
  });
  d.el.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    const err = d.el.querySelector('#perr');
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (cur.name.length < 2) return fail(t('Enter a product name'));
    if (!(cur.price > 0)) return fail(t('Enter a valid price'));
    if (cur.salePrice && cur.salePrice >= cur.price) return fail(t('Sale price must be lower than the price'));
    if (cur.options.length && !cur.variants.length) return fail(t('Press "Build variants" after adding options'));
    await guard(d.el.querySelector('#psave'), async () => {
      const now = Date.now();
      const fresh = isNew ? null : await A.be.db.get('products', p.id);
      const doc = { ...cur, shopId: A.shopId, sold: fresh?.sold || 0, createdAt: fresh?.createdAt || now, updatedAt: now };
      delete doc.id;
      doc.thumb = cur.images[0] ? await makeThumb(cur.images[0]) : '';
      const id = isNew ? `p_${uid(14)}` : p.id;
      await A.be.db.set('products', id, doc);
      syncCat();
      toast(t('Saved'));
      d.close();
      await done();
    });
  });
}

/* ---------------------------------------------------------------- categories */
export async function renderCategories(el) {
  const load = async () => { await loadCats(); draw(); };
  const draw = () => {
    el.innerHTML = `<div class="panel"><header><h2>${esc(t('Categories'))}</h2><button class="btn sm" id="c-new">${ic('plus')} ${esc(t('Add category'))}</button></header>
      ${cats.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(t('Name'))}</th><th>${esc(t('Name'))} (বাংলা)</th><th>${esc(t('Order'))}</th><th></th></tr></thead><tbody>${cats.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.nameBn || '')}</td><td>${num(c.order || 0)}</td><td class="num"><button class="ibtn" data-edit="${esc(c.id)}" aria-label="${esc(t('Edit'))}">${ic('edit')}</button> <button class="ibtn" data-del="${esc(c.id)}" aria-label="${esc(t('Delete'))}">${ic('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-row">${esc(t('No categories yet.'))}</div>`}</div>`;
    $('#c-new').onclick = () => catDialog(null);
  };
  const catDialog = (c) => {
    const d = openDialog(`<form id="cform"><div class="dh"><h2>${esc(c ? t('Edit category') : t('Add category'))}</h2></div><div class="db"><div class="field"><label>${esc(t('Name'))} (EN) *</label><input class="input" name="name" value="${esc(c?.name || '')}" maxlength="60" required></div><div class="field"><label>${esc(t('Name'))} (বাংলা)</label><input class="input" name="nameBn" value="${esc(c?.nameBn || '')}" maxlength="60"></div><div class="field"><label>${esc(t('Order'))}</label><input class="input" name="order" type="number" value="${c?.order ?? cats.length}"></div></div><div class="df"><button type="button" class="btn ghost" data-close>${esc(t('Cancel'))}</button><button class="btn">${esc(t('Save'))}</button></div></form>`, { narrow: true });
    d.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const slug = c?.slug || slugify(fd.name) || `c${uid(4)}`;
      await guard(e.target.querySelector('.btn:not(.ghost)'), async () => {
        await A.be.db.set('categories', c?.id || `${A.shopId}_${slug}`, { shopId: A.shopId, name: fd.name.trim(), nameBn: fd.nameBn.trim(), slug, order: Number(fd.order) || 0 });
        d.close(); toast(t('Saved')); await load();
      });
    };
  };
  el.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (ed) catDialog(cats.find((c) => c.id === ed.dataset.edit));
    if (dl && await confirmBox(t('Delete this category? Products keep working but lose their category.'))) await guard(null, async () => { await A.be.db.remove('categories', dl.dataset.del); await load(); });
  };
  el.innerHTML = '<div class="skel" style="height:160px"></div>';
  await load();
  return () => { el.onclick = null; };
}
