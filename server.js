import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest } from './bazaar/functions/api/[[path]].js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'bazaar', 'public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');

// Security headers compatible with iframe embedding in AI Studio
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://www.gstatic.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://www.gstatic.com; frame-src https://challenges.cloudflare.com https://*.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  if (req.path.startsWith('/admin')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Runtime configuration endpoint (only enables Firebase mode when server credentials are also configured)
app.get('/api/config', (_req, res) => {
  const hasServerFirebase = Boolean(process.env.FIREBASE_API_KEY && process.env.FIREBASE_SERVICE_ACCOUNT);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    data: {
      firebase: hasServerFirebase
        ? {
            apiKey: process.env.FIREBASE_API_KEY || '',
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
            projectId: process.env.FIREBASE_PROJECT_ID || '',
            appId: process.env.FIREBASE_APP_ID || '',
          }
        : { apiKey: '', authDomain: '', projectId: '', appId: '' },
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
    },
  });
});

// Forward /api/* requests to the Cloudflare Pages Function handler
app.all('/api/*path', express.raw({ type: '*/*', limit: '128kb' }), async (req, res) => {
  try {
    const paramPath = req.params.path;
    const segments = Array.isArray(paramPath)
      ? paramPath.filter(Boolean)
      : String(paramPath || '').split('/').filter(Boolean);
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${proto}://${host}${req.originalUrl}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, v);
      }
    }

    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const body = hasBody && Buffer.isBuffer(req.body) ? req.body : undefined;
    const webReq = new Request(url, { method: req.method, headers, body });

    const webRes = await onRequest({
      request: webReq,
      env: process.env,
      params: { path: segments },
    });

    res.status(webRes.status);
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error('API adapter error:', err);
    res.status(500).json({ ok: false, error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
  }
});

// Multi-shop storefront rewrite matching public/_redirects (/s/* -> /index.html)
app.get(['/s', '/s/*splat'], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Static assets & HTML pages (/ and /admin/)
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bazaar listening on http://0.0.0.0:${PORT}`);
});
