// Browser test of the admin panel in offline demo mode. Run: node tests/e2e-admin.cjs <baseUrl> <shotsDir>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
const shots = process.argv[3] || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => { if (!localStorage.getItem('bz_lang')) localStorage.setItem('bz_lang', 'en'); });
  const errors = [];
  const ok = (c, m) => { if (!c) errors.push('FAIL: ' + m); else console.log('ok -', m); };
  const watch = (p) => { p.on('pageerror', (e) => errors.push('pageerror: ' + e.stack.split('\n').slice(0,4).join(' | '))); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); }); };

  // 1. customer places an order
  const shop = await ctx.newPage(); watch(shop);
  await shop.goto(base + '/#/p/demo5', { waitUntil: 'domcontentloaded' });
  await shop.click('[data-act=buy]');
  await shop.waitForSelector('form[data-form=checkout]');
  await shop.fill('#f-name', 'Karim Hossain'); await shop.fill('#f-phone', '01811223344');
  await shop.fill('#f-addr', 'House 9, Road 4, Uttara'); await shop.fill('#f-dist', 'Dhaka');
  await shop.click('#place'); await shop.waitForSelector('.seal');
  const orderNo = (await shop.textContent('.center strong')).trim();

  // 2. owner signs in
  const p = await ctx.newPage(); watch(p);
  await p.goto(base + '/admin/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#lf');
  await p.fill('#l-email', 'owner@demo.test'); await p.fill('#l-pw', 'wrong');
  await p.click('button[type=submit]');
  await p.waitForSelector('#l-err:not([hidden])');
  ok(true, 'wrong password is rejected');
  await p.fill('#l-pw', 'demo1234'); await p.click('button[type=submit]');
  await p.waitForSelector('.stats');
  ok((await p.textContent('.stat .v')).trim() === '1', 'dashboard counts today\'s order');
  await p.screenshot({ path: shots + '/admin-dashboard.png' });

  // 3. order flow
  await p.click('[data-go=orders]');
  await p.waitForSelector('tr[data-order]');
  await p.click('tr[data-order]');
  await p.waitForSelector('dialog[open] .due');
  await p.screenshot({ path: shots + '/admin-order.png' });
  await p.click('[data-status=confirmed]');
  await p.waitForSelector('dialog[open] .badge:text("Confirmed")');
  ok(true, 'order confirmed');
  await p.fill('dialog [name=amount]', '500'); await p.click('dialog [data-f=pay] button');
  await p.waitForSelector('dialog[open] :text("Partial")');
  ok(true, 'advance payment recorded -> Partial');
  await p.fill('dialog [name=name]', 'Steadfast'); await p.fill('dialog [name=trackingId]', 'SF-1234');
  await p.click('dialog [data-f=courier] button');
  await p.waitForSelector('dialog :text("Courier: Steadfast")');
  ok(true, 'courier saved');
  await p.click('[data-status=shipped]'); await p.waitForSelector('dialog .badge:text("Shipped")');
  await p.click('[data-status=delivered]'); await p.waitForSelector('dialog .badge:text("Paid")');
  ok(true, 'delivered, COD collected -> Paid');
  await p.click('dialog [data-close]');

  // 4. products
  await p.click('[data-go=products]'); await p.waitForSelector('#pf-new');
  await p.click('#pf-new'); await p.waitForSelector('#pform');
  await p.fill('#pform [name=name]', 'Test Kurta'); await p.fill('#pform [name=price]', '1500'); await p.fill('#pform [name=salePrice]', '1200'); await p.fill('#pform [name=stock]', '7');
  await p.fill('[data-oname="0"]', 'Size'); await p.fill('[data-ovals="0"]', 'S, M'); await p.click('#genv');
  await p.waitForSelector('[data-vk="1"]'); await p.fill('[data-vk="0"]', '3'); await p.fill('[data-vk="1"]', '4');
  await p.click('#psave');
  await p.waitForSelector('tr:has-text("Test Kurta")');
  ok(true, 'product with variants created');
  await p.screenshot({ path: shots + '/admin-products.png' });

  // 5. category, coupon, report, settings
  await p.click('[data-go=categories]'); await p.waitForSelector('#c-new'); await p.click('#c-new');
  await p.fill('#cform [name=name]', 'Sale Corner'); await p.click('#cform .btn:not(.ghost)'); await p.waitForSelector('td:text("Sale Corner")');
  ok(true, 'category created');
  await p.click('[data-go=coupons]'); await p.waitForSelector('#cp-new'); await p.click('#cp-new');
  await p.fill('dialog [name=code]', 'eid50'); await p.fill('dialog [name=value]', '50'); await p.selectOption('dialog [name=type]', 'fixed');
  await p.click('dialog .btn:not(.ghost)'); await p.waitForSelector('.mono:text("EID50")');
  ok(true, 'coupon created');
  await p.click('[data-go=reports]'); await p.waitForSelector('.stats .v');
  ok((await p.locator('.stat .v').first().textContent()).includes('2'), 'report shows sales');
  await p.screenshot({ path: shots + '/admin-reports.png' });
  await p.click('[data-go=settings]'); await p.waitForSelector('#sform');
  await p.fill('#sform [name=tagline]', 'Fresh finds daily'); await p.click('#sform .btn'); await p.waitForSelector('.toast');
  await p.click('#inv-new'); await p.waitForSelector('dialog .codebox');
  ok(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test((await p.textContent('dialog .codebox')).trim()), 'staff invite code generated');
  await p.click('dialog [data-close]');
  await p.screenshot({ path: shots + '/admin-settings.png' });

  // 6. staff joins with the invite and cannot see owner pages
  const code = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bz_demo_v1')).invites).find((k) => !JSON.parse(localStorage.getItem('bz_demo_v1')).invites[k].used));
  await p.click('#logout'); await p.waitForSelector('#lf');
  await p.click('[data-m=invite]');
  await p.fill('#l-email', 'staff@demo.test'); await p.fill('#l-pw', 'staffpass1'); await p.fill('#l-code', code);
  await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  ok((await p.locator('[data-go=coupons]').count()) === 0 && (await p.locator('[data-go=settings]').count()) === 0, 'staff does not see coupons or settings');
  ok((await p.locator('[data-go=orders]').count()) === 1, 'staff sees orders');
  await p.goto(base + '/admin/#/settings'); await p.waitForSelector('#ptitle');
  ok((await p.textContent('#ptitle')).trim() === 'Overview', 'staff typing #/settings lands on Overview');
  await p.click('#logout');

  // 7. platform admin
  await p.waitForSelector('#lf'); await p.fill('#l-email', 'super@demo.test'); await p.fill('#l-pw', 'demo1234'); await p.click('button[type=submit]');
  await p.waitForSelector('.shell'); await p.click('[data-go=shops]'); await p.waitForSelector('#sh-new'); await p.click('#sh-new');
  await p.fill('dialog [name=name]', 'Rose Boutique');
  ok((await p.inputValue('dialog [name=slug]')) === 'rose-boutique', 'link name auto-filled from shop name');
  await p.click('dialog .btn:not(.ghost)'); await p.waitForSelector('dialog .codebox');
  ok(true, 'new shop created with owner invite');
  await p.click('dialog [data-close]');
  await p.screenshot({ path: shots + '/admin-shops.png' });

  // mobile admin
  const m = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await m.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const mp = await m.newPage();
  await mp.goto(base + '/admin/', { waitUntil: 'domcontentloaded' });
  await mp.fill('#l-email', 'owner@demo.test'); await mp.fill('#l-pw', 'demo1234'); await mp.click('button[type=submit]');
  await mp.waitForSelector('.stats');
  ok((await mp.evaluate(() => document.documentElement.scrollWidth)) <= 392, 'no horizontal scroll on mobile admin');
  await mp.screenshot({ path: shots + '/admin-mobile.png' });

  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
