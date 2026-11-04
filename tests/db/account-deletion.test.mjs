import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';

let db;

before(async () => {
  db = await createDb();
});

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;
const del = (uid) => as(db, uid, 'SELECT public.delete_my_account() AS seller_id');

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
    INSERT INTO public.sellers (id, user_id, display_name, bio, address_line, is_active)
      VALUES ('${id}','${uid}','Gerçek Mağaza Adı','Hakkımda','Gizli Sok. No:1',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Mantı',10000);
    INSERT INTO public.seller_hours (seller_id, day_of_week) VALUES ('${id}',1);
  `);
  return { uid, id, item };
}

async function order(customer, s, status = 'delivered') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO public.orders (id, customer_id, seller_id, status, subtotal_cents, total_cents, delivery_address, notes, cancel_reason, refund_reason)
      VALUES ('${id}','${customer}','${s.id}','${status}',10000,11500,'Ev Adresi','Zili çalma','neden','neden');
    INSERT INTO public.order_items (order_id, menu_item_id, title_snapshot, unit_price_cents, quantity, line_total_cents)
      VALUES ('${id}','${s.item}','Mantı',10000,1,10000);
  `);
  return id;
}

async function review(customer, s, orderId, rating) {
  await db.exec(`
    INSERT INTO public.reviews (order_id, seller_id, customer_id, rating)
      VALUES ('${orderId}','${s.id}','${customer}',${rating});
  `);
}

describe('Müşteri hesabını siler', () => {
  test('hesap ve kişisel kayıtlar gerçekten silinir', async () => {
    const s = await seller();
    const uid = await user();
    await db.exec(`
      INSERT INTO public.favorites (user_id, seller_id) VALUES ('${uid}','${s.id}');
      INSERT INTO public.user_addresses (user_id, address) VALUES ('${uid}','Ev Adresi');
      INSERT INTO public.notifications (user_id, title) VALUES ('${uid}','Selam');
      INSERT INTO public.loyalty (user_id) VALUES ('${uid}');
    `);

    const r = await del(uid);
    assert.equal(r.rows[0].seller_id, null);

    assert.equal(await count(`auth.users WHERE id='${uid}'`), 0);
    assert.equal(await count(`public.users WHERE id='${uid}'`), 0);
    assert.equal(await count(`public.favorites WHERE user_id='${uid}'`), 0);
    assert.equal(await count(`public.user_addresses WHERE user_id='${uid}'`), 0);
    assert.equal(await count(`public.notifications WHERE user_id='${uid}'`), 0);
    assert.equal(await count(`public.loyalty WHERE user_id='${uid}'`), 0);
  });

  test('geçmiş sipariş kalır ama müşteriyle bağı ve kişisel metinleri temizlenir', async () => {
    const s = await seller();
    const uid = await user();
    const other = await user();
    const mine = await order(uid, s);
    const theirs = await order(other, s);

    await del(uid);

    const o = await one(`SELECT * FROM public.orders WHERE id='${mine}'`);
    assert.equal(o.customer_id, null);
    assert.equal(o.delivery_address, null);
    assert.equal(o.notes, null);
    assert.equal(o.cancel_reason, null);
    assert.equal(o.refund_reason, null);
    assert.equal(o.total_cents, 11500);
    assert.equal(await count(`public.order_items WHERE order_id='${mine}'`), 1);

    const t = await one(`SELECT customer_id, delivery_address FROM public.orders WHERE id='${theirs}'`);
    assert.equal(t.customer_id, other);
    assert.equal(t.delivery_address, 'Ev Adresi');
    assert.equal(await count(`public.users WHERE id='${other}'`), 1);
  });

  test('devam eden sipariş varsa reddedilir ve hiçbir şey silinmez', async () => {
    const s = await seller();
    const uid = await user();
    const oid = await order(uid, s, 'preparing');

    const err = await failure(db, uid, 'SELECT public.delete_my_account()');
    assert.equal(err?.code, '55000');
    assert.equal(await count(`public.users WHERE id='${uid}'`), 1);
    assert.equal((await one(`SELECT customer_id FROM public.orders WHERE id='${oid}'`)).customer_id, uid);
  });

  test('iptal edilmiş sipariş silmeyi engellemez', async () => {
    const s = await seller();
    const uid = await user();
    await order(uid, s, 'cancelled');
    await del(uid);
    assert.equal(await count(`public.users WHERE id='${uid}'`), 0);
  });

  test('yorumları silinir ve satıcı puanı yeniden hesaplanır', async () => {
    const s = await seller();
    const leaving = await user();
    const staying = await user();
    await review(leaving, s, await order(leaving, s), 1);
    await review(staying, s, await order(staying, s), 5);
    assert.equal(Number((await one(`SELECT rating_avg FROM public.sellers WHERE id='${s.id}'`)).rating_avg), 3);

    await del(leaving);

    const row = await one(`SELECT rating_avg, rating_count FROM public.sellers WHERE id='${s.id}'`);
    assert.equal(Number(row.rating_avg), 5);
    assert.equal(row.rating_count, 1);
    assert.equal(await count(`public.reviews WHERE customer_id='${leaving}'`), 0);
  });

  test('referans kaydı olan kullanıcı silinebilir', async () => {
    const referrer = await user();
    const referred = await user();
    const row = randomUUID();
    await db.exec(`INSERT INTO public.referrals (id, referrer_id, referred_id, code)
      VALUES ('${row}','${referrer}','${referred}','${row}')`);

    await del(referred);
    assert.equal((await one(`SELECT referred_id FROM public.referrals WHERE id='${row}'`)).referred_id, null);

    await del(referrer);
    assert.equal(await count(`public.referrals WHERE id='${row}'`), 0);
  });
});

