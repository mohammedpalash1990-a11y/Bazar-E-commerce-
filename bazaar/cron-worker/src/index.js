// Runs twice a day on Cloudflare's free plan (see wrangler.toml) and sends each opted-in shop a Telegram summary.
import { FirestoreStore } from '../../functions/_lib/firestore.js';
import { buildReport } from '../../public/shared/report.js';
import { isShopOpen } from '../../public/shared/core.js';

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

export async function runReports(env, now = Date.now()) {
  if (!env.TELEGRAM_BOT_TOKEN) return { sent: 0, skipped: 'no bot token' };
  const store = new FirestoreStore(env);
  const shops = (await store.query('shops', [])).filter((s) => s.notify?.telegramChatId && isShopOpen(s, now).ok);
  let sent = 0;
  for (const shop of shops) {
    try {
      const orders = await store.query('orders', [['shopId', '==', shop.id], ['createdAt', '>=', now - 30 * 86400000]], 1000);
      const products = await store.query('products', [['shopId', '==', shop.id]], 500);
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, shop.notify.telegramChatId, buildReport({ shop, orders, products, now }));
      sent += 1;
    } catch (e) { console.error('report failed for', shop.id, e.message); } // one broken shop must not stop the others
  }
  return { sent };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runReports(env, event.scheduledTime)); },
  async fetch() { return new Response('Bazaar cron worker. Nothing to see here.', { status: 404 }); },
};
