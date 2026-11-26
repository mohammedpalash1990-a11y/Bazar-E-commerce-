// A shared product link (/p/<id>) opens that product, and the Share button copies a clean link. Run: node tests/e2e-share.cjs <baseUrl>
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8788';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|www\.gstatic\.com/, (r) => r.abort());
  await ctx.addInitScript(() => localStorage.setItem('bz_lang', 'en'));
  const errors = [];
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.hs');
  await p.waitForTimeout(400);
  const id = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bz_demo_v1')).products)[0]);
  // The real server returns the shell with <meta name="bz-shop">; here we do the same by hand.
  const shell = (await (await fetch(base + '/')).text()).replace('</head>', '<meta name="bz-shop" content="main"></head>');
  await ctx.route(`${base}/p/*`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: shell }));
  await p.goto(`${base}/p/${id}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pdp');
  if (!p.url().endsWith(`/#/p/${id}`)) errors.push('FAIL: shared link did not turn into the app route: ' + p.url());
  await p.click('[data-act=share]');
  await p.waitForSelector('.toast');
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  if (clip !== `${base}/p/${id}`) errors.push('FAIL: copied link is ' + clip);
  console.log(errors.length ? errors.join('\n') : 'share: ok (' + id + ')');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
