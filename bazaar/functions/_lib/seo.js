// Search-engine and link-preview markup for product pages. Pure functions: they take plain data and return strings.
import { productUnitPrice } from '../../public/shared/core.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const oneLine = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// JSON inside <script type="application/ld+json"> must not be able to close the tag.
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const inStock = (p) => {
  if (p.trackStock === false) return true;
  if (Array.isArray(p.variants) && p.variants.length) return p.variants.some((v) => Number(v.stock) > 0);
  return Number(p.stock) > 0;
};

export function productMeta(origin, p, shop) {
  const lang = shop?.defaultLang === 'en' ? 'en' : 'bn';
  const name = oneLine((lang === 'bn' && p.nameBn) || p.name, 120);
  const shopName = oneLine(shop?.name, 60);
  const desc = oneLine((lang === 'bn' && p.descriptionBn) || p.description || `${name} - ${shopName}`, 160);
  const url = `${origin}/p/${encodeURIComponent(p.id)}`;
  const image = p.thumb || p.images?.[0] ? `${origin}/api/img/${encodeURIComponent(p.id)}?v=${Number(p.updatedAt) || 0}` : '';
  const price = productUnitPrice(p, null);
  const available = inStock(p);
  const data = {
    '@context': 'https://schema.org', '@type': 'Product', name, description: desc, sku: p.sku || p.id,
    ...(image ? { image: [image] } : {}),
    offers: { '@type': 'Offer', url, priceCurrency: 'BDT', price: String(price), availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`, itemCondition: 'https://schema.org/NewCondition' },
    ...(Number(p.ratingCount) > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: String(p.ratingAvg), reviewCount: String(p.ratingCount) } } : {}),
  };
  const title = shopName ? `${name} | ${shopName}` : name;
  const tags = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="bz-shop" content="${esc(p.shopId)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="${esc(shopName)}">`,
    `<meta property="og:title" content="${esc(name)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta property="product:price:amount" content="${esc(price)}">`,
    `<meta property="product:price:currency" content="BDT">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<script type="application/ld+json">${ld(data)}</script>`,
  ].filter(Boolean).join('\n');
  return { title, tags };
}

// Puts the product title and tags into the storefront shell (which has one <title> and one description meta).
export function injectProduct(shellHtml, meta) {
  return shellHtml
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', () => `${meta.tags}\n</head>`);
}

export function notFoundShell(shellHtml) {
  return shellHtml.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
}

export function sitemapXml(origin, urls) {
  const items = [`${origin}/`, ...urls].map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}
