// Keşif (034): planlı siparişin yanıt süresi restoran açıkken işler; yemek etiketleri.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
let buyer;

before(async () => {
  db = await createDb();
  // 035: aynı müşteriyle çok sayıda tamamlanmamış sipariş açılıyor, kapıda ödeme sınırı bu dosyanın konusu değil.
  await allowManyDoorOrders(db);
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

async function seller() {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

/**
 * Bütün günlere aynı saatler, şu ana göre dakika farkıyla. Gün aynı olduğu için testin çalıştığı saat
 * önemsizdir: gece yarısını aşan aralıkları seller_open_at zaten destekler.
 */
async function setHoursAround(s, fromMin, toMin) {
  const { rows } = await db.query(`
    SELECT to_char(now() AT TIME ZONE 'Europe/Istanbul' + make_interval(mins => $1::int), 'HH24:MI') AS a,
           to_char(now() AT TIME ZONE 'Europe/Istanbul' + make_interval(mins => $2::int), 'HH24:MI') AS b`, [fromMin, toMin]);
  const values = [0, 1, 2, 3, 4, 5, 6].map((d) => `('${s.id}',${d},'${rows[0].a}','${rows[0].b}',true)`);
  await db.exec(`
    DELETE FROM public.seller_hours WHERE seller_id='${s.id}';
    INSERT INTO public.seller_hours (seller_id, day_of_week, open_time, close_time, is_open) VALUES ${values.join(',')};
  `);
}
const closedNow = (s) => setHoursAround(s, 60, 120);
const openFor = (s, minutes) => setHoursAround(s, -minutes, 120);

/** Siparişi her zaman açık restorana verir, sonra saatleri ve süreleri teste göre kurar: place_order ayrı denenir. */
async function pendingOrder(s, { scheduledFor = `now() + interval '3 days'`, pendingMinutes = 0 } = {}) {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO public.orders (id, customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
                               delivery_address, payment_method, payment_status, scheduled_for)
    VALUES ('${id}','${buyer}','${s.id}','pending',10000,0,10000,'TRY','Test Mah. No:1','cash','pending',${scheduledFor ?? 'NULL'});
    UPDATE public.orders SET pending_since = now() - make_interval(mins => ${pendingMinutes}) WHERE id='${id}';
  `);
  return id;
}

const expire = () => as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
const row = async (id) => (await db.query(`SELECT * FROM public.orders WHERE id='${id}'`)).rows[0];
const reminders = async (s) => (await db.query(
  `SELECT count(*)::int AS n FROM public.notifications WHERE user_id='${s.uid}' AND title='Bekleyen siparişin var'`)).rows[0].n;

describe('planlı sipariş: restoran kapalıyken', () => {
  test('gece verilen sipariş saatlerce beklese de iptal olmaz, hatırlatılmaz', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { pendingMinutes: 8 * 60 });
    await expire();
    assert.equal((await row(o)).status, 'pending');
    assert.equal((await row(o)).pending_reminded_at, null);
    assert.equal(await reminders(s), 0);
  });

  test('place_order ile kapalıyken verilen gerçek sipariş de beklemede kalır', async () => {
    const s = await seller();
    await closedNow(s);
    const { rows } = await as(db, buyer, `SELECT * FROM public.place_order(
      p_seller_id => $1::uuid, p_items => $2::jsonb, p_delivery_address => 'Test Mah. No:1',
      p_scheduled_for => (date_trunc('minute', now()) + interval '1 day' + interval '90 minutes')
    )`, [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }])]);
    await db.exec(`UPDATE public.orders SET pending_since = now() - interval '45 minutes' WHERE id='${rows[0].id}'`);
    await expire();
    assert.equal((await row(rows[0].id)).status, 'pending');
  });
});

describe('planlı sipariş: restoran açıldıktan sonra', () => {
  test('yeni açılmış restoranda iptal olmaz: son 30 dakikanın tamamı açık olmalı', async () => {
    const s = await seller();
    await openFor(s, 20);
    const o = await pendingOrder(s, { pendingMinutes: 8 * 60 });
    await expire();
    assert.equal((await row(o)).status, 'pending');
  });

  test('30 dakikadır açıksa ve sipariş 30 dakikadan eskiyse iptal olur', async () => {
    const s = await seller();
    await openFor(s, 40);
    const o = await pendingOrder(s, { pendingMinutes: 8 * 60 });
    await expire();
    const after = await row(o);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancel_reason, 'Satıcı zamanında yanıtlamadı');
  });

  test('restoran uzun süredir açık ama sipariş 30 dakikadan yeniyse iptal olmaz', async () => {
    const s = await seller();
    await openFor(s, 300);
    const o = await pendingOrder(s, { pendingMinutes: 20 });
    await expire();
    assert.equal((await row(o)).status, 'pending');
  });

  test('online ödenmiş ve süresi dolmuş sipariş iade kuyruğuna girer', async () => {
    const s = await seller();
    await openFor(s, 40);
    const o = await pendingOrder(s, { pendingMinutes: 60 });
    await db.exec(`UPDATE public.orders SET payment_method='online', payment_status='paid' WHERE id='${o}'`);
    await expire();
    const after = await row(o);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.payment_status, 'refund_pending');
  });

  test('kabul edilmiş sipariş etkilenmez', async () => {
    const s = await seller();
    await openFor(s, 40);
    const o = await pendingOrder(s, { pendingMinutes: 60 });
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o}'`);
    await expire();
    assert.equal((await row(o)).status, 'accepted');
  });
});

