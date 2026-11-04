// Sipariş seçenekleri (033): kapıda yemek kartı, planlı sipariş, gelip alma, bahşiş.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';
import { orderBalanceCents, orderNetCents } from '../../lib/earnings.ts';
import { isOpenAt, istanbulClock } from '../../lib/date.ts';
import { MEAL_CARDS } from '../../lib/order-options.ts';
import { scheduleDays } from '../../lib/schedule-slots.ts';

let db;
let admin;
let buyer;

before(async () => {
  db = await createDb();
  // 035: aynı müşteriyle çok sayıda tamamlanmamış sipariş açılıyor, kapıda ödeme sınırı bu dosyanın konusu değil.
  await allowManyDoorOrders(db);
  admin = await user('admin');
  buyer = await user('buyer');
});

async function user(role = 'buyer') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

// Komisyon %8, teslimat ₺15 (₺150 üstü ücretsiz). Yemek ₺100: teslimat ücreti uygulanır.
async function seller({ price = 10000, columns = '', values = '' } = {}) {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active${columns ? `, ${columns}` : ''})
      VALUES ('${id}','${uid}','Restoran',true${values ? `, ${values}` : ''});
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',${price});
  `);
  return { uid, id, item };
}

const ADDRESS = 'Test Mah. Test Sok. No:1';
const lines = (s, quantity = 1) => JSON.stringify([{ menu_item_id: s.item, quantity }]);

/** `at` SQL ifadesidir: aynı sorguda now() place_order'daki ile aynı an olur, sınır tam denenir. */
function placeSql(o) {
  return `SELECT * FROM public.place_order(
    p_seller_id => $1::uuid, p_items => $2::jsonb, p_delivery_address => $3::text,
    p_payment_method => $4::text, p_coupon_code => $5::text, p_expected_total_cents => $6::integer,
    p_fulfillment => $7::text, p_tip_cents => $8::integer,
    p_scheduled_for => ${o.at ?? 'NULL'}
  )`;
}
const placeParams = (s, o) => [
  s.id, lines(s, o.quantity), o.address ?? ADDRESS, o.method ?? 'cash', o.coupon ?? null, o.expect ?? null,
  o.fulfillment ?? 'delivery', o.tip === undefined ? 0 : o.tip,
];
const place = (s, o = {}) => as(db, o.uid ?? buyer, placeSql(o), placeParams(s, o)).then((r) => r.rows[0]);
const placeFails = (s, o = {}) => failure(db, o.uid ?? buyer, placeSql(o), placeParams(s, o));

const row = async (id) => (await db.query(`SELECT * FROM public.orders WHERE id='${id}'`)).rows[0];
const advance = async (s, id, statuses) => {
  for (const st of statuses) await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${id}'`);
};
const deliver = (s, id) => advance(s, id, ['accepted', 'preparing', 'ready', 'delivered']);
const balances = async (id) => (await db.query(
  `SELECT public.order_net_cents(o) AS net, public.order_balance_cents(o) AS balance, public.order_open_amount_cents(o) AS open
     FROM public.orders o WHERE o.id='${id}'`)).rows[0];
