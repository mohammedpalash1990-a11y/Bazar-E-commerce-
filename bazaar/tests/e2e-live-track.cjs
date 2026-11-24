// Guest tracking updates by itself when the admin changes the status. Offline demo mode.
// Run: node tests/e2e-live-track.cjs <baseUrl>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => localStorage.setItem('bz_lang', 'en'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ok = (c, m) => { if (!c) errors.push('FAIL: ' + m); else console.log('ok -', m); };

  await page.goto(base + '/#/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  await page.locator('.card').first().click();
  await page.waitForSelector('.pdp');
  const opt = page.locator('[data-act=opt]').first();
  if (await opt.count()) await opt.click();
  await page.click('[data-act=add]');
  await page.click('[data-act=buy]');
  await page.waitForSelector('form[data-form=checkout]');
  await page.fill('#f-name', 'Live Test');
  await page.fill('#f-phone', '01712345678');
  await page.fill('#f-addr', 'House 1, Road 2');
  await page.fill('#f-dist', 'Dhaka');
  await page.click('#place');
  await page.waitForSelector('.seal');
  await page.click('text=Track order');
  await page.waitForSelector('#t-out .badge');
  const before = (await page.textContent('#t-out .badge')).trim();
  ok(/pending/i.test(before), 'tracking starts as Pending (' + before + ')');

  // Admin side: sign in as the demo owner and confirm the order.
  const res = await page.evaluate(async () => {
    const { initBackend } = await import('/assets/js/backend.js');
    const be = await initBackend();
    await be.auth.signIn('owner@demo.test', 'demo1234');
    const o = (await be.db.list('orders')).sort((x, y) => y.createdAt - x.createdAt)[0];
    await be.api('adminUpdateOrder', { id: o.id, action: 'status', status: 'confirmed' });
    return o.no;
  });
  ok(!!res, 'admin confirmed order ' + res);
  const t0 = Date.now();
  await page.waitForFunction(() => /confirmed/i.test(document.querySelector('#t-out .badge')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const after = (await page.textContent('#t-out .badge')).trim();
  ok(/confirmed/i.test(after), `customer page updated by itself to ${after} after ${((Date.now() - t0) / 1000).toFixed(1)}s, no refresh`);
  await browser.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('NO ERRORS');
})();
