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

async function seller(columns = '', values = '', price = 10000, limit = 0) {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active${columns ? ', ' + columns : ''})
      VALUES ('${id}','${uid}','Mağaza',true${values ? ', ' + values : ''});
    INSERT INTO public.menu_items (id, seller_id, title, price_cents, daily_limit) VALUES ('${item}','${id}','Yemek',${price},${limit});
  `);
  return { uid, id, item };
}

const ADDRESS = 'Test Mah. Test Sok. No:1';
const lines = (s, quantity = 1) => JSON.stringify([{ menu_item_id: s.item, quantity }]);

// Adlandırılmış parametrelerle: uygulamanın RPC çağrısıyla aynı.
const place = (buyer, s, o = {}) => as(db, buyer, `SELECT * FROM public.place_order(
    p_seller_id => $1, p_items => $2::jsonb, p_delivery_address => $3, p_payment_method => $4,
    p_coupon_code => $5, p_delivery_lat => $6, p_delivery_lng => $7, p_expected_total_cents => $8)`,
  [s.id, lines(s, o.quantity ?? 1), ADDRESS, o.method ?? 'cash', o.coupon ?? null, o.lat ?? null, o.lng ?? null, o.expected ?? null])
  .then((r) => r.rows[0]);

const placeError = (buyer, s, o = {}) => place(buyer, s, o).then(() => null, (e) => ({ code: e.code, message: e.message, detail: e.detail }));

async function deliver(s, id) {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${id}'`);
  }
}

const enableOnline = (on = true) => db.exec(`UPDATE public.app_config SET value='{"enabled": ${on}}' WHERE key='online_payment'`);

// Edge Function'lar service_role ile çağırır.
async function service(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}

describe('Satıcıya özel teslimat ayarları', () => {
  test('ayar yoksa platform varsayılanı geçerlidir', async () => {
    const o = await place(await user(), await seller());
    assert.equal(o.delivery_fee_cents, 1500);
    assert.equal(o.total_cents, 11500);
  });

  test('satıcının ücreti ve ücretsiz teslimat limiti uygulanır', async () => {
    const s = await seller('delivery_fee_cents, free_delivery_threshold_cents', '2500, 30000');
    const buyer = await user();
    assert.equal((await place(buyer, s)).delivery_fee_cents, 2500);
    const o = await place(buyer, s, { quantity: 3 });
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.total_cents, 30000);
  });

  test('sıfır teslimat ücreti geçerlidir, boş sayılmaz', async () => {
    const o = await place(await user(), await seller('delivery_fee_cents', '0'));
    assert.equal(o.delivery_fee_cents, 0);
  });

  test('minimum sipariş uygulanır ve hata tutarı söyler; stok düşmez', async () => {
    const s = await seller('min_order_cents', '25000', 10000, 5);
    const buyer = await user();
    const err = await placeError(buyer, s);
    assert.match(err?.message ?? '', /Minimum sipariş tutarı: ₺250/);
    assert.equal((await one(`SELECT sold_today FROM public.menu_items WHERE id='${s.item}'`)).sold_today, 0);
    assert.ok(await place(buyer, s, { quantity: 3 }));
  });

  test('satıcı kendi ayarını değiştirir; başkası ve geçersiz değerler reddedilir', async () => {
    const s = await seller();
    await as(db, s.uid, `UPDATE public.sellers SET delivery_fee_cents=2000, min_order_cents=5000, delivery_time_min=10, delivery_time_max=20, delivery_radius_km=5 WHERE id='${s.id}'`);
    const row = await one(`SELECT delivery_fee_cents, delivery_radius_km FROM public.sellers WHERE id='${s.id}'`);
    assert.equal(row.delivery_fee_cents, 2000);
    assert.equal(Number(row.delivery_radius_km), 5);

    assert.equal((await as(db, await user(), `UPDATE public.sellers SET delivery_fee_cents=0 WHERE id='${s.id}'`)).affectedRows, 0);
    for (const bad of ['delivery_fee_cents=-1', 'min_order_cents=-1', 'delivery_time_min=50, delivery_time_max=20', 'delivery_radius_km=0', 'latitude=200']) {
      const err = await failure(db, s.uid, `UPDATE public.sellers SET ${bad} WHERE id='${s.id}'`);
      assert.equal(err?.code, '23514', bad);
    }
  });
});

