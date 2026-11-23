# Progress and what is left

Done and tested: storefront, checkout (COD + manual bKash/Nagad), order tracking and customer cancel, accounts, wishlist,
admin (overview, orders with popup/invoice/80mm receipt, advance/due payments, courier, products with variants and photos,
categories, customers, coupons, reports, settings, staff invites), single/multi shop, platform admin (shops, plans, suspend, extend),
Bengali/English, Worker, Firestore rules, CSP headers, Telegram daily report worker.

Not verified against real services (needs the owner's own accounts): Firebase Auth/Firestore rules in the emulator or live project,
Cloudflare deploy, Turnstile, Telegram delivery. Worker logic IS tested against a fake Firestore REST server.

Ideas for next sessions: Steadfast/Pathao API booking, bKash/Nagad gateway API, reviews, product import from CSV, SMS.
