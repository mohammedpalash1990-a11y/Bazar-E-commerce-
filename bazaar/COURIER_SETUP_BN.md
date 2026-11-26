# কুরিয়ার অটো-বুকিং (Steadfast) চালু করার ধাপ

1. Steadfast মার্চেন্ট পোর্টালে লগইন করে **API কী** ও **সিক্রেট কী** নাও। যেখানে API ডকুমেন্ট আছে, সেখানে হেডারের নাম (`Api-Key`, `Secret-Key`) ও বেস URL (`https://portal.packzy.com/api/v1`) মিলিয়ে দেখো। না মিললে আমাকে জানাও।
2. Cloudflare → Pages → প্রজেক্ট → Settings → Variables and Secrets-এ তিনটি **Secret** যোগ করো:
   - `STEADFAST_API_KEY`
   - `STEADFAST_SECRET_KEY`
   - `STEADFAST_WEBHOOK_TOKEN` (নিজে একটা লম্বা র‍্যান্ডম লেখা বানাও, ৩২ অক্ষর বা বেশি)
3. Deployments → Retry deployment।
4. Steadfast পোর্টালের Webhook/Callback সেটিংসে:
   - URL: `https://আপনার-সাইট/api/courierWebhook`
   - Authorization: `Bearer` + ওই `STEADFAST_WEBHOOK_TOKEN`
5. অ্যাডমিনে অর্ডার "Confirmed" করে খুলো → **Send to Steadfast**। ট্র্যাকিং কোড নিজে বসবে, স্ট্যাটাস "Shipped" হবে, গ্রাহকের ট্র্যাক পেজে কোড দেখা যাবে।

**বোতামের আগে** "Check delivery record" চাপলে ওই ফোন নম্বরের আগের ডেলিভারি ও বাতিল সংখ্যা দেখা যায়।

**সীমা:** Steadfast "Delivered" পাঠালেই কেবল অর্ডার নিজে "Delivered" হয় (COD টাকা জমা ধরে)। বাতিল বা ফেরত অবস্থা অর্ডারের ইতিহাসে লেখা থাকে, কিন্তু স্টক ফেরত বা স্ট্যাটাস বদল আপনি নিজে করবেন।
