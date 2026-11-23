// One Pages Function serves every /api/* call. All price, stock and permission decisions happen here.
import { AppError } from '../../public/shared/core.js';
import { handlers, NEEDS_AUTH } from '../../public/shared/handlers.js';
import { FirestoreStore } from '../_lib/firestore.js';
import { authenticate, verifyTurnstile } from '../_lib/auth.js';

const MAX_BODY = 64 * 1024;
const CAPTCHA_ON = new Set(['createOrder', 'trackOrder', 'customerCancel']);
const hits = new Map(); // per-isolate throttle; add a Cloudflare rate-limit rule for the real limit (see SETUP.md)

function throttled(key, limit, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > limit;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (e) => json({ ok: false, error: { code: e.code, message: e.message } }, e.status);

export async function onRequest({ request, env, params }) {
  try {
    const name = [].concat(params.path || []).join('/');
    if (name === 'health') return json({ ok: true });
    if (request.method !== 'POST') throw new AppError('method_not_allowed', 'POST only', 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new AppError('bad_origin', 'Cross-site requests are not allowed', 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new AppError('bad_type', 'JSON required', 415);
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    if (throttled(`all:${ip}`, 90, 60_000) || (name === 'createOrder' && throttled(`order:${ip}`, 12, 600_000))) {
      throw new AppError('rate_limited', 'Too many requests. Please wait a moment.', 429);
    }
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    if (!handler) throw new AppError('not_found', 'Unknown endpoint', 404);
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new AppError('too_large', 'Request too large', 413);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { throw new AppError('bad_json', 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('bad_json', 'Invalid JSON');

    const store = new FirestoreStore(env);
    const user = await authenticate(request, env, store);
    if (NEEDS_AUTH.has(name) && !user) throw new AppError('auth_required', 'Sign in required', 401);
    if (CAPTCHA_ON.has(name)) await verifyTurnstile(env, body.turnstile, ip);

    for (let attempt = 0; ; attempt++) {
      try {
        return json({ ok: true, data: await handler(store, { now: Date.now(), user }, body, env) });
      } catch (e) {
        if (e?.code === 'tx_aborted' && attempt < 3) continue; // another order touched the same stock
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    // Structured server-side diagnostics: never return internal details to the browser.
    console.error('api error', {
      endpoint: [].concat(params.path || []).join('/'),
      name: e?.name || 'Error',
      message: e?.message || 'Unknown error',
      stack: e?.stack || '',
    });
    return json({ ok: false, error: { code: 'server_error', message: 'Something went wrong. Please try again.' } }, 500);
  }
}