describe('Konuma göre teslimat', () => {
  // Kadıköy merkez ve yakın noktalar
  const K = { lat: 40.9906, lng: 29.0239 };
  const located = (radius = 5) => seller('latitude, longitude, delivery_radius_km', `${K.lat}, ${K.lng}, ${radius}`);

  test('mesafe hesabı gerçek değerlerle tutarlıdır', async () => {
    const r = await one(`SELECT public.distance_km(41.0082, 28.9784, 39.9334, 32.8597) AS km`);
    assert.ok(Math.abs(Number(r.km) - 351) < 5, `İstanbul-Ankara ~351 km, bulunan ${r.km}`);
    assert.equal(Number((await one(`SELECT public.distance_km(41, 29, 41, 29) AS km`)).km), 0);
  });

  test('alan içi kabul, alan dışı reddedilir, sınır dahildir', async () => {
    const s = await located(5);
    const buyer = await user();
    assert.ok(await place(buyer, s, { lat: 41.0, lng: 29.03 }));
    const far = await placeError(buyer, s, { lat: 41.1, lng: 29.03 });
    assert.equal(far?.code, 'EVN03');
  });

  test('konumu bilinen satıcıda teslimat konumu zorunludur; geçersiz koordinat reddedilir', async () => {
    const s = await located();
    const buyer = await user();
    assert.equal((await placeError(buyer, s))?.code, 'EVN02');
    assert.equal((await placeError(buyer, s, { lat: 999, lng: 29 }))?.code, 'EVN02');
  });

  test('konumu olmayan eski satıcıda alan denetlenmez', async () => {
    assert.ok(await place(await user(), await seller(), { lat: 39.93, lng: 32.86 }));
  });

  test('place_order tek imzayla kalır', async () => {
    assert.equal((await one(`SELECT count(*)::int AS n FROM pg_proc WHERE proname='place_order'`)).n, 1);
  });
});

