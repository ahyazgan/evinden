import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  admin = await user('admin');
});

const one = async (sql) => (await db.query(sql)).rows[0];

// Tohum veri: uid NULL (service role) olduğundan korumalar atlanır.
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
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Mağaza',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',20000);
  `);
  return { uid, id, item };
}

const placeOrder = (buyer, s, coupon = null) =>
  as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', coupon]).then((r) => r.rows[0]);

const orderError = (buyer, s) =>
  failure(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1']);

async function deliver(s, orderId) {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${orderId}'`);
  }
}

const hours = (s, day, open, close, isOpen = true) => db.exec(`
  INSERT INTO public.seller_hours (seller_id, day_of_week, open_time, close_time, is_open)
  VALUES ('${s.id}',${day},'${open}','${close}',${isOpen})
  ON CONFLICT (seller_id, day_of_week) DO UPDATE SET open_time=EXCLUDED.open_time, close_time=EXCLUDED.close_time, is_open=EXCLUDED.is_open`);

// 2026-11-02 Pazartesi (day_of_week=0). İstanbul UTC+3.
const openAt = async (s, local) =>
  (await one(`SELECT public.seller_open_at('${s.id}', '${local}+03'::timestamptz) AS open`)).open;

const dowToday = async () =>
  (await one(`SELECT extract(isodow FROM (now() AT TIME ZONE 'Europe/Istanbul'))::int - 1 AS d`)).d;

describe('Mağazayı kapatma', () => {
  test('satıcı mağazasını kapatıp açabilir, kapalıyken sipariş alınmaz', async () => {
    const s = await seller();
    await as(db, s.uid, `UPDATE public.sellers SET is_paused=true WHERE id='${s.id}'`);
    const err = await orderError(await user(), s);
    assert.match(err?.message ?? '', /kapalı/);

    await as(db, s.uid, `UPDATE public.sellers SET is_paused=false WHERE id='${s.id}'`);
    assert.ok(await placeOrder(await user(), s));
  });

  test('başkası mağazayı kapatamaz, kapatma yönetici onayını etkilemez', async () => {
    const s = await seller();
    const r = await as(db, await user(), `UPDATE public.sellers SET is_paused=true WHERE id='${s.id}'`);
    assert.equal(r.affectedRows, 0);
    const pasif = await seller();
    await as(db, admin, `UPDATE public.sellers SET is_active=false WHERE id='${pasif.id}'`);
    const err = await failure(db, pasif.uid, `UPDATE public.sellers SET is_active=true, is_paused=false WHERE id='${pasif.id}'`);
    assert.equal(err?.code, '42501');
  });
});

describe('Çalışma saatleri', () => {
  test('saat girmemiş satıcı açıktır', async () => {
    assert.equal(await openAt(await seller(), '2026-11-02 03:00'), true);
  });

  test('saat aralığı İstanbul saatine göre uygulanır, kapanış dahil değildir', async () => {
    const s = await seller();
    await hours(s, 0, '09:00', '20:00');
    assert.equal(await openAt(s, '2026-11-02 08:59'), false);
    assert.equal(await openAt(s, '2026-11-02 09:00'), true);
    assert.equal(await openAt(s, '2026-11-02 19:59'), true);
    assert.equal(await openAt(s, '2026-11-02 20:00'), false);
  });

  test('kapalı gün kapalıdır; Pazar 6 numaradır', async () => {
    const s = await seller();
    await hours(s, 6, '09:00', '20:00', false);
    assert.equal(await openAt(s, '2026-11-08 12:00'), false);
    assert.equal(await openAt(s, '2026-11-09 12:00'), true, 'Pazartesi kaydı yok, açık');
  });

  test('gece yarısını aşan saatler ertesi güne taşar', async () => {
    const s = await seller();
    await hours(s, 4, '18:00', '02:00'); // Cuma
    await hours(s, 5, '12:00', '15:00'); // Cumartesi
    assert.equal(await openAt(s, '2026-11-06 23:00'), true);
    assert.equal(await openAt(s, '2026-11-07 01:30'), true);
    assert.equal(await openAt(s, '2026-11-07 02:00'), false);
    assert.equal(await openAt(s, '2026-11-07 13:00'), true);
  });

  test('kapalı saatte sipariş açılmaz', async () => {
    const s = await seller();
    await hours(s, await dowToday(), '00:00', '00:00', false);
    const err = await orderError(await user(), s);
    assert.match(err?.message ?? '', /kapalı/);
  });
});

