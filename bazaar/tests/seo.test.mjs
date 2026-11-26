import test from 'node:test';
import assert from 'node:assert/strict';
import { productMeta, injectProduct, notFoundShell, sitemapXml } from '../functions/_lib/seo.js';

const SHELL = '<html><head><title>Shop</title>\n<meta name="description" content="Online shop">\n</head><body></body></html>';
const shop = { name: 'Zessora <b>', defaultLang: 'en' };
const P = { id: 'p_1', shopId: 'main', name: 'Shirt "Pro"', price: 1000, salePrice: 800, stock: 3, active: true, thumb: 'data:image/webp;base64,AA', updatedAt: 9, description: 'Soft\ncotton', ratingAvg: 4.5, ratingCount: 2 };

test('product page markup has title, preview tags, price and rating', () => {
  const m = productMeta('https://shop.test', P, shop);
  const html = injectProduct(SHELL, m);
  assert.match(html, /<title>Shirt &quot;Pro&quot; \| Zessora &lt;b&gt;<\/title>/);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
  assert.match(html, /rel="canonical" href="https:\/\/shop.test\/p\/p_1"/);
  assert.match(html, /og:image" content="https:\/\/shop.test\/api\/img\/p_1\?v=9"/);
  assert.match(html, /name="bz-shop" content="main"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(ld.offers.price, '800');
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.aggregateRating.reviewCount, '2');
});

test('markup cannot be broken out of by product text', () => {
  const evil = { ...P, name: '</script><script>alert(1)</script>', description: '"><img src=x onerror=alert(1)>' };
  const html = injectProduct(SHELL, productMeta('https://shop.test', evil, shop));
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('</script><script>'));
});

test('sold-out products say so, and products without reviews carry no rating', () => {
  const m = productMeta('https://s.test', { ...P, stock: 0, ratingCount: 0, thumb: '', images: [] }, shop);
  assert.match(m.tags, /OutOfStock/);
  assert.ok(!m.tags.includes('aggregateRating'));
  assert.ok(!m.tags.includes('og:image'));
});

test('unknown products are kept out of search results; sitemap lists urls safely', () => {
  assert.match(notFoundShell(SHELL), /noindex/);
  const x = sitemapXml('https://s.test', ['https://s.test/p/a&b']);
  assert.match(x, /<loc>https:\/\/s.test\/<\/loc>/);
  assert.match(x, /a&amp;b/);
});