// Açık bakiyesi olan satıcı hesabını silemez (027): önce yönetici hesap kesimi yapar.
async function settle(s) {
  const admin = await user('admin');
  const { balance_cents } = (await as(db, admin, `SELECT * FROM public.admin_payout_overview() WHERE seller_id='${s.id}'`)).rows[0];
  await as(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${balance_cents})`);
}

describe('Satıcı hesabını siler', () => {
  test('satış geçmişi varsa mağaza anonimleşerek kalır, menü ve kişisel bilgiler gider', async () => {
    const s = await seller();
    const customer = await user();
    const oid = await order(customer, s);
    await review(customer, s, oid, 4);
    await db.exec(`INSERT INTO public.favorites (user_id, seller_id) VALUES ('${customer}','${s.id}')`);
    await settle(s);

    const r = await del(s.uid);
    assert.equal(r.rows[0].seller_id, s.id);

    assert.equal(await count(`public.users WHERE id='${s.uid}'`), 0);
    assert.equal(await count(`auth.users WHERE id='${s.uid}'`), 0);

    const row = await one(`SELECT * FROM public.sellers WHERE id='${s.id}'`);
    assert.equal(row.user_id, null);
    assert.equal(row.display_name, 'Silinmiş satıcı');
    assert.equal(row.bio, null);
    assert.equal(row.address_line, null);
    assert.equal(row.is_active, false);
    assert.equal(row.rating_count, 0);

    assert.equal(await count(`public.menu_items WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.seller_hours WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.favorites WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.reviews WHERE seller_id='${s.id}'`), 0);

    // Müşterinin sipariş kaydı ve kalem başlığı bozulmaz.
    const o = await one(`SELECT seller_id, customer_id, delivery_address FROM public.orders WHERE id='${oid}'`);
    assert.equal(o.seller_id, s.id);
    assert.equal(o.customer_id, customer);
    assert.equal(o.delivery_address, 'Ev Adresi');
    const i = await one(`SELECT menu_item_id, title_snapshot FROM public.order_items WHERE order_id='${oid}'`);
    assert.equal(i.menu_item_id, null);
    assert.equal(i.title_snapshot, 'Mantı');
  });

  test('sahibi silinmiş mağaza yönetici tarafından bile açılamaz', async () => {
    const s = await seller();
    await order(await user(), s);
    await settle(s);
    await del(s.uid);
    const err = await failure(db, null, `UPDATE public.sellers SET is_active=true WHERE id='${s.id}'`);
    assert.equal(err?.code, '23514');
  });

  test('satış geçmişi yoksa mağaza tamamen silinir', async () => {
    const s = await seller();
    await del(s.uid);
    assert.equal(await count(`public.sellers WHERE id='${s.id}'`), 0);
    assert.equal(await count(`public.menu_items WHERE seller_id='${s.id}'`), 0);
  });

  test('açık siparişi varsa reddedilir', async () => {
    const s = await seller();
    await order(await user(), s, 'pending');
    const err = await failure(db, s.uid, 'SELECT public.delete_my_account()');
    assert.equal(err?.code, '55000');
    assert.equal((await one(`SELECT user_id FROM public.sellers WHERE id='${s.id}'`)).user_id, s.uid);
    assert.equal(await count(`public.menu_items WHERE seller_id='${s.id}'`), 1);
  });
});

describe('Yetki ve korumalar', () => {
  test('giriş yapmadan çağrılamaz', async () => {
    const err = await failure(db, null, 'SELECT public.delete_my_account()');
    assert.equal(err?.code, '42501');

    await db.exec(`RESET ROLE; SET ROLE anon;`);
    let anonErr;
    try {
      await db.query('SELECT public.delete_my_account()');
    } catch (e) { anonErr = e; }
    await db.exec(`RESET ROLE;`);
    assert.equal(anonErr?.code, '42501');
  });

  test('yönetici kendini silemez', async () => {
    const admin = await user('admin');
    const err = await failure(db, admin, 'SELECT public.delete_my_account()');
    assert.equal(err?.code, '55000');
    assert.equal(await count(`public.users WHERE id='${admin}'`), 1);
  });

  test('korumalar işlem sonrası açık kalmaz', async () => {
    const s = await seller();
    const uid = await user();
    const oid = await order(uid, s);
    await del(uid);
    const r = await as(db, s.uid, `SELECT coalesce(current_setting('app.internal', true), '') AS flag`);
    assert.equal(r.rows[0].flag, '');
    const err = await failure(db, s.uid, `UPDATE public.orders SET total_cents=1 WHERE id='${oid}'`);
    assert.equal(err?.code, '42501');
  });

  test('müşterisi silinmiş siparişte satıcı iade talebi açamaz, müşteriyi geri yazamaz', async () => {
    const s = await seller();
    const uid = await user();
    const other = await user();
    const oid = await order(uid, s);
    await del(uid);

    const refund = await failure(db, s.uid, `UPDATE public.orders SET refund_status='requested' WHERE id='${oid}'`);
    assert.equal(refund?.code, '42501');
    const steal = await failure(db, s.uid, `UPDATE public.orders SET customer_id='${other}' WHERE id='${oid}'`);
    assert.equal(steal?.code, '42501');
  });

  test('silinen kullanıcının eski oturumu yeni profil açamaz', async () => {
    const uid = await user();
    await del(uid);
    const err = await failure(db, uid, `INSERT INTO public.users (id, name, role) VALUES ('${uid}','Geri','buyer')`);
    assert.ok(err, 'auth.users kaydı olmadan profil açılmamalı');
    assert.equal(await count(`public.users WHERE id='${uid}'`), 0);
  });

  test('yönetici veya servis bir kullanıcıyı silerse de sipariş kaydı korunur', async () => {
    const s = await seller();
    const uid = await user();
    const oid = await order(uid, s);
    await db.exec(`DELETE FROM auth.users WHERE id='${uid}'`);
    assert.equal(await count(`public.users WHERE id='${uid}'`), 0);
    assert.equal((await one(`SELECT customer_id FROM public.orders WHERE id='${oid}'`)).customer_id, null);
  });
});
