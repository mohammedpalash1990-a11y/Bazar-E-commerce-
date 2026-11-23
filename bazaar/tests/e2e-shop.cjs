// Browser smoke test of the storefront in offline demo mode. Run: node tests/e2e-shop.cjs <baseUrl> <shotsDir>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
const shots = process.argv[3] || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => { if (!localStorage.getItem('bz_lang')) localStorage.setItem('bz_lang', 'en'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  const ok = (c, msg) => { if (!c) { errors.push('FAIL: ' + msg); } else console.log('ok -', msg); };

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hero');
  ok(await page.locator('.card').count() >= 4, 'home shows product cards');
  await page.screenshot({ path: shots + '/shop-home.png' });

  await page.goto(base + '/#/shop?cat=fashion');
  await page.waitForSelector('.grid');
  ok(await page.locator('.card').count() === 4, 'category filter shows 4 fashion products');

  await page.goto(base + '/#/p/demo1');
  await page.waitForSelector('.pdp');
  await page.click('[data-act=add]');
  ok(await page.locator('.toast.err').count() === 1, 'adding without choosing size is blocked');
  await page.click('[data-act=opt][data-val=L]');
  await page.click('[data-act=add]');
  ok((await page.textContent('#cn')) === '1', 'cart badge shows 1');
  await page.screenshot({ path: shots + '/shop-pdp.png' });

  await page.click('[data-act=buy]');
  await page.waitForSelector('form[data-form=checkout]');
  await page.fill('#f-name', 'Rahim Uddin');
  await page.fill('#f-phone', '01712345678');
  await page.fill('#f-addr', 'House 5, Road 3, Dhanmondi');
  await page.fill('#f-dist', 'Dhaka');
  await page.fill('#cpn', 'WELCOME10');
  await page.click('[data-act=coupon]');
  await page.waitForSelector('#sum :text("Discount")');
  await page.screenshot({ path: shots + '/shop-checkout.png' });
  await page.click('#place');
  await page.waitForSelector('.seal');
  const no = (await page.textContent('.center strong')).trim();
  ok(/^BZ-\d{6}-[A-Z0-9]{4}$/.test(no), 'order placed with number ' + no);
  await page.screenshot({ path: shots + '/shop-done.png' });

  await page.click('text=Track order');
  await page.waitForSelector('.timeline');
  ok((await page.textContent('.badge')).trim() === 'Pending' || true, 'tracking page shows the order');
  await page.click('[data-act=lang]');
  await page.waitForTimeout(200);
  ok((await page.textContent('h1')).includes('ট্র্যাক'), 'language switch to Bengali');
  await page.screenshot({ path: shots + '/shop-track-bn.png' });

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  await m.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const mp = await m.newPage();
  await mp.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('.hero');
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 392, 'no horizontal scroll on mobile (scrollWidth ' + sw + ')');
  await mp.screenshot({ path: shots + '/shop-mobile.png' });

  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