describe('planlı sipariş: saatine 15 dakikadan az kaldıysa', () => {
  test('restoran kapalıyken de iptal olur', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { scheduledFor: `now() + interval '14 minutes'`, pendingMinutes: 5 });
    await expire();
    const after = await row(o);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancel_reason, 'Satıcı zamanında yanıtlamadı');
  });

  test('saati geçmiş sipariş de iptal olur', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { scheduledFor: `now() - interval '5 minutes'`, pendingMinutes: 5 });
    await expire();
    assert.equal((await row(o)).status, 'cancelled');
  });

  test('15 dakikadan fazla varsa bu kural çalışmaz', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { scheduledFor: `now() + interval '16 minutes'`, pendingMinutes: 5 });
    await expire();
    assert.equal((await row(o)).status, 'pending');
  });
});

describe('planlı sipariş: hatırlatma aynı kurala uyar', () => {
  test('10 dakikadır açıksa hatırlatılır, bir kez', async () => {
    const s = await seller();
    await openFor(s, 15);
    const o = await pendingOrder(s, { pendingMinutes: 8 * 60 });
    await expire();
    await expire();
    assert.equal(await reminders(s), 1);
    assert.ok((await row(o)).pending_reminded_at);
    assert.equal((await row(o)).status, 'pending');
  });

  test('yeni açılmış restoranda henüz hatırlatılmaz', async () => {
    const s = await seller();
    await openFor(s, 5);
    await pendingOrder(s, { pendingMinutes: 8 * 60 });
    await expire();
    assert.equal(await reminders(s), 0);
  });

  test('sipariş 10 dakikadan yeniyse hatırlatılmaz', async () => {
    const s = await seller();
    await openFor(s, 300);
    await pendingOrder(s, { pendingMinutes: 5 });
    await expire();
    assert.equal(await reminders(s), 0);
  });

  test('iptal edilecek siparişe hatırlatma gitmez', async () => {
    const s = await seller();
    await openFor(s, 40);
    await pendingOrder(s, { pendingMinutes: 60 });
    await expire();
    assert.equal(await reminders(s), 0);
  });

  test('saatine 15 dakikadan az kalan siparişe hatırlatma gitmez', async () => {
    const s = await seller();
    await openFor(s, 15);
    await pendingOrder(s, { scheduledFor: `now() + interval '10 minutes'`, pendingMinutes: 20 });
    await expire();
    assert.equal(await reminders(s), 0);
  });
});

describe('normal sipariş değişmedi', () => {
  test('restoran kapalıyken de 30 dakikada iptal olur', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { scheduledFor: null, pendingMinutes: 31 });
    await expire();
    assert.equal((await row(o)).status, 'cancelled');
  });

  test('restoran kapalıyken de 10 dakikada hatırlatılır, süresi dolmuşa hatırlatılmaz', async () => {
    const s = await seller();
    await closedNow(s);
    const o = await pendingOrder(s, { scheduledFor: null, pendingMinutes: 12 });
    await expire();
    assert.ok((await row(o)).pending_reminded_at);
    assert.equal((await row(o)).status, 'pending');
    assert.equal(await reminders(s), 1);

    const late = await seller();
    await pendingOrder(late, { scheduledFor: null, pendingMinutes: 31 });
    await expire();
    assert.equal(await reminders(late), 0);
  });

  test('süresi dolmamışsa iptal olmaz', async () => {
    const s = await seller();
    const o = await pendingOrder(s, { scheduledFor: null, pendingMinutes: 29 });
    await expire();
    assert.equal((await row(o)).status, 'pending');
  });
});

