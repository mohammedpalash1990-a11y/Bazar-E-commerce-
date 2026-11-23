import { CONFIG } from './config.js';
import { initBackend } from './backend.js';
import { t, getLang, setLang } from './i18n.js';
import { ic } from './icons.js';
import { $, esc, safeUrl } from './util.js';
import { isShopOpen } from '../../shared/core.js';
import { A, on, watchOrders, isOwner, isSuper, guard } from './admin-core.js';
import { renderDashboard, renderOrders } from './admin-orders.js';
import { renderProducts, renderCategories } from './admin-products.js';
import { renderCustomers, renderCoupons, renderReports, renderSettings, renderShops } from './admin-misc.js';

const PAGES = {
  dashboard: { title: 'Overview', icon: 'home', fn: renderDashboard, roles: ['staff', 'owner', 'super'] },
  orders: { title: 'Orders', icon: 'list', fn: renderOrders, roles: ['staff', 'owner', 'super'], badge: true },
  products: { title: 'Products', icon: 'box', fn: renderProducts, roles: ['staff', 'owner', 'super'] },
  categories: { title: 'Categories', icon: 'tag', fn: renderCategories, roles: ['staff', 'owner', 'super'] },
  customers: { title: 'Customers', icon: 'users', fn: renderCustomers, roles: ['staff', 'owner', 'super'] },
  coupons: { title: 'Coupons', icon: 'tag', fn: renderCoupons, roles: ['owner', 'super'] },
  reports: { title: 'Reports', icon: 'chart', fn: renderReports, roles: ['owner', 'super'] },
  settings: { title: 'Settings', icon: 'gear', fn: renderSettings, roles: ['owner', 'super'] },
  shops: { title: 'Shops', icon: 'store', fn: renderShops, roles: ['super'] },
};
let cleanup = null;
let be;

const AUTH_ERR = {
  'auth/invalid-credential': 'Wrong email or password', 'auth/wrong-password': 'Wrong email or password', 'auth/user-not-found': 'Wrong email or password', bad_credentials: 'Wrong email or password',
  'auth/email-already-in-use': 'email_in_use', email_in_use: 'email_in_use', 'auth/weak-password': 'Password must be at least 6 characters', weak_password: 'Password must be at least 6 characters',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes.', 'auth/invalid-email': 'Enter a valid email',
};
const authKey = (e) => AUTH_ERR[e.code] || null;
const authMsg = (e) => (authKey(e) && authKey(e) !== 'email_in_use' ? t(authKey(e)) : e.message || t('Something went wrong. Please try again.'));

/* ---------------------------------------------------------------- login */
function loginScreen(mode = 'in', note = '') {
  document.body.className = 'admin';
  const needs = { in: [], invite: ['code'], setup: ['token', 'shop'] }[mode];
  document.body.innerHTML = `<div class="login"><form class="box" id="lf" novalidate>
    <div class="arch-mark" aria-hidden="true"><i></i></div>
    <h1>${esc(mode === 'setup' ? t('First-time setup') : mode === 'invite' ? t('Join with an invite code') : t('Admin sign in'))}</h1>
    ${be.mode === 'demo' ? `<div class="note">${esc(t('Demo mode. Owner: owner@demo.test / demo1234. Platform admin: super@demo.test / demo1234'))}</div>` : ''}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="field"><label for="l-email">${esc(t('Email'))}</label><input class="input" id="l-email" name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="l-pw">${esc(t('Password'))}</label><input class="input" id="l-pw" name="password" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="6" required></div>
    ${needs.includes('code') ? `<div class="field"><label for="l-code">${esc(t('Invite code'))}</label><input class="input" id="l-code" name="code" placeholder="XXXXX-XXXXX" autocomplete="off" required></div>` : ''}
    ${needs.includes('token') ? `<div class="field"><label for="l-tok">${esc(t('Setup token'))}</label><input class="input" id="l-tok" name="token" type="password" autocomplete="off" required><span class="hint">${esc(t('The BOOTSTRAP_TOKEN secret you set in Cloudflare. Works only once.'))}</span></div><div class="field"><label for="l-shop">${esc(t('Shop name'))}</label><input class="input" id="l-shop" name="shop" maxlength="60"></div>` : ''}
    <p class="err" id="l-err" role="alert" hidden></p>
    <button class="btn block" type="submit">${esc(mode === 'in' ? t('Sign in') : t('Continue'))}</button>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13.5px">
      ${mode !== 'in' ? `<a href="#" data-m="in">${esc(t('Back to sign in'))}</a>` : `<a href="#" data-m="invite">${esc(t('I have an invite code'))}</a>`}
      ${mode === 'in' ? `<a href="#" data-m="setup">${esc(t('First-time setup'))}</a>` : ''}
      <a href="#" data-lang>${getLang() === 'bn' ? 'English' : 'বাংলা'}</a></div></form></div>`;
  $('#lf').onclick = (e) => {
    const m = e.target.closest('[data-m]'); const l = e.target.closest('[data-lang]');
    if (m) { e.preventDefault(); loginScreen(m.dataset.m); }
    if (l) { e.preventDefault(); setLang(getLang() === 'bn' ? 'en' : 'bn'); loginScreen(mode, note); }
  };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)), err = $('#l-err'), btn = e.target.querySelector('button[type=submit]');
    err.hidden = true;
    await guard(btn, async () => {
      try {
        if (mode === 'in') await be.auth.signIn(fd.email, fd.password);
        else {
          try { await be.auth.signUp(fd.email, fd.password); } catch (er) { if (authKey(er) === 'email_in_use') await be.auth.signIn(fd.email, fd.password); else throw er; }
          if (mode === 'invite') await be.api('claimInvite', { code: fd.code });
          else await be.api('bootstrap', { token: fd.token, shopName: fd.shop });
          await be.auth.refresh();
        }
        await start();
      } catch (er) { err.textContent = authMsg(er); err.hidden = false; }
    });
  };
}