const open = async (s) => (await db.query(`SELECT (public.seller_open_totals('${s.id}')).*`)).rows[0];
const settle = (s, cents) => as(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${cents}, 'havale')`);
const enableOnline = (on) => db.exec(`UPDATE public.app_config SET value='{"enabled": ${on}}' WHERE key='online_payment'`);
const payOnline = (id, cents) => as(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4)', [id, 'p1', '[]', cents]);

/** İstanbul takviminde `days` gün sonrası: tarih metni ve seller_hours gün numarası (0=Pazartesi). */
async function istanbulDay(days) {
  const { rows } = await db.query(`
    SELECT d::text AS date, extract(isodow FROM d)::int - 1 AS dow
      FROM (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date + ${days} AS d) x`);
  return rows[0];
}
const at = (date, time) => `'${date}T${time}:00+03:00'::timestamptz`;
/** Yalnızca verilen günler açık olur; hiç satır olmayan gün açık sayıldığı için diğerleri kapalı yazılır. */
async function setHours(s, open) {
  const values = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const hours = open[d];
    return hours
      ? `('${s.id}',${d},'${hours[0]}','${hours[1]}',true)`
      : `('${s.id}',${d},NULL,NULL,false)`;
  });
  await db.exec(`
    DELETE FROM public.seller_hours WHERE seller_id='${s.id}';
    INSERT INTO public.seller_hours (seller_id, day_of_week, open_time, close_time, is_open) VALUES ${values.join(',')};
  `);
}

describe('kapıda yemek kartı', () => {
  test('liste uygulamayla aynı, bilinmeyen kart reddedilir', async () => {
    const s = await seller();
    await as(db, s.uid, `UPDATE public.sellers SET meal_cards=$1 WHERE id='${s.id}'`, [MEAL_CARDS.map((c) => c.id)]);
    const { rows } = await db.query(`SELECT meal_cards FROM public.sellers WHERE id='${s.id}'`);
    assert.equal(rows[0].meal_cards.length, 5);
    assert.ok(await failure(db, s.uid, `UPDATE public.sellers SET meal_cards='{sahte}' WHERE id='${s.id}'`));
  });

  test('hiç kart kabul etmeyen satıcıda reddedilir', async () => {
    const s = await seller();
    const f = await placeFails(s, { method: 'meal_card_door' });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /yemek kartı kabul etmiyor/);
  });

  test('kabul eden satıcıda sipariş açılır, kapıda ödeme gibi bekler', async () => {
    const s = await seller({ columns: 'meal_cards', values: `'{multinet,edenred}'` });
    const o = await place(s, { method: 'meal_card_door' });
    assert.equal(o.payment_method, 'meal_card_door');
    assert.equal(o.status, 'pending');
    assert.equal(o.payment_status, 'pending');
  });

  test('hesapta kapıda kart ile aynı: para satıcıda, komisyon borcu kalır', async () => {
    const s = await seller({ columns: 'meal_cards', values: `'{pluxee}'` });
    const card = await place(s, { method: 'card_door' });
    const meal = await place(s, { method: 'meal_card_door' });
    await deliver(s, card.id);
    await deliver(s, meal.id);
    const a = await balances(card.id);
    const b = await balances(meal.id);
    assert.deepEqual(a, b);
    assert.equal(b.balance, -800);
    const sql = await row(meal.id);
    assert.equal(orderBalanceCents(sql), -800);
    assert.equal(sql.payment_status, 'pending', 'tahsilatı satıcı işaretler');
    const totals = await open(s);
    assert.equal(totals.balance_cents, -1600);
    const payout = await settle(s, -1600);
    assert.equal(payout.rows[0].amount_cents, -1600);
  });

  test('yemek kartıyla teslim işaretlenince ödeme alınmış sayılır', async () => {
    const s = await seller({ columns: 'meal_cards', values: `'{setcard}'` });
    const o = await place(s, { method: 'meal_card_door' });
    await advance(s, o.id, ['accepted', 'preparing', 'ready']);
    await as(db, s.uid, `UPDATE public.orders SET status='delivered', payment_status='paid' WHERE id='${o.id}'`);
    assert.equal((await row(o.id)).payment_status, 'paid');
  });
});

describe('planlı sipariş: zaman sınırları', () => {
  test('en erken tam 45 dakika sonrası', async () => {
    const s = await seller();
    const f = await placeFails(s, { at: `now() + interval '45 minutes' - interval '1 second'` });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /45 dakika/);
    const o = await place(s, { at: `now() + interval '45 minutes'` });
    assert.ok(o.scheduled_for);
    assert.equal(o.status, 'pending');
  });

  test('en geç tam 7 gün sonrası', async () => {
    const s = await seller();
    const f = await placeFails(s, { at: `now() + interval '7 days' + interval '1 second'` });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /7 gün/);
    assert.ok((await place(s, { at: `now() + interval '7 days'` })).scheduled_for);
  });

  test('geçmiş saat reddedilir', async () => {
    const s = await seller();
    assert.equal((await placeFails(s, { at: `now() - interval '1 hour'` }))?.code, '22023');
  });

  test('satıcı kapattıysa reddedilir', async () => {
    const s = await seller({ columns: 'accepts_scheduled', values: 'false' });
    const f = await placeFails(s, { at: `now() + interval '2 hours'` });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /ileri tarihli/);
    assert.equal((await place(s)).scheduled_for, null, 'normal sipariş etkilenmez');
  });

  test('varsayılan açıktır, planlı olmayan siparişte saat boş kalır', async () => {
    const s = await seller();
    const { rows } = await db.query(`SELECT accepts_scheduled, pickup_enabled, meal_cards FROM public.sellers WHERE id='${s.id}'`);
    assert.deepEqual(rows[0], { accepts_scheduled: true, pickup_enabled: false, meal_cards: [] });
    assert.equal((await place(s)).scheduled_for, null);
  });

  test('geçici kapanan restoran planlı sipariş de almaz', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.sellers SET is_paused=true WHERE id='${s.id}'`);
    const f = await placeFails(s, { at: `now() + interval '2 hours'` });
    assert.match(f.message, /kapalı/);
  });
});

