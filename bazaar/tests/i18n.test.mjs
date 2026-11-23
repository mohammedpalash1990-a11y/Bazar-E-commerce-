import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { BN } from '../public/assets/js/strings.js';

const dir = new URL('../public/assets/js/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^(shop|admin.*)\.js$/.test(f));
// Keys that are looked up dynamically (status labels, page titles, ...) and so can't be found by scanning t('...').
const DYNAMIC = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Overview', 'Orders', 'Products', 'Categories', 'Customers', 'Coupons', 'Reports', 'Settings', 'Shops',
  'Platform admin', 'Owner', 'Staff', 'Expired', 'Suspended', 'All time', 'Today', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'Custom', 'Paid', 'Partial', 'Unpaid', 'Wrong email or password',
  'Password must be at least 6 characters', 'Too many attempts. Please wait a few minutes.', 'Enter a valid email'];

test('every English UI string has a Bengali translation', () => {
  const missing = new Set();
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\((['"])((?:[^'"\\]|\\.)*)\1/g)) {
      const key = m[2].replace(/\\'/g, "'");
      if (!BN[key]) missing.add(`${f}: ${key}`);
    }
  }
  for (const k of DYNAMIC) if (!BN[k]) missing.add(`dynamic: ${k}`);
  assert.deepEqual([...missing], []);
});

test('placeholders match between English and Bengali', () => {
  const bad = Object.entries(BN).filter(([k, v]) => JSON.stringify(k.match(/\{\w+\}/g)?.sort() || []) !== JSON.stringify(v.match(/\{\w+\}/g)?.sort() || []));
  assert.deepEqual(bad.map(([k]) => k), []);
});
