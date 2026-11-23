# Bazaar

Free-to-host e-commerce for Bangladesh. One shop or many shops, Bengali + English, Cloudflare Pages + Firebase.
Setup (Bengali): [SETUP_BN.md](SETUP_BN.md).

```
public/             static site (storefront /, admin /admin/), _headers (CSP), _redirects (/s/shop-name)
  shared/           business rules used by BOTH the Worker and the offline demo (price, stock, coupons, order flow)
functions/api/      the only server code: Cloudflare Pages Function, validates every order on the server
cron-worker/        twice-daily Telegram report (own Worker with cron trigger)
firestore.rules     who can read/write what
tests/              unit tests, Worker-vs-fake-Firestore tests, browser tests
```

Run locally (offline demo, no accounts needed): `node tests/serve.mjs` then open http://localhost:8788 and /admin/ (owner@demo.test / demo1234).
Tests: `npm test` (unit + Worker), `npm run e2e` (browser; needs Playwright and the server running).

## Security model in one paragraph
Browsers never create orders. They call `/api/createOrder`; the Worker re-reads prices and stock from Firestore, applies the coupon, checks the shop is active, and writes the order, stock, coupon count and customer in one Firestore transaction. Firestore rules forbid direct writes to orders, customers, stock counters and roles. Admin actions (status, payment, courier) also go through the Worker, which checks the signed-in user's role and shop. All user text is HTML-escaped, image URLs are allow-listed, and a strict CSP blocks inline scripts.