describe('planlı sipariş: çalışma saatleri', () => {
  test('açılış dahil, kapanış hariç; açık olmayan gün reddedilir', async () => {
    const s = await seller();
    const target = await istanbulDay(2);
    await setHours(s, { [target.dow]: ['09:00', '20:00'] });

    for (const time of ['08:59', '20:00', '20:30']) {
      const f = await placeFails(s, { at: at(target.date, time) });
      assert.match(f?.message ?? '', /seçtiğin saatte kapalı/, time);
    }
    for (const time of ['09:00', '19:59']) {
      assert.ok((await place(s, { at: at(target.date, time) })).scheduled_for, time);
    }
    const next = await istanbulDay(3);
    assert.match((await placeFails(s, { at: at(next.date, '12:00') }))?.message ?? '', /seçtiğin saatte kapalı/);
  });

  test('şu an kapalı olması planlıyı engellemez, normal siparişi engeller', async () => {
    const s = await seller();
    const target = await istanbulDay(2);
    await setHours(s, { [target.dow]: ['09:00', '20:00'] });
    assert.match((await placeFails(s))?.message ?? '', /şu an kapalı/);
    assert.ok((await place(s, { at: at(target.date, '12:00') })).scheduled_for);
  });

  test('gece yarısını aşan saatler önceki günün saatine sayılır', async () => {
    const s = await seller();
    const target = await istanbulDay(2);
    const next = await istanbulDay(3);
    await setHours(s, { [target.dow]: ['18:00', '02:00'] });
    assert.ok((await place(s, { at: at(target.date, '18:00') })).scheduled_for);
    assert.ok((await place(s, { at: at(next.date, '01:30') })).scheduled_for);
    assert.ok(await placeFails(s, { at: at(target.date, '17:59') }));
    assert.ok(await placeFails(s, { at: at(next.date, '02:00') }));
  });

  test('sepetteki saat listesi sunucunun kuralıyla aynı', async () => {
    const s = await seller();
    const target = await istanbulDay(2);
    const next = await istanbulDay(3);
    await setHours(s, { [target.dow]: ['18:00', '02:00'], [next.dow]: ['11:30', '14:00'] });
    // İstemci, sunucunun okuduğu satırların aynısını görür.
    const { rows } = await db.query(`SELECT day_of_week, open_time, close_time, is_open FROM public.seller_hours WHERE seller_id='${s.id}'`);
    const days = scheduleDays((d) => isOpenAt(rows, istanbulClock(d)));
    const slots = days.flatMap((d) => d.slots);
    assert.ok(slots.length > 5);
    for (const slot of slots) {
      const { rows: r } = await db.query(`SELECT public.seller_open_at('${s.id}', $1::timestamptz) AS open`, [slot.iso]);
      assert.equal(r[0].open, true, slot.iso);
    }
    // Bir sonraki adım listede yoksa sunucu da kapalı demeli.
    const listed = new Set(slots.map((x) => x.iso));
    const first = new Date(slots[0].iso).getTime();
    for (let ms = first; ms < first + 3 * 86400000; ms += 1800000) {
      const iso = new Date(ms).toISOString();
      const { rows: r } = await db.query(`SELECT public.seller_open_at('${s.id}', $1::timestamptz) AS open`, [iso]);
      assert.equal(r[0].open, listed.has(iso), iso);
    }
    // İlk saat place_order'dan da geçer.
    assert.ok((await place(s, { at: `'${slots[0].iso}'::timestamptz` })).scheduled_for);
  });
});