describe('seller_open_throughout', () => {
  // 2026-11-02 Pazartesi. Pazar 18:00-00:05 açık, Pazartesi 00:10'da yeniden açılır.
  const AT = `'2026-11-02T00:20:00+03:00'::timestamptz`;
  const openFor30 = async (s, at = AT) => (await as(db, null,
    `SELECT public.seller_open_throughout('${s.id}', 30, ${at}) AS ok`)).rows[0].ok;

  test('aradaki kısa kapalılık da sayılır: iki ucun açık olması yetmez', async () => {
    const s = await seller();
    await db.exec(`
      INSERT INTO public.seller_hours (seller_id, day_of_week, open_time, close_time, is_open) VALUES
        ('${s.id}',6,'18:00','00:05',true), ('${s.id}',0,'00:10','23:00',true);
    `);
    const ends = await as(db, null, `SELECT public.seller_open_at('${s.id}', ${AT}) AS a,
      public.seller_open_at('${s.id}', ${AT} - interval '30 minutes') AS b`);
    assert.equal(ends.rows[0].a, true);
    assert.equal(ends.rows[0].b, true);
    assert.equal(await openFor30(s), false);
    assert.equal(await openFor30(s, `'2026-11-02T00:41:00+03:00'::timestamptz`), true);
  });

  test('saat girmemiş restoran hep açık sayılır', async () => {
    const s = await seller();
    assert.equal(await openFor30(s), true);
  });

  test('müşteri çağıramaz', async () => {
    const s = await seller();
    assert.ok(await failure(db, buyer, `SELECT public.seller_open_throughout('${s.id}', 30)`));
    assert.ok(await failure(db, buyer, `SELECT public.scheduled_reply_elapsed('${s.id}', now(), 30)`));
  });
});

describe('yemek etiketleri', () => {
  test('varsayılan boştur; satıcı kendi ürününde seçer', async () => {
    const s = await seller();
    const first = await db.query(`SELECT dietary FROM public.menu_items WHERE id='${s.item}'`);
    assert.deepEqual(first.rows[0].dietary, []);
    await as(db, s.uid, `UPDATE public.menu_items SET dietary='{vegan,spicy}' WHERE id='${s.item}'`);
    const { rows } = await as(db, buyer, `SELECT dietary FROM public.menu_items WHERE id='${s.item}'`);
    assert.deepEqual(rows[0].dietary, ['vegan', 'spicy']);
  });

  test('listede olmayan etiket reddedilir, helal dahil', async () => {
    const s = await seller();
    for (const bad of ['{halal}', '{uydurma}', '{vegan,halal}']) {
      assert.ok(await failure(db, s.uid, `UPDATE public.menu_items SET dietary='${bad}' WHERE id='${s.item}'`), bad);
    }
  });

  test('boş bırakılamaz', async () => {
    const s = await seller();
    assert.ok(await failure(db, s.uid, `UPDATE public.menu_items SET dietary=NULL WHERE id='${s.item}'`));
  });

  test('başkasının ürününü değiştiremez', async () => {
    const s = await seller();
    await as(db, buyer, `UPDATE public.menu_items SET dietary='{vegan}' WHERE id='${s.item}'`);
    const { rows } = await db.query(`SELECT dietary FROM public.menu_items WHERE id='${s.item}'`);
    assert.deepEqual(rows[0].dietary, []);
  });
});

describe('Sana özel için geçmiş sorgusu', () => {
  test('sipariş satırından ürün kategorisine bağ vardır: order_items(menu_items(category)) buna dayanır', async () => {
    const { rows } = await db.query(`
      SELECT 1 FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
        JOIN information_schema.constraint_column_usage c ON c.constraint_name = rc.constraint_name
       WHERE k.table_name='order_items' AND k.column_name='menu_item_id' AND c.table_name='menu_items'`);
    assert.ok(rows.length >= 1);
  });

  test('müşteri kendi siparişini ve kategorisini okur, başkası okuyamaz', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.menu_items SET category='ana' WHERE id='${s.item}'`);
    const placed = await as(db, buyer, `SELECT * FROM public.place_order(
      p_seller_id => $1::uuid, p_items => $2::jsonb, p_delivery_address => 'Test Mah. No:1')`,
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }])]);
    const sql = `SELECT o.seller_id, m.category FROM public.orders o
      JOIN public.order_items i ON i.order_id = o.id
      LEFT JOIN public.menu_items m ON m.id = i.menu_item_id
     WHERE o.id = '${placed.rows[0].id}'`;
    const mine = await as(db, buyer, sql);
    assert.equal(mine.rows[0].seller_id, s.id);
    assert.equal(mine.rows[0].category, 'ana');
    const other = await user('buyer');
    assert.equal((await as(db, other, sql)).rows.length, 0);
  });
});