describe('Haftalık menü', () => {
  test('haftalık menü açıksa yalnızca bugünün ürünleri sipariş edilir', async () => {
    const s = await seller();
    const buyer = await user();
    await as(db, s.uid, `UPDATE public.sellers SET uses_weekly_menu=true WHERE id='${s.id}'`);

    const err = await orderError(buyer, s);
    assert.match(err?.message ?? '', /bugünkü menüde yok/);

    const today = await dowToday();
    await db.exec(`INSERT INTO public.weekly_menu (seller_id, menu_item_id, day_of_week) VALUES ('${s.id}','${s.item}',${(today + 1) % 7})`);
    assert.ok(await orderError(buyer, s), 'başka güne ekli ürün bugün satılmaz');

    await db.exec(`INSERT INTO public.weekly_menu (seller_id, menu_item_id, day_of_week) VALUES ('${s.id}','${s.item}',${today})`);
    assert.ok(await placeOrder(buyer, s));
  });
});

describe('Bildirimler', () => {
  const notes = async (uid) => (await db.query(
    `SELECT title, data FROM public.notifications WHERE user_id='${uid}' ORDER BY created_at, title`)).rows;

  test('yeni sipariş satıcıya, durum değişiklikleri müşteriye gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    assert.match((await notes(s.uid))[0].title, /Yeni sipariş/);
    assert.equal((await notes(s.uid))[0].data.orderId, o.id);
    assert.equal((await notes(buyer)).length, 0);

    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    assert.match((await notes(buyer))[0].title, /kabul edildi/);
  });

  test('müşteri iptal edince satıcı haberdar olur, kendisine bildirim gitmez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await notes(buyer)).length, 0);
    assert.ok((await notes(s.uid)).some((n) => /iptal/.test(n.title)));
  });

  test('iade kararı müşteriye gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk' WHERE id='${o.id}'`);
    assert.ok((await notes(s.uid)).some((n) => /İade talebi/.test(n.title)));
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.ok((await notes(buyer)).some((n) => /onaylandı/.test(n.title)));
  });

  test('satıcı yalnızca kendi takipçilerine duyuru yapabilir, başkasının adına yazılamaz', async () => {
    const s = await seller();
    const takipci = await user();
    const yabanci = await user();
    await db.exec(`INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${takipci}','${s.id}')`);
    // 038: takipçi duyurusu ticari iletidir, takipçiye izin verilir. Bu test kimin duyuru yapabildiğini sınıyor.
    await db.exec(`UPDATE public.users SET marketing_consent = true WHERE id IN ('${takipci}','${yabanci}')`);
    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni yemek','Mantı eklendi')`);
    assert.equal((await notes(takipci)).length, 1);
    assert.equal((await notes(yabanci)).length, 0);

    const err = await failure(db, yabanci, `SELECT public.notify_my_followers('X','Y')`);
    assert.equal(err?.code, '42501');
    const dogrudan = await failure(db, yabanci, `INSERT INTO public.notifications (user_id, title) VALUES ('${takipci}','Sahte')`);
    assert.ok(dogrudan);
    const icFonksiyon = await failure(db, yabanci, `SELECT public.notify_user('${takipci}','Sahte','x','system','{}')`);
    assert.equal(icFonksiyon?.code, '42501');
  });
});

