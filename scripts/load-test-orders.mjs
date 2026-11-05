// Eşzamanlı sipariş testi. YALNIZCA ayrı bir test projesinde çalışır, canlı projeye yazmayı reddeder.
//
//   LOAD_SUPABASE_URL=https://xxx.supabase.co LOAD_ANON_KEY=... LOAD_SERVICE_ROLE_KEY=... node scripts/load-test-orders.mjs
//
// Sınananlar: aynı anda gelen siparişlerde son porsiyon iki kişiye satılıyor mu, kupon hakkı aşılıyor mu,
// siparişler hatasız açılıyor mu ve süreler ne kadar uzuyor.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const LIVE_PROJECT_REF = 'sfjjtomxhlpgftibzxzi';
const URL_ = process.env.LOAD_SUPABASE_URL;
const ANON = process.env.LOAD_ANON_KEY;
const SERVICE = process.env.LOAD_SERVICE_ROLE_KEY;
const USERS = Number(process.env.LOAD_USERS ?? 30); // Auth varsayılanı: IP başına 5 dakikada 30 giriş.
const STOCK = 10;
const COUPON_USES = 5;

if (!URL_ || !ANON || !SERVICE) {
  console.error('LOAD_SUPABASE_URL, LOAD_ANON_KEY ve LOAD_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}
if (URL_.includes(LIVE_PROJECT_REF)) {
  console.error('Bu canlı proje. Test yalnızca ayrı bir test projesinde çalışır.');
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, options);
const run = randomUUID().slice(0, 8);
const must = ({ data, error }, step) => {
  if (error) throw new Error(`${step}: ${error.message}`);
  return data;
};

async function createUser(i, role) {
  const email = `yuk-${run}-${i}@example.com`;
  const password = randomUUID();
  const { user } = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'kullanıcı');
  must(await admin.from('users').upsert({ id: user.id, name: `Yük ${i}`, role, is_approved: true }), 'profil');
  const client = createClient(URL_, ANON, options);
  must(await client.auth.signInWithPassword({ email, password }), 'giriş');
  return { id: user.id, client };
}

function report(name, results) {
  const ok = results.filter(r => !r.error);
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const at = q => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * q))]);
  console.log(`${name}: ${ok.length}/${results.length} başarılı, p50 ${at(0.5)}ms, p95 ${at(0.95)}ms, en yavaş ${at(1)}ms`);
  const reasons = {};
  for (const r of results) if (r.error) reasons[r.error] = (reasons[r.error] ?? 0) + 1;
  if (Object.keys(reasons).length > 0) console.log('  hatalar:', reasons);
  return ok;
}

// Herkes aynı anda başlar: tek tek açılan bağlantılar yarış durumunu gizler.
const placeAll = (buyers, sellerId, itemId, couponCode) => Promise.all(buyers.map(async buyer => {
  const started = performance.now();
  const { data, error } = await buyer.client.rpc('place_order', {
    p_seller_id: sellerId,
    p_items: [{ menu_item_id: itemId, quantity: 1 }],
    p_delivery_address: 'Test Mah. Yük Sk. No:1',
    p_payment_method: 'cash',
    p_coupon_code: couponCode,
  });
  return { order: data, error: error?.message, ms: performance.now() - started };
}));

const closeOrders = async ok => {
  const ids = ok.map(r => r.order.id);
  if (ids.length > 0) must(await admin.from('orders').update({ status: 'cancelled' }).in('id', ids), 'kapatma');
};

const seller = await createUser('satici', 'seller');
const sellerRow = must(await admin.from('sellers').insert({ user_id: seller.id, display_name: `Yük ${run}`, is_active: true }).select().single(), 'restoran');
const addItem = async (title, dailyLimit) => must(await admin.from('menu_items')
  .insert({ seller_id: sellerRow.id, title, price_cents: 40000, daily_limit: dailyLimit, is_available: true }).select().single(), 'ürün');
const free = await addItem('Sınırsız', 0);
const limited = await addItem('Son porsiyonlar', STOCK);
const code = `YUK${run}`.toUpperCase();
const coupon = must(await admin.from('coupons').insert({ code, discount_type: 'fixed', discount_value: 1000, min_order_cents: 0, max_uses: COUPON_USES }).select().single(), 'kupon');

console.log(`${USERS} müşteri hazırlanıyor...`);
const buyers = [];
for (let i = 0; i < USERS; i++) buyers.push(await createUser(i, 'buyer'));

let failed = false;
const check = (label, pass, detail) => {
  console.log(`${pass ? 'GEÇTİ' : 'KALDI'}: ${label} (${detail})`);
  if (!pass) failed = true;
};

const plain = report('Aynı anda sipariş', await placeAll(buyers, sellerRow.id, free.id, null));
check('Her müşterinin siparişi açıldı', plain.length === USERS, `${plain.length}/${USERS}`);
await closeOrders(plain);

const stock = report('Sınırlı stok', await placeAll(buyers, sellerRow.id, limited.id, null));
check(`Stok aşılmadı (${STOCK})`, stock.length <= STOCK, `${stock.length} satıldı`);
await closeOrders(stock);

const couponRun = report('Sınırlı kupon', await placeAll(buyers, sellerRow.id, free.id, code));
const row = must(await admin.from('coupons').select('used_count').eq('id', coupon.id).single(), 'kupon okuma');
check(`Kupon hakkı aşılmadı (${COUPON_USES})`, couponRun.length <= COUPON_USES && row.used_count <= COUPON_USES, `${couponRun.length} sipariş, used_count ${row.used_count}`);
await closeOrders(couponRun);

process.exit(failed ? 1 : 0);
