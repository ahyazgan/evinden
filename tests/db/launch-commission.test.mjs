// Lansman komisyonu (044): restoran oranı %7, satıcıya özel oran tür oranının yerine geçer.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
let admin;
let buyer;

before(async () => {
  db = await createDb();
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

/** Yemek ₺100 (10000), teslimat ₺15: komisyon yalnızca yemekten hesaplanır. */
async function restaurant(type = 'restaurant') {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active)
      VALUES ('${id}','${uid}','Restoran','${type}',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

const place = (s) => as(db, buyer, `SELECT * FROM public.place_order(
  p_seller_id => $1::uuid, p_items => $2::jsonb, p_delivery_address => 'Test Mah. Test Sok. No:1',
  p_payment_method => 'cash')`, [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }])]).then((r) => r.rows[0]);

const setRate = (s, percent) => as(db, admin, `INSERT INTO public.seller_commission_rates (seller_id, rate_percent, note)
  VALUES ('${s.id}', ${percent}, 'test') ON CONFLICT (seller_id) DO UPDATE SET rate_percent = EXCLUDED.rate_percent`);

describe('lansman oranı', () => {
  test('restoran %7 öder', async () => {
    const { rows } = await db.query(`SELECT value->>'restaurant_commission_rate_percent' AS r FROM public.app_config WHERE key='order_pricing'`);
    assert.equal(Number(rows[0].r), 7);
    const o = await place(await restaurant());
    assert.equal(Number(o.commission_rate), 7);
    assert.equal(o.commission_cents, 700);
  });

  test('ev aşçısı oranı değişmez', async () => {
    const o = await place(await restaurant('home'));
    assert.equal(o.commission_cents, 800);
  });
});

describe('satıcıya özel oran', () => {
  test('yönetici verir, sipariş o oranla hesaplanır', async () => {
    const s = await restaurant();
    await setRate(s, 8);
    const o = await place(s);
    assert.equal(Number(o.commission_rate), 8);
    assert.equal(o.commission_cents, 800);
  });

  test('oran kaldırılınca tür oranına dönülür', async () => {
    const s = await restaurant();
    await setRate(s, 8);
    await as(db, admin, `DELETE FROM public.seller_commission_rates WHERE seller_id='${s.id}'`);
    const o = await place(s);
    assert.equal(o.commission_cents, 700);
  });

  test('özel oran tür oranından düşük de olabilir', async () => {
    const s = await restaurant();
    await setRate(s, 5);
    assert.equal((await place(s)).commission_cents, 500);
  });

  test('geçersiz oran reddedilir', async () => {
    const s = await restaurant();
    assert.ok(await failure(db, admin, `INSERT INTO public.seller_commission_rates (seller_id, rate_percent) VALUES ('${s.id}', -1)`));
    assert.ok(await failure(db, admin, `INSERT INTO public.seller_commission_rates (seller_id, rate_percent) VALUES ('${s.id}', 51)`));
  });
});

describe('oran güvenliği', () => {
  test('satıcı kendi oranını yazamaz, değiştiremez, silemez', async () => {
    const s = await restaurant();
    await setRate(s, 8);
    assert.ok(await failure(db, s.uid, `INSERT INTO public.seller_commission_rates (seller_id, rate_percent) VALUES ('${randomUUID()}', 0)`));
    await as(db, s.uid, `UPDATE public.seller_commission_rates SET rate_percent = 0 WHERE seller_id='${s.id}'`);
    await as(db, s.uid, `DELETE FROM public.seller_commission_rates WHERE seller_id='${s.id}'`);
    const { rows } = await db.query(`SELECT rate_percent FROM public.seller_commission_rates WHERE seller_id='${s.id}'`);
    assert.equal(Number(rows[0].rate_percent), 8, 'satır olduğu gibi kalmalı');
    assert.equal((await place(s)).commission_cents, 800);
  });

  test('satıcı yalnızca kendi oranını görür, müşteri ve ziyaretçi göremez', async () => {
    const a = await restaurant();
    const b = await restaurant();
    await setRate(a, 8);
    await setRate(b, 6);
    const own = await as(db, a.uid, `SELECT seller_id FROM public.seller_commission_rates`);
    assert.deepEqual(own.rows.map((r) => r.seller_id), [a.id]);
    assert.equal((await as(db, buyer, `SELECT seller_id FROM public.seller_commission_rates`)).rows.length, 0);
    // uid null service role gibi davranır; ziyaretçi için anon rolü elle seçilir.
    await db.exec(`RESET ROLE; SET ROLE anon;`);
    try {
      await assert.rejects(db.query(`SELECT seller_id FROM public.seller_commission_rates`), /permission denied/);
    } finally {
      await db.exec(`RESET ROLE`);
    }
  });

  test('satıcı sellers satırını güncellese de orana dokunamaz', async () => {
    const s = await restaurant();
    await setRate(s, 8);
    await as(db, s.uid, `UPDATE public.sellers SET display_name = 'Yeni ad' WHERE id='${s.id}'`);
    assert.equal((await place(s)).commission_cents, 800);
  });
});
