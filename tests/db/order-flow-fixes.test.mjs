// 056: Hazırlık süresi kaydı, iptal nedeni bildirimi, fatura talebi bildirim bayrağı.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
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
    INSERT INTO public.sellers (id, user_id, display_name, is_active, delivery_time_min, delivery_time_max, pickup_enabled)
      VALUES ('${id}','${uid}','Hızlı Lokanta',true,20,45,true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

async function order(s, buyer, fulfillment = 'delivery') {
  return (await as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,p_fulfillment => $5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', fulfillment])).rows[0];
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

describe('Hazırlık süresiyle kabul', () => {
  test('süre kaydedilir, müşteri tahmini ve bildirimi bundan hesaplanır', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await order(s, buyer);
    const accepted = (await as(db, s.uid, 'SELECT * FROM public.seller_accept_order($1, 25)', [o.id])).rows[0];
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.prep_minutes, 25);
    // Yol: en uzun 45 - en kısa 20 = 25 dk.
    assert.equal(accepted.eta_minutes, 50);
    assert.ok(accepted.eta_updated_at);
    const n = await one(`SELECT body FROM public.notifications WHERE user_id=$1 AND title='Siparişin kabul edildi'`, [buyer]);
    assert.match(n.body, /Hazırlık yaklaşık 25 dk/);
    const eta = (await as(db, buyer, 'SELECT public.order_eta($1) AS r', [o.id])).rows[0].r;
    assert.ok(eta.eta_minutes <= 25 && eta.eta_minutes >= 5);
  });

  test('eve teslimde tahmin restoranın en kısa süresinin altına inmez', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.sellers SET delivery_time_min=40, delivery_time_max=50 WHERE id='${s.id}'`);
    const o = await order(s, await user());
    // 10 dk hazırlık + 10 dk yol = 20; restoranın en kısa süresi 40.
    const r = (await as(db, s.uid, 'SELECT * FROM public.seller_accept_order($1, 10)', [o.id])).rows[0];
    assert.equal(r.eta_minutes, 40);
  });

  test('gel-al siparişte yol eklenmez', async () => {
    const s = await seller();
    const o = await order(s, await user(), 'pickup');
    const r = (await as(db, s.uid, 'SELECT * FROM public.seller_accept_order($1, 15)', [o.id])).rows[0];
    assert.equal(r.eta_minutes, 15);
  });

  test('yalnızca kendi bekleyen siparişini, geçerli süreyle kabul eder', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await order(s, buyer);
    assert.equal((await failure(db, s.uid, 'SELECT public.seller_accept_order($1, 2)', [o.id]))?.code, '22023');
    assert.equal((await failure(db, (await seller()).uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]))?.code, 'P0002');
    assert.equal((await failure(db, buyer, 'SELECT public.seller_accept_order($1, 20)', [o.id]))?.code, 'P0002');
    await as(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]);
    assert.equal((await failure(db, s.uid, 'SELECT public.seller_accept_order($1, 30)', [o.id]))?.code, '55000');
    assert.equal((await one('SELECT prep_minutes FROM public.orders WHERE id=$1', [o.id])).prep_minutes, 20);
  });

  test('süre doğrudan yazılamaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await order(s, buyer);
    await as(db, s.uid, `UPDATE public.orders SET prep_minutes=90, eta_minutes=90 WHERE id='${o.id}'`);
    await as(db, buyer, `UPDATE public.orders SET prep_minutes=90 WHERE id='${o.id}'`);
    const r = await one('SELECT prep_minutes, eta_minutes FROM public.orders WHERE id=$1', [o.id]);
    assert.equal(r.prep_minutes, null);
    assert.equal(r.eta_minutes, null);
  });

  test('iptal edilmiş sipariş kabul edilemez', async () => {
    const s = await seller();
    const o = await order(s, await user());
    await db.exec(`UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await failure(db, s.uid, 'SELECT public.seller_accept_order($1, 20)', [o.id]))?.code, '55000');
  });
});

describe('İptal nedeni', () => {
  test('restoranın iptal nedeni müşteriye bildirimle gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await order(s, buyer);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled', cancel_reason='Ürün tükendi' WHERE id='${o.id}'`);
    const n = await one(`SELECT body FROM public.notifications WHERE user_id=$1 AND title='Siparişin iptal edildi'`, [buyer]);
    assert.match(n.body, /Ürün tükendi/);
    // Neden sonradan değiştirilemez.
    assert.equal((await failure(db, s.uid, `UPDATE public.orders SET cancel_reason='Başka' WHERE id='${o.id}'`))?.code, '42501');
  });

  test('müşteri iptal edince restorana neden gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await order(s, buyer);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled', cancel_reason='Yanlış adres' WHERE id='${o.id}'`);
    const n = await one(`SELECT body FROM public.notifications WHERE user_id=$1 AND title='Sipariş iptal edildi'`, [s.uid]);
    assert.match(n.body, /Neden: Yanlış adres/);
  });
});

describe('Fatura talebi bildirimi', () => {
  test('restorana giden bildirim fatura bayrağı taşır', async () => {
    const s = await seller();
    const buyer = await user();
    await db.exec(`INSERT INTO public.corporate_billing_profiles (user_id, legal_title, tax_number, tax_office, address, email)
      VALUES ('${buyer}','Örnek A.Ş.','1234567890','Kadıköy','Test Mah. No:1','muhasebe@example.com')`);
    const o = await order(s, buyer);
    await as(db, buyer, 'SELECT public.request_order_invoice($1)', [o.id]);
    const n = await one(`SELECT data FROM public.notifications WHERE user_id=$1 AND title='Kurumsal fatura istendi'`, [s.uid]);
    assert.equal(n.data.invoiceRequest, true);
    assert.equal(n.data.orderId, o.id);
  });
});
