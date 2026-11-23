// Demo data for the offline preview. Real (Firebase) installs start empty.
import { defaultShop } from '../../shared/handlers.js';

const PALETTES = [
  ['#E9E1C9', '#1B5E43', '#C9A24B'], ['#DDE8DD', '#0F3D2E', '#D8B66A'], ['#F1E7D0', '#2E6B50', '#B98B2F'],
  ['#E4EADF', '#174A36', '#C9A24B'], ['#EFE3C8', '#245C46', '#E0BE6B'],
];

// A quiet arch-and-sun composition; each product gets its own palette and motif so the demo grid looks lived-in.
export function art(seed, motif = 0) {
  const [bg, fg, gold] = PALETTES[seed % PALETTES.length];
  const shapes = [
    `<rect x="95" y="120" width="130" height="170" rx="14" fill="${fg}"/><rect x="115" y="90" width="90" height="50" rx="10" fill="${fg}"/><circle cx="160" cy="205" r="26" fill="${gold}"/>`,
    `<path d="M70 280 V170 a90 90 0 0 1 180 0 V280 Z" fill="${fg}"/><circle cx="160" cy="165" r="34" fill="${gold}"/>`,
    `<ellipse cx="160" cy="250" rx="86" ry="22" fill="${fg}"/><rect x="146" y="120" width="28" height="130" fill="${fg}"/><circle cx="160" cy="104" r="40" fill="${gold}"/>`,
    `<circle cx="160" cy="170" r="84" fill="${fg}"/><circle cx="160" cy="170" r="52" fill="none" stroke="${gold}" stroke-width="10"/>`,
    `<rect x="70" y="150" width="180" height="110" rx="18" fill="${fg}"/><path d="M110 150 q50 -80 100 0" fill="none" stroke="${gold}" stroke-width="12" stroke-linecap="round"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 360"><rect width="320" height="360" fill="${bg}"/><path d="M40 360 V150 a120 120 0 0 1 240 0 V360Z" fill="#fff" opacity=".35"/>${shapes[motif % shapes.length]}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function seedData(now = Date.now()) {
  const shop = { ...defaultShop('main', 'Demo Shop', now), about: 'A demo store showing every feature. Everything here is stored only in your browser.', announcement: 'Free delivery on orders above ৳3,000',
    contact: { phone: '01700000000', whatsapp: '01700000000', email: 'hello@example.com', address: 'Dhaka, Bangladesh' }, pay: { bkash: '01700000000', nagad: '' } };
  const cats = [
    ['fashion', 'Fashion', 'ফ্যাশন'], ['home', 'Home & Living', 'ঘর ও সংসার'], ['accessories', 'Accessories', 'এক্সেসরিজ'], ['food', 'Food & Gifts', 'খাবার ও উপহার'],
  ];
  const P = [
    ['Cotton Panjabi', 'কটন পাঞ্জাবি', 'fashion', 1890, 1590, 24, 0, ['M', 'L', 'XL']],
    ['Silk Kaftan', 'সিল্ক কাফতান', 'fashion', 3250, 0, 9, 1, ['S', 'M', 'L']],
    ['Linen Shirt', 'লিনেন শার্ট', 'fashion', 1450, 1190, 31, 2, ['M', 'L']],
    ['Handloom Saree', 'হ্যান্ডলুম শাড়ি', 'fashion', 4800, 0, 6, 3, null],
    ['Brass Table Lamp', 'পিতলের টেবিল ল্যাম্প', 'home', 2100, 0, 14, 2, null],
    ['Nakshi Kantha Throw', 'নকশি কাঁথা', 'home', 2750, 2400, 11, 1, null],
    ['Terracotta Vase', 'টেরাকোটা ফুলদানি', 'home', 890, 0, 40, 4, null],
    ['Leather Wallet', 'চামড়ার ওয়ালেট', 'accessories', 1250, 990, 52, 4, null],
    ['Jute Tote Bag', 'পাটের ব্যাগ', 'accessories', 690, 0, 80, 0, null],
    ['Wireless Earbuds', 'ওয়্যারলেস ইয়ারবাডস', 'accessories', 2490, 1990, 18, 3, null],
    ['Sundarbans Honey 500g', 'সুন্দরবনের মধু ৫০০ গ্রাম', 'food', 780, 0, 60, 2, null],
    ['Premium Dates 1kg', 'প্রিমিয়াম খেজুর ১ কেজি', 'food', 1150, 0, 3, 3, null],
  ];
  const data = { shops: { main: shop }, categories: {}, products: {}, coupons: {}, orders: {}, customers: {}, users: {}, invites: {} };
  cats.forEach(([id, name, nameBn], i) => { data.categories[`main_${id}`] = { shopId: 'main', name, nameBn, slug: id, order: i }; });
  P.forEach(([name, nameBn, cat, price, sale, stock, motif, sizes], i) => {
    const id = `demo${i + 1}`;
    const prod = {
      shopId: 'main', name, nameBn, category: cat, price, salePrice: sale, stock, trackStock: true, active: true, featured: i < 6,
      images: [art(i, motif), art(i + 2, (motif + 1) % 5)], sold: (i * 7) % 23, createdAt: now - i * 86400000,
      description: 'Carefully made and quality checked before it ships. Replace this text from the admin panel.',
      descriptionBn: 'যত্ন নিয়ে তৈরি এবং পাঠানোর আগে মান যাচাই করা। এই লেখা অ্যাডমিন প্যানেল থেকে বদলান।',
    };
    if (sizes) {
      prod.options = [{ name: 'Size', values: sizes }];
      prod.variants = sizes.map((s, k) => ({ id: `s${k}`, label: s, opts: { Size: s }, stock: Math.max(1, Math.floor(stock / sizes.length)) }));
    }
    data.products[id] = prod;
  });
  data.coupons.main_WELCOME10 = { shopId: 'main', code: 'WELCOME10', type: 'percent', value: 10, min: 1000, maxDiscount: 300, limit: 0, used: 0, active: true, expiresAt: 0 };
  return data;
}
