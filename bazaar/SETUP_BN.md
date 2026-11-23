# Bazaar: সেটআপ গাইড (একদম ফ্রিতে)

কোডের ভিতরে **অফলাইন ডেমো** আছে। `config.js` এ Firebase না দিলে সাইট ডেমো মোডে চলে (ডেটা শুধু ব্রাউজারে থাকে)। আসল দোকান চালাতে নিচের ধাপগুলো করুন।

## ১. Firebase (ডেটাবেস ও লগইন), ফ্রি Spark প্ল্যান
1. console.firebase.google.com এ নতুন প্রজেক্ট খুলুন (Google Analytics লাগবে না)।
2. **Build → Authentication → Get started → Email/Password** চালু করুন।
3. **Build → Firestore Database → Create database** (Production mode, লোকেশন `asia-southeast1` বা `asia-south1`)।
4. Firestore এর **Rules** ট্যাবে এই প্রজেক্টের `firestore.rules` ফাইলের পুরো লেখা পেস্ট করে **Publish** করুন।
5. **Project settings → General → Your apps → Web (</>)** এ অ্যাপ যোগ করুন। যে `firebaseConfig` দেখাবে, তার চারটি মান `public/assets/js/config.js` এর `firebase: {...}` এ বসান।
6. **Authentication → Settings → Authorized domains** এ আপনার সাইটের ডোমেইন (যেমন `আপনার-নাম.pages.dev`) যোগ করুন।
7. **Project settings → Service accounts → Generate new private key** চাপুন। একটি JSON ফাইল নামবে। **এটি কাউকে দেবেন না, GitHub এ রাখবেন না।**
8. প্রথমবার কোনো পেজে "index লাগবে" লিংকসহ এরর এলে লিংকে চাপ দিয়ে Create করুন (বা `firestore.indexes.json` ব্যবহার করুন)।

## ২. Cloudflare Pages (সাইট হোস্টিং), ফ্রি
1. কোডটি GitHub রিপোতে তুলুন (**ফোল্ডারসহ**: `public`, `functions`, `shared` ইত্যাদি। `functions` ফোল্ডার না থাকলে সিকিউর অর্ডার কাজ করবে না)।
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git। Build command **খালি**, Build output directory: `public`।
3. **Settings → Variables and Secrets** এ (Production) এগুলো যোগ করুন, সব **Secret** হিসেবে:
   - `FIREBASE_API_KEY`: ধাপ ১.৫ এর `apiKey`
   - `FIREBASE_SERVICE_ACCOUNT`: ধাপ ১.৭ এর JSON ফাইলের পুরো লেখা
   - `BOOTSTRAP_TOKEN`: নিজের বানানো লম্বা র‍্যান্ডম পাসওয়ার্ড (শুধু প্রথম সেটআপে লাগবে)
   - `TURNSTILE_SECRET`: (ঐচ্ছিক) নিচে ৪ নম্বর দেখুন
4. Secret যোগ করার পর একবার **Redeploy** করুন।

## ৩. প্রথম সেটআপ
1. `আপনার-সাইট/admin/` খুলুন, নিচে **First-time setup / প্রথমবার সেটআপ** চাপুন।
2. ইমেইল, পাসওয়ার্ড, `BOOTSTRAP_TOKEN` এর মান ও দোকানের নাম দিন। আপনি **প্ল্যাটফর্ম অ্যাডমিন** হয়ে যাবেন।
3. কাজ শেষে Cloudflare থেকে `BOOTSTRAP_TOKEN` মুছে দিন।
4. Settings এ লোগো, রং, ফোন, ডেলিভারি চার্জ, bKash/Nagad নম্বর দিন। Categories ও Products যোগ করুন।

## ৪. বট ঠেকানো (Cloudflare Turnstile), ফ্রি, ঐচ্ছিক কিন্তু ভালো
Cloudflare → Turnstile → নতুন সাইট। **Site key** বসান `config.js` এর `turnstileSiteKey` এ, আর **Secret key** বসান `TURNSTILE_SECRET` এ।

