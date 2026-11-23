import { AppError } from '../../public/shared/core.js';

// Verifies a Firebase ID token through Google (accounts:lookup) and loads the role from users/{uid}.
export async function authenticate(request, env, store) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const idToken = h.slice(7);
  if (idToken.length < 100 || idToken.length > 4000) throw new AppError('bad_token', 'Invalid session', 401);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    // Keep the public response generic, but preserve Google's diagnostic in
    // Cloudflare Function logs so API-key and token failures can be distinguished.
    const detail = await res.json().catch(() => ({}));
    console.error('Firebase accounts:lookup failed', {
      httpStatus: res.status,
      errorStatus: detail?.error?.status || 'UNKNOWN',
      errorMessage: detail?.error?.message || 'No error message returned',
    });
    throw new AppError('bad_token', 'Your session expired. Please sign in again.', 401);
  }
  const u = (await res.json()).users?.[0];
  if (!u || u.disabled) throw new AppError('bad_token', 'Invalid session', 401);
  const profile = await store.get('users', u.localId);
  return { uid: u.localId, email: u.email || '', role: profile?.role || 'customer', shopId: profile?.shopId || '' };
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return; // feature is off until a secret is configured
  if (!token) throw new AppError('captcha_required', 'Please complete the security check', 400);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token).slice(0, 2100), remoteip: ip || '' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new AppError('captcha_failed', 'Security check failed. Please try again.', 400);
}