describe('Sadakat', () => {
  const loyalty = (uid) => one(`SELECT * FROM public.loyalty WHERE user_id='${uid}'`);

  test('puan yalnızca teslimde ve bir kez verilir', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    assert.equal(await loyalty(buyer), undefined);

    await deliver({ ...s }, (await placeOrder(buyer, s)).id);
    const l = await loyalty(buyer);
    assert.equal(l.total_orders, 1);
    assert.equal(l.points, 200, '₺200 = 200 puan, teslimat ücretsiz');
    assert.equal(l.total_spent, 20000);
  });

  test('iptal edilen sipariş puan kazandırmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal(await loyalty(buyer), undefined);
  });

  test('kullanıcı kendi puanını yazamaz', async () => {
    const buyer = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, points) VALUES ('${buyer}', 1)`);
    const up = await failure(db, buyer, `UPDATE public.loyalty SET points=99999 WHERE user_id='${buyer}'`);
    assert.equal(up?.code, '42501');
    const yeni = await user();
    const ins = await failure(db, yeni, `INSERT INTO public.loyalty (user_id, points) VALUES ('${yeni}', 99999)`);
    assert.equal(ins?.code, '42501');
    const r = await as(db, buyer, `SELECT points FROM public.loyalty WHERE user_id='${buyer}'`);
    assert.equal(r.rows[0].points, 1, 'kendi puanını okuyabilir');
  });

  test('seviye siparişlerle yükselir ve puan çarpanı değişir; 10. siparişte teslimat kuponu', async () => {
    const buyer = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, total_orders, tier) VALUES ('${buyer}', 9, 'silver')`);
    const s = await seller();
    await deliver(s, (await placeOrder(buyer, s)).id);
    const l = await loyalty(buyer);
    assert.equal(l.total_orders, 10);
    assert.equal(l.tier, 'silver');
    assert.equal(l.points, 250, 'gümüş çarpanı 1.25');
    assert.equal(l.free_deliveries_earned, 1);
    const c = await one(`SELECT code, discount_type, owner_id FROM public.coupons WHERE owner_id='${buyer}'`);
    assert.equal(c.discount_type, 'free_delivery');

    const n = await one(`SELECT body FROM public.notifications WHERE user_id='${buyer}' AND type='promo'`);
    assert.match(n.body, new RegExp(c.code));
  });

  test('ödül puan düşer, kişiye özel tek kullanımlık kupon verir', async () => {
    const owner = await user();
    const other = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, points) VALUES ('${owner}', 100)`);

    const code = (await as(db, owner, `SELECT public.redeem_reward('disc_10') AS code`)).rows[0].code;
    assert.match(code, /^ODUL/);
    assert.equal((await loyalty(owner)).points, 20);

    const s = await seller();
    const baskasi = await failure(db, other, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', code]);
    assert.match(baskasi?.message ?? '', /Kupon geçersiz/);

    const o = await placeOrder(owner, s, code);
    assert.equal(o.discount_cents, 1000);
    const tekrar = await failure(db, owner, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', code]);
    assert.ok(tekrar, 'tek kullanımlık');
  });

  test('yetersiz puan ve bilinmeyen ödül reddedilir, puan düşmez', async () => {
    const buyer = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, points) VALUES ('${buyer}', 10)`);
    const az = await failure(db, buyer, `SELECT public.redeem_reward('disc_30')`);
    assert.equal(az?.code, '55000');
    const yok = await failure(db, buyer, `SELECT public.redeem_reward('hile')`);
    assert.equal(yok?.code, '22023');
    assert.equal((await loyalty(buyer)).points, 10);
  });

  test('kişiye özel kuponu yalnızca sahibi ve yönetici görür; kullanıcı kendine kupon yazamaz', async () => {
    const owner = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, points) VALUES ('${owner}', 50)`);
    const code = (await as(db, owner, `SELECT public.redeem_reward('free_del') AS code`)).rows[0].code;
    const q = `SELECT count(*)::int AS n FROM public.coupons WHERE code='${code}'`;
    assert.equal((await as(db, owner, q)).rows[0].n, 1);
    assert.equal((await as(db, await user(), q)).rows[0].n, 0);
    assert.equal((await as(db, admin, q)).rows[0].n, 1);

    const ic = await failure(db, owner, `SELECT public.issue_personal_coupon('${owner}','fixed',99999,'Hile')`);
    assert.equal(ic?.code, '42501');
  });

  test('hesap silinince sadakat, bildirim ve kişiye özel kuponlar da gider', async () => {
    const owner = await user();
    await db.exec(`INSERT INTO public.loyalty (user_id, points) VALUES ('${owner}', 50)`);
    await as(db, owner, `SELECT public.redeem_reward('free_del')`);
    await as(db, owner, 'SELECT public.delete_my_account()');
    assert.equal(await loyalty(owner), undefined);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.coupons WHERE owner_id='${owner}'`)).n, 0);
  });
});

describe('Ödeme durumu', () => {
  test('satıcı teslimle birlikte ödemeyi alındı işaretleyebilir', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    for (const st of ['accepted', 'preparing', 'ready']) {
      await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${o.id}'`);
    }
    await as(db, s.uid, `UPDATE public.orders SET status='delivered', payment_status='paid' WHERE id='${o.id}'`);
    assert.equal((await one(`SELECT payment_status FROM public.orders WHERE id='${o.id}'`)).payment_status, 'paid');
  });
});