describe('planlı sipariş: stok ve menü', () => {
  const limited = async (limit = 2) => {
    const s = await seller();
    await db.exec(`UPDATE public.menu_items SET daily_limit=${limit} WHERE id='${s.item}'`);
    return s;
  };
  const counter = async (s) => (await db.query(`SELECT sold_today FROM public.menu_items WHERE id='${s.item}'`)).rows[0].sold_today;

  test('günlük limitli ürün başka bir güne planlanamaz, sayaç değişmez', async () => {
    const s = await limited();
    const f = await placeFails(s, { at: `now() + interval '2 days'` });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /yalnızca bugün/);
    assert.equal(await counter(s), 0);
  });

  test('limitsiz ürün her güne planlanır, sayaca girmez', async () => {
    const s = await seller();
    await place(s, { at: `now() + interval '2 days'` });
    assert.equal(await counter(s), 0);
  });

  test('bugüne planlanan limitli ürün bugünün sayacından düşer, iptalde geri döner', async () => {
    const s = await limited(2);
    const { rows } = await db.query(`
      SELECT ((now() + interval '45 minutes') AT TIME ZONE 'Europe/Istanbul')::date = (now() AT TIME ZONE 'Europe/Istanbul')::date AS same_day`);
    const when = `now() + interval '45 minutes'`;
    if (!rows[0].same_day) {
      // Gece yarısına 45 dakikadan az kala çalışırsa saat yarına düşer: o zaman reddedilmelidir.
      assert.match((await placeFails(s, { at: when }))?.message ?? '', /yalnızca bugün/);
      return;
    }
    const o = await place(s, { at: when, quantity: 2 });
    assert.equal(await counter(s), 2);
    assert.match((await placeFails(s, { at: when }))?.message ?? '', /Stok yetersiz/);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal(await counter(s), 0);
  });

  test('haftalık menüde seçilen günün menüsüne bakılır', async () => {
    const s = await seller();
    const target = await istanbulDay(2);
    await db.exec(`
      UPDATE public.sellers SET uses_weekly_menu=true WHERE id='${s.id}';
      INSERT INTO public.weekly_menu (seller_id, menu_item_id, day_of_week) VALUES ('${s.id}','${s.item}',${target.dow});
    `);
    assert.ok((await place(s, { at: at(target.date, '12:00') })).scheduled_for);
    const other = await istanbulDay(3);
    assert.match((await placeFails(s, { at: at(other.date, '12:00') }))?.message ?? '', /seçtiğin günün menüsünde yok/);
    assert.match((await placeFails(s))?.message ?? '', /bugünkü menüde yok/, 'bugünün menüsünde yok');
  });
});

describe('planlı sipariş: onay süresi ve hatırlatma', () => {
  const expire = () => as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
  const notices = async (s, title) => (await db.query(
    `SELECT count(*)::int AS n FROM public.notifications WHERE user_id='${s.uid}' AND title='${title}'`)).rows[0].n;

  test('cevapsız planlı sipariş de normal süre sonunda iptal olur', async () => {
    const s = await seller();
    const o = await place(s, { at: `now() + interval '3 days'` });
    await db.exec(`UPDATE public.orders SET pending_since = now() - interval '31 minutes' WHERE id='${o.id}'`);
    await expire();
    const after = await row(o.id);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancel_reason, 'Satıcı zamanında yanıtlamadı');
  });

  test('yeni sipariş bildiriminde planlı saat yazar', async () => {
    const s = await seller();
    await place(s, { at: `now() + interval '3 days'` });
    const { rows } = await db.query(`SELECT body FROM public.notifications WHERE user_id='${s.uid}' AND title='Yeni sipariş'`);
    assert.match(rows[0].body, /için planlı/);
  });

  test('kabul edilen sipariş saatine bir saat kala satıcıya bir kez hatırlatılır', async () => {
    const s = await seller();
    const o = await place(s, { at: `now() + interval '50 minutes'` });
    const later = await place(s, { at: `now() + interval '3 days'` });
    await advance(s, o.id, ['accepted']);
    await advance(s, later.id, ['accepted']);
    await expire();
    await expire();
    assert.equal(await notices(s, 'Planlı sipariş yaklaşıyor'), 1);
    assert.ok((await row(o.id)).scheduled_reminded_at);
    assert.equal((await row(later.id)).scheduled_reminded_at, null);
  });
});

