// Hostile text in every user-controlled field must never execute. Run: node tests/e2e-xss.cjs <baseUrl>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
const PAY = '"><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => localStorage.setItem('bz_lang', 'en'));
  const errors = [];
  const p = await ctx.newPage();
  p.on('dialog', (d) => { errors.push('FAIL: a dialog opened: ' + d.message()); d.dismiss(); });
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.hero');
  await p.evaluate((PAY) => {
    const d = JSON.parse(localStorage.getItem('bz_demo_v1'));
    d.products.evil = { shopId: 'main', name: PAY, nameBn: PAY, price: 100, stock: 5, active: true, featured: true, category: 'fashion', description: PAY, descriptionBn: PAY, images: ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='], createdAt: Date.now() + 1000 };
    d.shops.main.announcement = PAY; d.shops.main.about = PAY; d.shops.main.name = PAY; d.shops.main.brand.logo = 'javascript:alert(1)'; d.shops.main.brand.tagline = PAY;
    d.categories.main_evil = { shopId: 'main', name: PAY, nameBn: PAY, slug: 'evil', order: 9 };
    localStorage.setItem('bz_demo_v1', JSON.stringify(d));
  }, PAY);
  for (const route of ['/#/', '/#/shop', '/#/p/evil', '/#/about', '/#/checkout']) { await p.goto(base + route); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(400); }
  await p.goto(base + '/#/p/evil'); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.pdp');
  await p.click('[data-act=buy]'); await p.waitForSelector('form[data-form=checkout]');
  await p.fill('#f-name', PAY); await p.fill('#f-phone', '01712345678'); await p.fill('#f-addr', PAY + ' long address'); await p.fill('#f-dist', PAY); await p.fill('#f-note', PAY);
  await p.click('#place'); await p.waitForSelector('.seal');
  await p.click('text=Track order'); await p.waitForSelector('.timeline');
  const a = await ctx.newPage();
  a.on('dialog', (d) => { errors.push('FAIL: a dialog opened in admin: ' + d.message()); d.dismiss(); });
  await a.goto(base + '/admin/', { waitUntil: 'domcontentloaded' });
  await a.fill('#l-email', 'owner@demo.test'); await a.fill('#l-pw', 'demo1234'); await a.click('button[type=submit]'); await a.waitForSelector('.stats');
  for (const g of ['orders', 'products', 'categories', 'customers', 'settings', 'reports', 'dashboard']) { await a.click(`[data-go=${g}]`); await a.waitForTimeout(500); }
  await a.click('[data-go=orders]'); await a.waitForSelector('tr[data-order]'); await a.click('tr[data-order]'); await a.waitForSelector('dialog[open] .due'); await a.waitForTimeout(300);
  for (const pg of [p, a]) if (await pg.evaluate(() => window.__xss)) errors.push('FAIL: script executed');
  const imgs = await p.evaluate(() => [...document.images].map((i) => i.src).filter((s) => /^(javascript|data:text)/i.test(s)));
  if (imgs.length) errors.push('FAIL: unsafe image src kept: ' + imgs);
  console.log(errors.length ? errors.join('\n') : 'ok - hostile text never executed; unsafe image URLs dropped');
  await browser.close(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
