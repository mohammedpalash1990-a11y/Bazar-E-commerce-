// English is the key; Bengali lives in strings.js. A missing Bengali entry falls back to English.
import { BN } from './strings.js';
import { CONFIG } from './config.js';

let current = (() => { try { return localStorage.getItem('bz_lang'); } catch { return null; } })() || CONFIG.defaultLang || 'bn';
export const getLang = () => current;
export function setLang(l) {
  current = l === 'en' ? 'en' : 'bn';
  try { localStorage.setItem('bz_lang', current); } catch { /* private mode */ }
  document.documentElement.lang = current;
}
export function t(key, vars) {
  let s = current === 'bn' && BN[key] ? BN[key] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
// Product/category names carry both languages; fall back to the other one if empty.
export const pick = (obj, field) => (current === 'bn' ? obj[`${field}Bn`] || obj[field] : obj[field] || obj[`${field}Bn`]) || '';
document.documentElement.lang = current;