describe('Davet ödülü', () => {
  const myCode = async (uid) => (await as(db, uid, 'SELECT public.get_my_referral_code() AS c')).rows[0].c;
  const applyCode = (uid, code) => as(db, uid, 'SELECT public.apply_referral_code($1) AS c', [code]).then((r) => r.rows[0].c);
  const applyError = (uid, code) => applyCode(uid, code).then(() => null, (e) => ({ code: e.code, message: e.message }));

  test('kod kalıcıdır ve kişiye özeldir', async () => {
    const a = await user();
    const code = await myCode(a);
    assert.match(code, /^EV[0-9A-F]{6}$/);
    assert.equal(await myCode(a), code);
    assert.notEqual(await myCode(await user()), code);
  });

  test('tam akış: davetli kupon alır, ilk tesliminde davet eden ödül kazanır, ikinci sipariş ödül vermez', async () => {
    const referrer = await user();
    const referred = await user();
    const s = await seller();
    const coupon = await applyCode(referred, (await myCode(referrer)).toLowerCase());
    assert.match(coupon, /^ODUL/);

    const c = await one(`SELECT owner_id, discount_type, discount_value, min_order_cents, max_uses FROM public.coupons WHERE code='${coupon}'`);
    assert.equal(c.owner_id, referred);
    assert.equal(c.discount_type, 'fixed');
    assert.equal(c.discount_value, 1500);
    assert.equal(c.min_order_cents, 5000);

    const count = async () => (await one(`SELECT count(*)::int AS n FROM public.coupons WHERE owner_id='${referrer}'`)).n;
    const o = await place(referred, s, { coupon });
    assert.equal(o.discount_cents, 1500);
    assert.equal(await count(), 0, 'teslimden önce ödül yok');

    await deliver(s, o.id);
    assert.equal(await count(), 1);
    const l = await one(`SELECT referral_count, referral_earnings FROM public.loyalty WHERE user_id='${referrer}'`);
    assert.equal(l.referral_count, 1);
    assert.equal(l.referral_earnings, 1500);
    const n = await one(`SELECT body FROM public.notifications WHERE user_id='${referrer}' AND type='promo'`);
    assert.match(n.body, /ODUL/);

    await deliver(s, (await place(referred, s)).id);
    assert.equal(await count(), 1, 'ödül bir kez verilir');
  });

  test('iptal edilen sipariş ödül vermez, kod sonra da kullanılabilir', async () => {
    const referrer = await user();
    const referred = await user();
    const s = await seller();
    const code = await myCode(referrer);
    const o = await place(referred, s);
    await as(db, referred, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.match(await applyCode(referred, code), /^ODUL/);
  });

  test('kurallar: kendi kodu, geçersiz kod, ikinci kullanım, sipariş vermiş kullanıcı', async () => {
    const a = await user();
    const code = await myCode(a);
    assert.equal((await applyError(a, code))?.code, '55000');
    assert.equal((await applyError(await user(), 'YOK'))?.code, '55000');

    const b = await user();
    await applyCode(b, code);
    assert.equal((await applyError(b, code))?.code, '55000');

    const c = await user();
    await place(c, await seller());
    assert.match((await applyError(c, code))?.message ?? '', /ilk siparişten önce/);
  });

  test('₺50 altı teslim ödül vermez', async () => {
    const referrer = await user();
    const referred = await user();
    const s = await seller('', '', 2000);
    await applyCode(referred, await myCode(referrer));
    await deliver(s, (await place(referred, s)).id);
    assert.equal((await one(`SELECT status FROM public.referrals WHERE referred_id='${referred}'`)).status, 'pending');
  });

  test('istemci kaydı elle yazamaz; kullanıcı yalnızca kendini görür', async () => {
    const a = await user();
    const b = await user();
    await applyCode(b, await myCode(a));
    const ins = await failure(db, a, `INSERT INTO public.referrals (referrer_id, referred_id, code) VALUES ('${a}','${a}','X')`);
    assert.equal(ins?.code, '42501');
    const up = await failure(db, a, `UPDATE public.referrals SET status='completed' WHERE referrer_id='${a}'`);
    assert.equal(up?.code, '42501');
    const q = `SELECT count(*)::int AS n FROM public.referrals WHERE referred_id='${b}'`;
    assert.equal((await as(db, a, q)).rows[0].n, 1);
    assert.equal((await as(db, b, q)).rows[0].n, 1);
    assert.equal((await as(db, await user(), q)).rows[0].n, 0);
    const ic = await failure(db, a, `SELECT public.issue_referral_coupon('${a}','Hile')`);
    assert.equal(ic?.code, '42501');
  });

  test('hesap silinince davet kayıtları engel olmaz', async () => {
    const a = await user();
    const b = await user();
    await applyCode(b, await myCode(a));
    await as(db, a, 'SELECT public.delete_my_account()');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.users WHERE id='${a}'`)).n, 0);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.referrals WHERE referred_id='${b}'`)).n, 0);
  });
});

