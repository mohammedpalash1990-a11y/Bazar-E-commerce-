// Multi-shop mode: directory page, per-shop branding, suspended shop. Run: node tests/e2e-multi.cjs <baseUrl> <shotsDir>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
const shots = process.argv[3] || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route('**/assets/js/config.js', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace("mode: 'single'", "mode: 'multi'") }); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('bz_lang')) localStorage.setItem('bz_lang', 'en'); });
  const errors = [];
  const ok = (c, m) => { if (!c) errors.push('FAIL: ' + m); else console.log('ok -', m); };
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.shopcard');
  ok((await p.locator('.shopcard').count()) === 1, 'directory lists the one active shop');
  // make a second shop with its own brand + suspend the first via storage, as the platform admin would
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('bz_demo_v1'));
    d.shops.rose = { ...d.shops.main, name: 'Rose Boutique', slug: 'rose', brand: { logo: '', tagline: 'Soft things', primary: '#7A2E4D', accent: '#D4A24C' } };
    d.products.r1 = { shopId: 'rose', name: 'Rose Scarf', price: 500, stock: 4, active: true, images: [], createdAt: 1 };
    localStorage.setItem('bz_demo_v1', JSON.stringify(d));
  });
  await p.goto(base + '/?shop=rose', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.hero');
  ok((await p.textContent('.hero h1')).includes('Soft things'), 'second shop shows its own tagline');
  ok((await p.locator('.card').count()) === 1, 'second shop shows only its own products');
  const prim = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  ok(prim.toLowerCase() === '#7a2e4d', 'brand colour applied (' + prim + ')');
  await p.screenshot({ path: shots + '/multi-rose.png' });
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('bz_demo_v1')); d.shops.rose.status = 'suspended'; localStorage.setItem('bz_demo_v1', JSON.stringify(d)); });
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.center');
  ok((await p.textContent('.center')).includes('closed'), 'suspended shop shows closed notice');
  await p.goto(base + '/?shop=nope', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.center');
  ok((await p.textContent('.center')).includes('not set up'), 'unknown shop handled');
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
