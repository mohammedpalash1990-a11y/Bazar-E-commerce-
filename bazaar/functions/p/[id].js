// /p/<id>: the storefront page with this product's title, description, picture and price already in the HTML,
// so Google and the WhatsApp/Facebook link preview can read it. The app then opens the product as usual.
import { FirestoreStore } from '../_lib/firestore.js';
import { productMeta, injectProduct, notFoundShell } from '../_lib/seo.js';

const html = (body, status, cache) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache } });

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const id = String([].concat(params.id || [])[0] || '');
  const shellRes = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: { accept: 'text/html' } }));
  const shell = await shellRes.text();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return html(notFoundShell(shell), 404, 'no-store');

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(request); if (hit) return hit; }

  const store = new FirestoreStore(env);
  const p = await store.get('products', id);
  if (!p || p.active === false) return html(notFoundShell(shell), 404, 'public, max-age=60');
  const shop = await store.get('shops', p.shopId);
  const res = html(injectProduct(shell, productMeta(url.origin, { ...p, id }, shop)), 200, 'public, max-age=300, s-maxage=600');
  if (cache) await cache.put(request, res.clone());
  return res;
}