describe('Online ödeme', () => {
  const pay = (o, cents = o.total_cents) => service(
    `SELECT public.mark_order_paid($1,'PAY1','[{"paymentTransactionId":"T1","paidPrice":"1"}]'::jsonb,$2) AS r`, [o.id, cents]).then((r) => r.rows[0].r);
  const init = (o) => service(`SELECT public.record_payment_init($1,$2)`, [o.id, `tok-${o.id}`]);
  const status = (id) => one(`SELECT status, payment_status FROM public.orders WHERE id='${id}'`);
  const stockOf = async (s) => (await one(`SELECT sold_today FROM public.menu_items WHERE id='${s.item}'`)).sold_today;
  const notes = async (uid) => (await db.query(`SELECT title FROM public.notifications WHERE user_id='${uid}'`)).rows.map((r) => r.title);

  test('varsayılan olarak kapalıdır', async () => {
    await enableOnline(false);
    const err = await placeError(await user(), await seller(), { method: 'online' });
    assert.match(err?.message ?? '', /kullanılamıyor/);
  });

  test('yönetici dışında kimse açamaz', async () => {
    const r = await as(db, await user(), `UPDATE public.app_config SET value='{"enabled": true}' WHERE key='online_payment'`);
    assert.equal(r.affectedRows, 0);
    await as(db, admin, `UPDATE public.app_config SET value='{"enabled": true}' WHERE key='online_payment'`);
    assert.equal((await one(`SELECT public.online_payment_enabled() AS e`)).e, true);
    await enableOnline(false);
  });

  test('tam akış: ödeme beklerken satıcıya gitmez, ödenince sipariş olur', async () => {
    await enableOnline();
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s, { method: 'online' });
    assert.equal(o.status, 'awaiting_payment');
    assert.equal(o.payment_status, 'pending');
    assert.equal((await notes(s.uid)).length, 0);

    const kabul = await failure(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    assert.equal(kabul?.code, '42501', 'satıcı ödenmemiş siparişi kabul edemez');

    await init(o);
    assert.equal(await pay(o), 'paid');
    assert.deepEqual(await status(o.id), { status: 'pending', payment_status: 'paid' });
    assert.match((await notes(s.uid))[0], /Yeni sipariş/);

    assert.equal(await pay(o), 'already_paid', 'aynı sonuç ikinci kez gelirse sorun olmaz');
    assert.equal((await notes(s.uid)).length, 1);

    await deliver(s, o.id);
    assert.deepEqual(await status(o.id), { status: 'delivered', payment_status: 'paid' });
  });

  test('müşteri kendi ödemesini "ödendi" yapamaz; dış çağrı fonksiyonları çalıştıramaz', async () => {
    await enableOnline();
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s, { method: 'online' });
    await init(o);

    const direct = await failure(db, buyer, `UPDATE public.orders SET payment_status='paid', status='pending' WHERE id='${o.id}'`);
    assert.equal(direct?.code, '42501');
    for (const sql of [
      `SELECT public.mark_order_paid('${o.id}','X','[]'::jsonb,${o.total_cents})`,
      `SELECT public.mark_order_refunded('${o.id}')`,
      `SELECT public.record_payment_init('${o.id}','x')`,
      `SELECT public.expire_unpaid_orders(0)`,
    ]) {
      assert.equal((await failure(db, buyer, sql))?.code, '42501', sql);
    }
    assert.equal((await failure(db, buyer, `SELECT * FROM public.order_payments`)) === null ? (await as(db, buyer, 'SELECT count(*)::int AS n FROM public.order_payments')).rows[0].n : 0, 0, 'RLS');
  });

  test('tutar uyuşmazsa sipariş ödenmiş sayılmaz', async () => {
    await enableOnline();
    const o = await place(await user(), await seller(), { method: 'online' });
    await init(o);
    await assert.rejects(pay(o, o.total_cents - 1), /uyuşmuyor/);
    assert.equal((await status(o.id)).status, 'awaiting_payment');
  });

  test('nakit siparişe online ödeme işlenemez', async () => {
    const o = await place(await user(), await seller());
    await assert.rejects(pay(o), /online ödemeli değil/);
  });

  test('ödenmeden vazgeçince stok ve kupon geri gelir, satıcıya bildirim gitmez', async () => {
    await enableOnline();
    const s = await seller('', '', 10000, 5);
    const buyer = await user();
    await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value, max_uses) VALUES ('ONL${s.id.slice(0, 8)}','percent',10,1)`);
    const coupon = `ONL${s.id.slice(0, 8)}`;
    const o = await place(buyer, s, { method: 'online', coupon });
    assert.equal(await stockOf(s), 1);

    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal(await stockOf(s), 0);
    assert.equal((await one(`SELECT used_count FROM public.coupons WHERE code='${coupon}'`)).used_count, 0);
    assert.equal((await notes(s.uid)).length, 0);
    assert.equal((await status(o.id)).payment_status, 'pending');
  });

  test('süresi dolan ödeme iptal olur, yenisi etkilenmez', async () => {
    await enableOnline();
    const s = await seller('', '', 10000, 5);
    const eski = await place(await user(), s, { method: 'online' });
    const yeni = await place(await user(), s, { method: 'online' });
    await db.exec(`UPDATE public.orders SET created_at = now() - interval '30 minutes' WHERE id='${eski.id}'`);

    const n = (await service('SELECT public.expire_unpaid_orders(20) AS n')).rows[0].n;
    assert.ok(n >= 1);
    assert.equal((await status(eski.id)).status, 'cancelled');
    assert.equal((await status(yeni.id)).status, 'awaiting_payment');
    assert.equal(await stockOf(s), 1);
  });

  test('iptalden sonra gelen ödeme kaybolmaz: iade bekler', async () => {
    await enableOnline();
    const buyer = await user();
    const o = await place(buyer, await seller(), { method: 'online' });
    await init(o);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal(await pay(o), 'refund_pending');
    assert.deepEqual(await status(o.id), { status: 'cancelled', payment_status: 'refund_pending' });
  });

  test('ödenmiş sipariş satıcı veya müşteri tarafından iptal edilince iade bekler', async () => {
    await enableOnline();
    for (const by of ['seller', 'customer']) {
      const s = await seller();
      const buyer = await user();
      const o = await place(buyer, s, { method: 'online' });
      await init(o);
      await pay(o);
      await as(db, by === 'seller' ? s.uid : buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
      assert.deepEqual(await status(o.id), { status: 'cancelled', payment_status: 'refund_pending' }, by);
    }
  });

  test('onaylanan iade talebi parayı iade kuyruğuna alır; iade tamamlanınca müşteriye haber gider', async () => {
    await enableOnline();
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s, { method: 'online' });
    await init(o);
    await pay(o);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk' WHERE id='${o.id}'`);
    assert.equal((await status(o.id)).payment_status, 'paid', 'talep tek başına parayı etkilemez');

    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.equal((await status(o.id)).payment_status, 'refund_pending');

    await service('SELECT public.mark_order_refunded($1)', [o.id]);
    assert.equal((await status(o.id)).payment_status, 'refunded');
    assert.ok((await notes(buyer)).some((t) => /iade edildi/.test(t)));
    assert.ok((await one(`SELECT refunded_at FROM public.order_payments WHERE order_id='${o.id}'`)).refunded_at);

    await assert.rejects(service('SELECT public.mark_order_refunded($1)', [o.id]), /iade beklemiyor/, 'iki kez iade edilemez');
  });

  test('kapıda ödemeli siparişin iptali iade kuyruğuna girmez', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await status(o.id)).payment_status, 'pending');
  });

  test('tutar sıfırsa online ödeme açılmaz', async () => {
    await enableOnline();
    const s = await seller('delivery_fee_cents', '0');
    await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value) VALUES ('BEDAVA${s.id.slice(0, 6)}','fixed',10000)`);
    const err = await placeError(await user(), s, { method: 'online', coupon: `BEDAVA${s.id.slice(0, 6)}` });
    assert.match(err?.message ?? '', /Ödenecek tutar yok/);
  });

  test('yönetici ödeme kaydını görür, başkası görmez', async () => {
    await enableOnline();
    const o = await place(await user(), await seller(), { method: 'online' });
    await init(o);
    const q = `SELECT count(*)::int AS n FROM public.order_payments WHERE order_id='${o.id}'`;
    assert.equal((await as(db, admin, q)).rows[0].n, 1);
    assert.equal((await as(db, await user(), q)).rows[0].n, 0);
  });

  test('hesap silme: devam eden online sipariş engeller, biteni engellemez', async () => {
    await enableOnline();
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s, { method: 'online' });
    assert.equal((await failure(db, buyer, 'SELECT public.delete_my_account()'))?.code, '55000');
    await init(o);
    await pay(o);
    await deliver(s, o.id);
    await as(db, buyer, 'SELECT public.delete_my_account()');
    assert.equal((await one(`SELECT customer_id FROM public.orders WHERE id='${o.id}'`)).customer_id, null);
  });

  test('kurallar korunur: iki eski koruma regresyon denetimi', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    const tutar = await failure(db, s.uid, `UPDATE public.orders SET total_cents=1 WHERE id='${o.id}'`);
    assert.equal(tutar?.code, '42501');
    const atla = await failure(db, s.uid, `UPDATE public.orders SET status='delivered' WHERE id='${o.id}'`);
    assert.equal(atla?.code, '42501');
  });
});