describe('gelip alma', () => {
  const pickupSeller = (extra = {}) => seller({
    columns: `pickup_enabled, delivery_fee_cents${extra.columns ? `, ${extra.columns}` : ''}`,
    values: `true, 2500${extra.values ? `, ${extra.values}` : ''}`,
    price: extra.price,
  });

  test('satıcı açmadıysa reddedilir', async () => {
    const s = await seller();
    const f = await placeFails(s, { fulfillment: 'pickup' });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /gelip alma yok/);
  });

  test('geçersiz teslim şekli reddedilir', async () => {
    const s = await pickupSeller();
    assert.equal((await placeFails(s, { fulfillment: 'kargo' }))?.code, '22023');
  });

  test('teslimat ücreti sıfır, adres yerine işaret yazılır', async () => {
    const s = await pickupSeller();
    const o = await place(s, { fulfillment: 'pickup', address: '', expect: 10000 });
    assert.equal(o.fulfillment, 'pickup');
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.total_cents, 10000);
    assert.equal(o.delivery_address, 'Gelip alınacak');
    const b = await balances(o.id);
    assert.equal(b.net, 10000 - 800);
  });

  test('teslimatta adres zorunlu kalır, varsayılan teslimat', async () => {
    const s = await pickupSeller();
    assert.equal((await placeFails(s, { address: '' }))?.code, '22023');
    const o = await place(s);
    assert.equal(o.fulfillment, 'delivery');
    assert.equal(o.delivery_fee_cents, 2500);
  });

  test('teslimat alanı denetlenmez', async () => {
    const s = await pickupSeller({ columns: 'latitude, longitude, delivery_radius_km', values: '41, 29, 1' });
    assert.equal((await placeFails(s))?.code, 'EVN02', 'teslimatta konum gerekir');
    assert.equal((await place(s, { fulfillment: 'pickup' })).fulfillment, 'pickup');
  });

  test('minimum sipariş geçerli', async () => {
    const s = await pickupSeller({ columns: 'min_order_cents', values: '20000' });
    const f = await placeFails(s, { fulfillment: 'pickup' });
    assert.match(f?.message ?? '', /Minimum sipariş/);
    assert.equal((await place(s, { fulfillment: 'pickup', quantity: 2 })).total_cents, 20000);
  });

  test('ücretsiz teslimat kuponu geçmez, kupon harcanmaz; yüzde kuponu geçer', async () => {
    const s = await pickupSeller();
    const free = `BEDAVA${s.id.slice(0, 6)}`.toUpperCase();
    const percent = `YUZDE${s.id.slice(0, 6)}`.toUpperCase();
    await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value, is_active) VALUES
      ('${free}','free_delivery',0,true),('${percent}','percent',10,true)`);
    const f = await placeFails(s, { fulfillment: 'pickup', coupon: free });
    assert.match(f?.message ?? '', /gelip almada geçerli değil/);
    const { rows } = await db.query(`SELECT used_count FROM public.coupons WHERE code='${free}'`);
    assert.equal(rows[0].used_count, 0);
    const o = await place(s, { fulfillment: 'pickup', coupon: percent });
    assert.equal(o.discount_cents, 1000);
    assert.equal(o.total_cents, 9000);
    assert.equal(o.platform_delivery_cents, 0);
  });

  test('kapıda seçenekleri geçerli, online da açılır', async () => {
    const s = await pickupSeller({ columns: 'meal_cards', values: `'{multinet}'` });
    for (const method of ['cash', 'card_door', 'meal_card_door']) {
      assert.equal((await place(s, { fulfillment: 'pickup', method })).payment_method, method);
    }
    await enableOnline(true);
    const o = await place(s, { fulfillment: 'pickup', method: 'online' });
    assert.equal(o.status, 'awaiting_payment');
    await enableOnline(false);
  });

  test('akış yola çıkmayı atlar, kurye konumu yazılamaz', async () => {
    const s = await pickupSeller();
    const o = await place(s, { fulfillment: 'pickup' });
    await advance(s, o.id, ['accepted', 'preparing', 'ready']);
    const ready = await row(o.id);
    assert.equal(ready.status, 'ready');
    const road = await failure(db, s.uid, `UPDATE public.orders SET status='out_for_delivery' WHERE id='${o.id}'`);
    assert.equal(road?.code, '42501');
    const adminRoad = await failure(db, admin, `UPDATE public.orders SET status='out_for_delivery' WHERE id='${o.id}'`);
    assert.equal(adminRoad?.code, '42501', 'yönetici de yola çıkaramaz');
    const courier = await failure(db, s.uid, 'SELECT public.update_courier_location($1,$2,$3)', [o.id, 41, 29]);
    assert.equal(courier?.code, '55000');
    await as(db, s.uid, `UPDATE public.orders SET status='delivered', payment_status='paid' WHERE id='${o.id}'`);
    const done = await row(o.id);
    assert.equal(done.status, 'delivered');
    assert.ok(done.delivered_at);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.order_courier_locations WHERE order_id='${o.id}'`);
    assert.equal(rows[0].n, 0);
  });

  test('teslimatlı sipariş eskisi gibi yola çıkar', async () => {
    const s = await pickupSeller();
    const o = await place(s);
    await advance(s, o.id, ['accepted', 'preparing', 'ready', 'out_for_delivery']);
    assert.equal((await row(o.id)).status, 'out_for_delivery');
  });

  test('müşteriye gelmesi söylenir', async () => {
    const s = await pickupSeller();
    const o = await place(s, { fulfillment: 'pickup' });
    await advance(s, o.id, ['accepted', 'preparing', 'ready']);
    const { rows } = await db.query(`SELECT title FROM public.notifications WHERE user_id='${buyer}' AND data->>'orderId'='${o.id}' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(rows[0].title, 'Siparişin hazır, gelip alabilirsin');
  });
});

describe('bahşiş', () => {
  test('toplama girer, komisyona girmez, tamamı satıcının', async () => {
    const s = await seller();
    const o = await place(s, { tip: 2000, expect: 13500 });
    assert.equal(o.tip_cents, 2000);
    assert.equal(o.total_cents, 13500);
    assert.equal(o.commission_cents, 800, 'komisyon yalnızca yemekten');
    await deliver(s, o.id);
    const b = await balances(o.id);
    assert.equal(b.net, 10000 + 1500 + 2000 - 800);
    assert.equal(b.balance, -800, 'kapıda bahşiş de satıcıda kalır, borç yalnızca komisyon');
    const sql = await row(o.id);
    assert.equal(orderNetCents(sql), b.net);
    assert.equal(orderBalanceCents(sql), b.balance);
  });

  test('beklenen tutar bahşişi içerir', async () => {
    const s = await seller();
    const f = await placeFails(s, { tip: 2000, expect: 11500 });
    assert.equal(f?.code, 'EVN01');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.orders WHERE seller_id='${s.id}'`);
    assert.equal(rows[0].n, 0);
  });

  test('sınırlar: eksi ve ₺500 üstü reddedilir, boş sıfırdır', async () => {
    const s = await seller();
    assert.equal((await placeFails(s, { tip: -1 }))?.code, '22023');
    assert.equal((await placeFails(s, { tip: 50001 }))?.code, '22023');
    assert.equal((await place(s, { tip: 50000 })).tip_cents, 50000);
    assert.equal((await place(s, { tip: null })).tip_cents, 0);
  });

  test('tablo kısıtı da aşımı engeller', async () => {
    const s = await seller();
    const o = await place(s);
    assert.ok(await failure(db, null, `UPDATE public.orders SET tip_cents=50001 WHERE id='${o.id}'`));
    assert.ok(await failure(db, null, `UPDATE public.orders SET tip_cents=-1 WHERE id='${o.id}'`));
    const p = await seller({ columns: 'pickup_enabled', values: 'true' });
    const po = await place(p, { fulfillment: 'pickup' });
    assert.ok(await failure(db, null, `UPDATE public.orders SET tip_cents=100 WHERE id='${po.id}'`));
  });

  test('gelip almada reddedilir', async () => {
    const s = await seller({ columns: 'pickup_enabled', values: 'true' });
    const f = await placeFails(s, { fulfillment: 'pickup', tip: 1000 });
    assert.equal(f?.code, '22023');
    assert.match(f.message, /bahşiş/);
  });

  test('platform indirimi bahşişi yemez', async () => {
    const s = await seller();
    const code = `TAM${s.id.slice(0, 6)}`.toUpperCase();
    await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value, is_active) VALUES ('${code}','fixed',100000,true)`);
    const o = await place(s, { coupon: code, tip: 1000 });
    assert.equal(o.discount_cents, 10000);
    assert.equal(o.total_cents, 1500 + 1000);
  });

  test('rapor: net bahşişi içerir, satış toplamı içermez', async () => {
    const s = await seller();
    const o = await place(s, { tip: 3000 });
    await deliver(s, o.id);
    const { rows } = await as(db, s.uid, `SELECT * FROM public.get_my_earnings(now() - interval '1 day', now() + interval '1 day')`);
    assert.equal(rows[0].tip_cents, 3000);
    assert.equal(rows[0].gross_cents, 11500);
    assert.equal(rows[0].net_cents, 11500 + 3000 - 800);
    assert.equal(rows[0].gross_cents + rows[0].tip_cents - rows[0].seller_discount_cents - rows[0].commission_cents, rows[0].net_cents);
    assert.equal(rows[0].collected_cents, 14500);
  });

  test('platform satış toplamına girmez', async () => {
    const before = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    const s = await seller();
    const o = await place(s, { tip: 4000 });
    await deliver(s, o.id);
    const after = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    assert.equal(Number(after.sales_cents) - Number(before.sales_cents), 11500);
    assert.equal(Number(after.commission_cents) - Number(before.commission_cents), 800);
  });

  test('sadakat puanı bahşişten kazanılmaz', async () => {
    const uid = await user('buyer');
    const s = await seller();
    const o = await place(s, { uid, tip: 5000 });
    await deliver(s, o.id);
    const { rows } = await db.query(`SELECT points, total_spent FROM public.loyalty WHERE user_id='${uid}'`);
    assert.equal(rows[0].points, 115);
    assert.equal(Number(rows[0].total_spent), 11500);
  });
});

describe('bahşiş: online ödeme ve iade', () => {
  test('ödenen tutar bahşişi içerir, satıcıya tamamı aktarılır', async () => {
    await enableOnline(true);
    const s = await seller();
    const o = await place(s, { method: 'online', tip: 2000 });
    assert.equal(o.total_cents, 13500);
    assert.ok(await failure(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4)', [o.id, 'p1', '[]', 11500]), 'bahşişsiz tutar kabul edilmez');
    await payOnline(o.id, 13500);
    assert.equal((await row(o.id)).status, 'pending');
    await deliver(s, o.id);
    const b = await balances(o.id);
    assert.equal(b.balance, 13500 - 800);
    assert.equal(orderBalanceCents(await row(o.id)), 13500 - 800);
    assert.equal((await open(s)).balance_cents, 12700);
    await enableOnline(false);
  });

  test('kesimden sonra iade: ters kayıt bahşişi de geri alır', async () => {
    await enableOnline(true);
    const s = await seller();
    const o = await place(s, { method: 'online', tip: 2000 });
    await payOnline(o.id, 13500);
    await deliver(s, o.id);
    await settle(s, 12700);
    assert.equal((await open(s)).order_count, 0);

    // İade onayı ödemeyi kuyruğa alır, para total_cents üzerinden geri ödenir.
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    const flagged = await row(o.id);
    assert.equal(flagged.payment_status, 'refund_pending');
    assert.equal(flagged.total_cents, 13500);
    assert.equal(flagged.tip_cents, 2000);

    assert.equal((await balances(o.id)).open, -12700, 'bahşiş dahil tamamı ters kayıt');
    await as(db, null, 'SELECT public.mark_order_refunded($1)', [o.id]);
    assert.equal((await open(s)).balance_cents, -12700);
    const reversal = await settle(s, -12700);
    assert.equal(reversal.rows[0].amount_cents, -12700);
    assert.equal((await open(s)).order_count, 0);
    await enableOnline(false);
  });

  test('kesimden önce iptal: bakiyeye hiç girmez, ödeme iadeye gider', async () => {
    await enableOnline(true);
    const s = await seller();
    const o = await place(s, { method: 'online', tip: 2000 });
    await payOnline(o.id, 13500);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    const after = await row(o.id);
    assert.equal(after.payment_status, 'refund_pending');
    assert.equal((await balances(o.id)).open, null);
    assert.equal((await open(s)).balance_cents, 0);
    await enableOnline(false);
  });

  test('kapıda ödenmiş sipariş iadesinde ters kayıt yalnızca komisyondur', async () => {
    const s = await seller();
    const o = await place(s, { tip: 2000 });
    await deliver(s, o.id);
    await settle(s, -800);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.equal((await balances(o.id)).open, 800);
  });
});

describe('seçenekler sonradan değişmez', () => {
  const tries = [
    ['fulfillment', `fulfillment='pickup'`],
    ['scheduled_for', `scheduled_for=now() + interval '1 day'`],
    ['scheduled_reminded_at', `scheduled_reminded_at=now()`],
    ['tip_cents', `tip_cents=0`],
  ];
  for (const [name, set] of tries) {
    test(`${name}: müşteri, satıcı ve yönetici değiştiremez`, async () => {
      const s = await seller();
      const o = await place(s, { tip: 1000 });
      for (const uid of [buyer, s.uid, admin]) {
        const f = await failure(db, uid, `UPDATE public.orders SET ${set} WHERE id='${o.id}'`);
        assert.equal(f?.code, '42501', `${name} ${uid}`);
      }
      assert.equal((await row(o.id)).tip_cents, 1000);
    });
  }

  test('satıcı başkasının seçeneklerini değiştiremez', async () => {
    const s = await seller();
    const other = await seller();
    await as(db, other.uid, `UPDATE public.sellers SET pickup_enabled=true WHERE id='${s.id}'`).catch(() => undefined);
    const { rows } = await db.query(`SELECT pickup_enabled FROM public.sellers WHERE id='${s.id}'`);
    assert.equal(rows[0].pickup_enabled, false);
  });

  test('satıcı kendi ayarlarını değiştirir', async () => {
    const s = await seller();
    await as(db, s.uid, `UPDATE public.sellers SET pickup_enabled=true, accepts_scheduled=false, meal_cards='{metropol}' WHERE id='${s.id}'`);
    const { rows } = await db.query(`SELECT pickup_enabled, accepts_scheduled, meal_cards FROM public.sellers WHERE id='${s.id}'`);
    assert.deepEqual(rows[0], { pickup_enabled: true, accepts_scheduled: false, meal_cards: ['metropol'] });
  });
});

describe('eski çağrılar', () => {
  test('yeni parametreler olmadan eski davranış sürer', async () => {
    const s = await seller();
    const { rows } = await as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)', [s.id, lines(s), ADDRESS]);
    assert.equal(rows[0].fulfillment, 'delivery');
    assert.equal(rows[0].scheduled_for, null);
    assert.equal(rows[0].tip_cents, 0);
    assert.equal(rows[0].total_cents, 11500);
    assert.equal(rows[0].payment_method, 'cash');
  });

  test('anon çağıramaz, yalnızca tek sürüm var', async () => {
    const { rows } = await db.query(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS client
        FROM pg_proc p WHERE proname='place_order'`);
    assert.deepEqual(rows, [{ anon: false, client: true }]);
  });
});