function noAccess() {
  document.body.className = 'admin';
  document.body.innerHTML = `<div class="login"><div class="box"><div class="arch-mark" aria-hidden="true"><i></i></div><h1>${esc(t('No admin access'))}</h1><p>${esc(t('This account is not linked to a shop. Ask the shop owner for an invite code.'))}</p>
    <form id="cf" class="form"><div class="field"><label for="c-code">${esc(t('Invite code'))}</label><input class="input" id="c-code" name="code" placeholder="XXXXX-XXXXX" required></div><p class="err" id="c-err" hidden></p><button class="btn">${esc(t('Join'))}</button></form>
    <button class="btn ghost" id="so">${esc(t('Sign out'))}</button></div></div>`;
  $('#so').onclick = async () => { await be.auth.signOut(); loginScreen(); };
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    await guard(e.target.querySelector('button'), async () => {
      try { await be.api('claimInvite', { code: new FormData(e.target).get('code') }); await be.auth.refresh(); await start(); }
      catch (er) { const x = $('#c-err'); x.textContent = er.message; x.hidden = false; }
    });
  };
}

/* ---------------------------------------------------------------- shell */
function shell() {
  const u = A.user, sh = A.shop;
  const allowed = Object.entries(PAGES).filter(([, p]) => p.roles.includes(u.role));
  const unread = () => A.unread;
  const pending = A.orders.filter((o) => o.status === 'pending').length;
  document.body.className = 'admin';
  document.body.innerHTML = `<div class="shell"><aside class="side" id="side">
    <div class="brand">${sh?.brand?.logo ? `<img src="${esc(safeUrl(sh.brand.logo))}" alt="">` : ''}<span>${esc(sh?.name || CONFIG.platformName)}</span></div>
    ${isSuper() ? `<select class="input" id="shop-sw" aria-label="${esc(t('Shop'))}" style="margin:0 4px 8px;width:calc(100% - 8px)">${A.shops.map((s) => `<option value="${esc(s.id)}" ${s.id === A.shopId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    <nav aria-label="${esc(t('Main'))}">${allowed.map(([k, p]) => `<button class="nav" data-go="${k}">${ic(p.icon)}<span>${esc(t(p.title))}</span>${p.badge ? `<span class="pill" id="pend" ${pending ? '' : 'hidden'}>${pending}</span>` : ''}</button>`).join('')}</nav>
    <div class="sp"></div>
    <a class="nav" href="${CONFIG.mode === 'multi' && A.shopId ? `/s/${esc(A.shopId)}/` : '/'}" target="_blank" rel="noopener">${ic('store')}<span>${esc(t('View shop'))}</span></a>
    <div class="who">${esc(u.email)}<br><strong>${esc(t(u.role === 'super' ? 'Platform admin' : u.role === 'owner' ? 'Owner' : 'Staff'))}</strong></div>
    <button class="nav" id="logout">${ic('out')}<span>${esc(t('Sign out'))}</span></button></aside>
    <div><div class="top"><div style="display:flex;gap:10px;align-items:center"><button class="ibtn menu-btn" id="menu" aria-label="${esc(t('Menu'))}">${ic('menu')}</button><h1 id="ptitle"></h1></div>
      <div class="acts"><button class="ibtn" id="bell" aria-label="${esc(t('New orders'))}">${ic('bell')}<span class="dot" id="bdot" ${unread() ? '' : 'hidden'}></span></button><button class="btn ghost sm" id="lang">${getLang() === 'bn' ? 'EN' : 'বাং'}</button></div></div>
      ${sh && !isShopOpen(sh, Date.now()).ok ? `<div class="note" style="margin:16px 28px 0">${esc(t('This shop is closed to customers (suspended or subscription ended). Contact the platform admin.'))}</div>` : ''}
      <main class="content" id="view"></main></div></div>`;
  document.body.onclick = (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { location.hash = `#/${g.dataset.go}`; document.body.classList.remove('nav-open'); }
    if (e.target.closest('#menu')) document.body.classList.toggle('nav-open');
    if (e.target.closest('#bell')) { A.unread = 0; location.hash = '#/orders'; }
    if (e.target.closest('#lang')) { setLang(getLang() === 'bn' ? 'en' : 'bn'); shell(); route(); }
    if (e.target.closest('#logout')) be.auth.signOut();
  };
  const sw = $('#shop-sw');
  if (sw) sw.onchange = () => { A.switchShop(sw.value); };
}

async function route() {
  const key = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const page = PAGES[key] && PAGES[key].roles.includes(A.user.role) ? PAGES[key] : PAGES.dashboard;
  const k = PAGES[key] === page ? key : 'dashboard';
  cleanup?.(); cleanup = null;
  $$nav(k);
  $('#ptitle').textContent = t(page.title);
  document.title = `${t(page.title)} · ${A.shop?.name || CONFIG.platformName}`;
  if (!A.shopId && k !== 'shops') { $('#view').innerHTML = `<div class="panel"><div class="empty-row">${esc(t('No shop yet. Create one in Shops.'))}</div></div>`; return; }
  const el = $('#view');
  el.innerHTML = '';
  try { const c = await page.fn(el); if (typeof c === 'function') cleanup = c; } catch (e) { console.error(e); el.innerHTML = `<div class="panel"><div class="empty-row">${esc(e.message || t('Something went wrong. Please try again.'))}</div></div>`; }
}
function $$nav(k) { document.querySelectorAll('.nav[data-go]').forEach((n) => n.classList.toggle('on', n.dataset.go === k)); }

async function useShop(id) {
  A.shopId = id || '';
  A.shop = id ? await be.db.get('shops', id) : null;
  if (A.shop) A.shop.id = id;
  if (A.shop) { const b = A.shop.brand || {}; if (/^#[0-9a-f]{6}$/i.test(b.primary || '')) document.documentElement.style.setProperty('--primary', b.primary); }
  A.unread = 0;
  watchOrders();
}
A.switchShop = async (id) => { try { sessionStorage.setItem('bz_admin_shop', id); } catch { /* ignore */ } await useShop(id); shell(); route(); };
A.onShopChange = () => { shell(); route(); };

on('orders', () => {
  const p = $('#pend'), d = $('#bdot');
  const n = A.orders.filter((o) => o.status === 'pending').length;
  if (p) { p.textContent = n; p.hidden = !n; }
  if (d) d.hidden = !A.unread;
});

async function start() {
  A.user = be.auth.user;
  if (!A.user) return loginScreen();
  if (!['owner', 'staff', 'super'].includes(A.user.role)) return noAccess();
  if (isSuper()) {
    A.shops = (await be.db.list('shops')).sort((a, b) => a.name.localeCompare(b.name));
    let id = ''; try { id = sessionStorage.getItem('bz_admin_shop') || ''; } catch { /* ignore */ }
    if (!A.shops.some((s) => s.id === id)) id = A.shops[0]?.id || '';
    await useShop(id);
  } else {
    await useShop(A.user.shopId);
    if (!A.shop) return loginScreen('in', t('Your shop could not be found. Contact the platform admin.'));
  }
  shell();
  route();
}

window.addEventListener('hashchange', () => { if (A.user && $('#view')) route(); });
(async () => {
  be = await initBackend();
  A.be = be;
  await be.ready;
  be.auth.onChange((u) => { if (!u && A.user) { A.user = null; loginScreen(); } });
  start().catch((e) => { console.error(e); document.body.innerHTML = '<div style="padding:40px;font-family:system-ui">Could not start the admin panel. Please refresh.</div>'; });
})();
