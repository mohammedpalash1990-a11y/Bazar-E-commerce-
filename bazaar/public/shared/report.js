// Plain-text daily summary sent to the shop owner (Telegram). Pure function so it is easy to test.
import { money } from './core.js';

const BN = '০১২৩৪৫৬৭৮৯';
const bn = (n) => String(n).replace(/\d/g, (d) => BN[d]);
const fmt = (n, sym) => `${sym}${bn(Math.round(n).toLocaleString('en-US'))}`;
const totalStock = (p) => (p.variants?.length ? p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(p.stock) || 0);

export function buildReport({ shop, orders, products, now = Date.now(), hours = 24 }) {
  const sym = shop.currency || '৳';
  const since = now - hours * 3600000;
  const recent = orders.filter((o) => o.createdAt >= since);
  const live = recent.filter((o) => o.status !== 'cancelled' && o.status !== 'returned');
  const sales = live.reduce((s, o) => s + o.total, 0);
  const pending = orders.filter((o) => o.status === 'pending');
  const due = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'returned').reduce((s, o) => s + o.due, 0);
  const low = products.filter((p) => p.active !== false && p.trackStock !== false && totalStock(p) <= 5).sort((a, b) => totalStock(a) - totalStock(b));
  const lines = [
    `📊 ${shop.name}: দৈনিক রিপোর্ট`,
    `গত ${bn(hours)} ঘণ্টায় নতুন অর্ডার: ${bn(recent.length)}টি`,
    `বিক্রি: ${fmt(sales, sym)}`,
    `কনফার্মের অপেক্ষায়: ${bn(pending.length)}টি`,
    `এখনো আদায়যোগ্য: ${fmt(due, sym)}`,
  ];
  if (low.length) {
    lines.push('', `⚠️ স্টক কম (${bn(low.length)}টি):`);
    low.slice(0, 10).forEach((p) => lines.push(`• ${p.nameBn || p.name}: ${bn(totalStock(p))}টি বাকি`));
    if (low.length > 10) lines.push(`…আরও ${bn(low.length - 10)}টি`);
  }
  return lines.join('\n');
}
export { money };
