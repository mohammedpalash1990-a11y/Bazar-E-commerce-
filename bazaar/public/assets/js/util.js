// Small shared helpers: DOM, formatting, images, escaping.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// Only http(s) and our own data:image URLs may become <img src>; blocks javascript: and friends.
export const safeUrl = (u) => (/^(https:\/\/|data:image\/(png|jpe?g|webp|gif|svg\+xml);)/i.test(String(u || '')) ? String(u) : '');

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export function fmtNum(n, lang) {
  const s = Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return lang === 'bn' ? s.replace(/\d/g, (d) => BN_DIGITS[d]) : s;
}
export const fmtMoney = (n, sym, lang) => `${sym || '৳'}${fmtNum(Math.round((Number(n) || 0) * 100) / 100, lang)}`;
export function fmtDate(ts, lang, withTime = true) {
  if (!ts) return '';
  const d = new Date(ts);
  const o = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(o, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', o);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// Resize a picked image to a small WebP data URL so it fits inside a Firestore document (no paid Storage needed).
export function imageToDataUrl(file, max = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('not_image'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const out = c.toDataURL('image/webp', quality);
      resolve(out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
    img.src = url;
  });
}

export function uid(len = 12) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (x) => a[x % a.length]).join('');
}

export function inviteCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => a[x % a.length]).join('');
  return `${r.slice(0, 5)}-${r.slice(5)}`;
}

export function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // blocks spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};