## ৫. একটি দোকান নাকি অনেক দোকান
- `config.js` এ `mode: 'single'` = একটিমাত্র দোকান (`defaultShop: 'main'`)।
- `mode: 'multi'` = অনেক দোকান। Admin → **Shops → New shop** থেকে দোকান খুলুন। প্রতিটির নিজের লিংক `/s/দোকানের-নাম/`, নিজের লোগো, রং, মালিক ও স্টাফ।
- মালিক/স্টাফ যোগ করতে **ইনভাইট কোড** দিন। তারা `/admin/` এ "I have an invite code" দিয়ে সাইন আপ করবে।
- সাবস্ক্রিপশন শেষ হলে বা Suspend করলে দোকানে অর্ডার বন্ধ হয়ে যায়। **+30 days** বোতামে মেয়াদ বাড়ান।

## ৬. দিনে ২ বার অটো রিপোর্ট (টেলিগ্রামে), ফ্রি
1. টেলিগ্রামে @BotFather থেকে বট বানিয়ে টোকেন নিন। বটকে একটা মেসেজ দিন, তারপর আপনার chat ID বের করুন (@userinfobot দিয়ে)।
2. Settings এ **Telegram chat ID** বসিয়ে Save করুন।
3. কম্পিউটারে (Node.js থাকলে): `cd cron-worker`, তারপর
   `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`, `npx wrangler secret put TELEGRAM_BOT_TOKEN`, শেষে `npx wrangler deploy`।
4. রোজ সকাল ৯টা ও রাত ৯টায় (বাংলাদেশ সময়) নতুন অর্ডার, বিক্রি, পেন্ডিং ও স্টক কমের রিপোর্ট আসবে। সময় বদলাতে `cron-worker/wrangler.toml` দেখুন।

## ৭. নিরাপত্তার চেকলিস্ট
- Cloudflare → Security → WAF → **Rate limiting rule** (ফ্রি এ ১টি): URL path `/api/` দিয়ে শুরু, ১০ সেকেন্ডে ২০টির বেশি রিকোয়েস্ট হলে ব্লক।
- Service account JSON আর `BOOTSTRAP_TOKEN` কোথাও পোস্ট করবেন না।
- স্টাফকে শুধু Staff ইনভাইট দিন। কুপন, রিপোর্ট ও সেটিংস শুধু মালিক দেখে।
- নিয়মিত Admin → Orders / Customers থেকে CSV নামিয়ে ব্যাকআপ রাখুন।

## ফ্রি লিমিট (Firebase Spark)
দিনে ৫০,০০০ রিড ও ২০,০০০ রাইট ফ্রি। শপ পেজ ৫ মিনিটের ক্যাশ ব্যবহার করে রিড বাঁচায়। ছবি ছোট করে ডেটাবেসেই রাখা হয়, তাই আলাদা Storage (পেইড) লাগে না। প্রতিটি পণ্যে সর্বোচ্চ ৫টি ছবি।

## যা এখনো নেই (সৎ কথা)
- bKash/Nagad এ **অটো পেমেন্ট গেটওয়ে নেই**। গ্রাহক নম্বরে টাকা পাঠিয়ে ট্রানজেকশন আইডি দেন, আপনি Admin থেকে "Receive payment" দিয়ে মিলিয়ে নেন।
- কুরিয়ার **অটো বুকিং নেই**। কুরিয়ারের নাম ও ট্র্যাকিং আইডি হাতে বসাতে হয় (Steadfast/Pathao এর API key পেলে যোগ করা যাবে)।
- এসএমএস/ইমেইল নোটিফিকেশন নেই (অর্ডার এলে অ্যাডমিন পেজে শব্দ ও টেলিগ্রাম রিপোর্ট আছে)।
