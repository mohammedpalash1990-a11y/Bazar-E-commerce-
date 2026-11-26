// Lists the home page and every live product, read from the one-document catalogue snapshot of each shop.
import { FirestoreStore } from './_lib/firestore.js';
import { sitemapXml } from './_lib/seo.js';

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const store = new FirestoreStore(env);
  const shops = await store.query('shops', [], 50);
  const urls = [];
  for (const s of shops) {
    const cat = await store.get('catalog', s.id);
    for (const p of cat?.prods || []) urls.push(`${origin}/p/${encodeURIComponent(p.id)}`);
  }
  return new Response(sitemapXml(origin, urls), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=3600' } });
}
