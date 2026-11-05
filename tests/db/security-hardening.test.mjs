import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
const user = async (name = 'Kişi') => {
  const id = randomUUID();
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','${name}','buyer',true);`);
  return id;
};
const seller = async (extra = '') => {
  const uid = randomUUID();
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${uid}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${uid}','Satıcı','seller',true);
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active, city, district)
      VALUES ('${id}','${uid}','Lokanta','restaurant',true,'İstanbul','Kadıköy');
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Pide',20000);
    ${extra}`);
  return { uid, id, item };
};
const order = (uid, s, { coupon = null, method = 'cash', quantity = 1 } = {}) => as(
  db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity }]), 'Moda Cad. No:1', method, coupon],
);
const platformCoupon = async () => {
  const code = `G${randomUUID().slice(0, 8)}`.toUpperCase();
  await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value) VALUES ('${code}','fixed',1000)`);
  return code;
};

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
});

describe('Sahte kapıda ödeme siparişi', () => {
  test('platform kuponu aynı restoranda 30 günde bir kez kapıda kullanılır', async () => {
    const s = await seller();
    const buyer = await user();
    await order(buyer, s, { coupon: await platformCoupon() });
    const f = await failure(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Moda Cad. No:1', 'cash', await platformCoupon()]);
    assert.equal(f?.code, '55000');
  });
  test('iptal edilen sipariş hakkı tüketmez, başka restoran ayrı sayılır, kuponsuz sipariş serbesttir', async () => {
    const s = await seller();
    const buyer = await user();
    const first = (await order(buyer, s, { coupon: await platformCoupon() })).rows[0];
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${first.id}'`);
    assert.ok((await order(buyer, s, { coupon: await platformCoupon() })).rows[0].id);
    assert.ok((await order(buyer, await seller(), { coupon: await platformCoupon() })).rows[0].id);
    assert.ok((await order(buyer, s)).rows[0].id);
  });
  test('tek siparişin puanı ₺500 ile sınırlı, kapıda günde bir sipariş puan kazandırır', async () => {
    const s = await seller();
    const buyer = await user();
    const deliver = async id => db.exec(`UPDATE public.orders SET status='delivered' WHERE id='${id}'`);
    await deliver((await order(buyer, s, { quantity: 40 })).rows[0].id);
    const after = await db.query(`SELECT points FROM public.loyalty WHERE user_id='${buyer}'`);
    assert.equal(after.rows[0].points, 500);
    await deliver((await order(buyer, s, { quantity: 40 })).rows[0].id);
    const again = await db.query(`SELECT points FROM public.loyalty WHERE user_id='${buyer}'`);
    assert.equal(again.rows[0].points, 500);
  });
});

describe('Kimlik alanları', () => {
  test('kayıt tarihi geri alınamaz', async () => {
    const u = await user();
    const old = (await db.query(`SELECT created_at FROM public.users WHERE id='${u}'`)).rows[0].created_at;
    await as(db, u, `UPDATE public.users SET created_at='2020-01-01' WHERE id='${u}'`);
    const now = (await db.query(`SELECT created_at FROM public.users WHERE id='${u}'`)).rows[0].created_at;
    assert.deepEqual(now, old);
  });
  test('başkasının numarası yazılsa da kişi kendi numarasını kaydedebilir', async () => {
    const [a, b] = [await user(), await user()];
    await as(db, a, `UPDATE public.users SET phone='+905551112233' WHERE id='${a}'`);
    await as(db, b, `UPDATE public.users SET phone='+905551112233' WHERE id='${b}'`);
    assert.equal((await db.query(`SELECT phone FROM public.users WHERE id='${b}'`)).rows[0].phone, '+905551112233');
  });
  test('doğrulanmış telefonu olan kullanıcı başka numara yazamaz', async () => {
    const u = await user();
    await db.exec(`UPDATE auth.users SET phone='905550000001', phone_confirmed_at=now() WHERE id='${u}'`);
    await as(db, u, `UPDATE public.users SET phone='+905559999999' WHERE id='${u}'`);
    assert.notEqual((await db.query(`SELECT phone FROM public.users WHERE id='${u}'`)).rows[0].phone, '+905559999999');
  });
});

describe('Davet', () => {
  test('program durdurulunca davet kodu kabul edilmez', async () => {
    const referrer = await user();
    const code = (await as(db, referrer, 'SELECT public.get_my_referral_code() AS c')).rows[0].c;
    await db.exec(`INSERT INTO public.app_config (key, value) VALUES ('referral_program','{"paused": true}')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    const f = await failure(db, await user(), 'SELECT public.apply_referral_code($1)', [code]);
    assert.equal(f?.code, '55000');
    await db.exec(`DELETE FROM public.app_config WHERE key='referral_program'`);
  });
});

describe('Askıdaki hesap', () => {
  test('kendini silemez, yönetici silebilir', async () => {
    const u = await user();
    await db.exec(`UPDATE public.users SET is_suspended=true WHERE id='${u}'`);
    const f = await failure(db, u, 'SELECT public.delete_my_account()');
    assert.equal(f?.code, '55000');
    assert.equal((await db.query(`SELECT 1 FROM auth.users WHERE id='${u}'`)).rows.length, 1);
    await db.exec(`DELETE FROM auth.users WHERE id='${u}'`);
    assert.equal((await db.query(`SELECT 1 FROM public.users WHERE id='${u}'`)).rows.length, 0);
  });
});

describe('Bildirimler', () => {
  test('yalnızca okundu bilgisi değişir', async () => {
    const u = await user();
    const { rows } = await db.query(`INSERT INTO public.notifications (user_id, title, body, type) VALUES ('${u}','a','b','promo') RETURNING id`);
    const f = await failure(db, u, `UPDATE public.notifications SET type='seller_update', created_at='2099-01-01' WHERE id='${rows[0].id}'`);
    assert.equal(f?.code, '42501');
    await as(db, u, `UPDATE public.notifications SET is_read=true WHERE id='${rows[0].id}'`);
    assert.equal((await db.query(`SELECT is_read FROM public.notifications WHERE id='${rows[0].id}'`)).rows[0].is_read, true);
  });
});

describe('Satıcı erişimi', () => {
  test('başka satıcının yemeği haftalık menüye konamaz', async () => {
    const [a, b] = [await seller(), await seller()];
    const f = await failure(db, a.uid, `INSERT INTO public.weekly_menu (seller_id, menu_item_id, day_of_week) VALUES ('${a.id}','${b.item}',1)`);
    assert.equal(f?.code, '42501');
    await as(db, a.uid, `INSERT INTO public.weekly_menu (seller_id, menu_item_id, day_of_week) VALUES ('${a.id}','${a.item}',1)`);
  });
  test('onaylanmamış başvuru herkese görünmez', async () => {
    const applicant = await user();
    const { rows } = await as(db, applicant, `INSERT INTO public.sellers (user_id, display_name, address_line) VALUES ('${applicant}','Yeni','Gizli Sok.') RETURNING id, is_active`);
    assert.equal(rows[0].is_active, false);
    assert.equal((await as(db, applicant, `SELECT id FROM public.sellers WHERE id='${rows[0].id}'`)).rows.length, 1);
    assert.equal((await as(db, await user(), `SELECT id FROM public.sellers WHERE id='${rows[0].id}'`)).rows.length, 0);
    await db.exec(`SET ROLE anon`);
    const anon = await db.query(`SELECT id FROM public.sellers WHERE id='${rows[0].id}'`);
    await db.exec(`RESET ROLE`);
    assert.equal(anon.rows.length, 0);
  });
  test('kapanan satıcı, ondan sipariş vermiş müşteriye görünmeye devam eder', async () => {
    const s = await seller();
    const buyer = await user();
    await order(buyer, s);
    await db.exec(`UPDATE public.sellers SET is_active=false WHERE id='${s.id}'`);
    assert.equal((await as(db, buyer, `SELECT id FROM public.sellers WHERE id='${s.id}'`)).rows.length, 1);
  });
});

describe('Ödeme kayıtları', () => {
  test('sipariş başına tek başlatma, serbest bırakılınca yeniden denenir', async () => {
    const s = await seller();
    const o = (await order(await user(), s)).rows[0];
    const claim = async () => (await db.query('SELECT public.claim_payment_init($1) AS ok', [o.id])).rows[0].ok;
    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    await db.query('SELECT public.release_payment_init($1)', [o.id]);
    assert.equal(await claim(), true);
  });
  test('iade bir kez başlar, 10 dakika sonra yeniden denenir', async () => {
    const s = await seller();
    const o = (await order(await user(), s)).rows[0];
    await db.query('SELECT public.claim_payment_init($1)', [o.id]);
    const claim = async () => (await db.query('SELECT public.claim_payment_refund($1) AS ok', [o.id])).rows[0].ok;
    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    await db.exec(`UPDATE public.order_payments SET refund_started_at = now() - interval '11 minutes' WHERE order_id='${o.id}'`);
    assert.equal(await claim(), true);
  });
  test('istemci bu fonksiyonları çağıramaz', async () => {
    const u = await user();
    const s = await seller();
    const o = (await order(u, s)).rows[0];
    for (const fn of ['claim_payment_init', 'release_payment_init', 'claim_payment_refund']) {
      const f = await failure(db, u, `SELECT public.${fn}($1)`, [o.id]);
      assert.equal(f?.code, '42501', fn);
    }
  });
});

describe('Hesap silme', () => {
  test('siparişi olan satıcının belge kayıtları silinir', async () => {
    const s = await seller();
    const o = (await order(await user(), s)).rows[0];
    await db.exec(`UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    await db.exec(`INSERT INTO public.seller_documents (seller_id, doc_type, storage_path) VALUES ('${s.id}','tax_certificate','${s.uid}/x.jpg')`);
    await as(db, s.uid, 'SELECT public.delete_my_account()');
    assert.equal((await db.query(`SELECT 1 FROM public.seller_documents WHERE seller_id='${s.id}'`)).rows.length, 0);
    assert.equal((await db.query(`SELECT user_id FROM public.sellers WHERE id='${s.id}'`)).rows[0].user_id, null);
  });
});
