// 037: bağımsız incelemede bulunan sunucu hataları. Her test düzeltmeden önce başarısız oluyordu.
import { test, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  await db.exec(`UPDATE public.app_config SET value='{"enabled": true}' WHERE key='online_payment'`);
  admin = await user('admin');
});

async function user(role = 'buyer', phone = null, target = db) {
  const id = randomUUID();
  await target.exec(`
    INSERT INTO auth.users (id, phone, phone_confirmed_at) VALUES ('${id}', ${phone ? `'${phone}', now()` : 'NULL, NULL'});
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

// Komisyon %8, teslimat ₺15. Yemek ₺100: toplam ₺115, komisyon ₺8, satıcının hakkı ₺107.
async function seller(target = db) {
  const uid = await user('seller', null, target);
  const id = randomUUID();
  const item = randomUUID();
  await target.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Lokanta',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

const one = async (sql) => (await db.query(sql)).rows[0];
const ITEMS = (s) => JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]);
const PLACE = 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)';
const placeOn = (target, uid, s, { method = 'cash', coupon = null } = {}) =>
  as(target, uid, PLACE, [s.id, ITEMS(s), 'Test Mah. Test Sok. No:1', method, coupon]).then((r) => r.rows[0]);
const place = (uid, s, options) => placeOn(db, uid, s, options);
const placeFails = (uid, s, { method = 'cash', coupon = null } = {}) =>
  failure(db, uid, PLACE, [s.id, ITEMS(s), 'Test Mah. Test Sok. No:1', method, coupon]);

const deliver = async (s, id) => {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${id}'`);
  }
};

describe('1. Kapıda ödeme sınırı: planlı ve unutulmuş sipariş müşteriyi kilitlemez', () => {
  const setRules = (patch = {}) =>
    db.exec(`UPDATE public.app_config SET value = public.fraud_rule_defaults() || '${JSON.stringify(patch)}'::jsonb WHERE key='fraud_rules'`);
  beforeEach(() => setRules());

  /** Tetikleyici sınırına takılmadan doğrudan satır (service role gibi). */
  async function direct(uid, s, { status = 'pending', scheduledFor = null, changedHoursAgo = 0, createdHoursAgo = 0 } = {}) {
    const id = randomUUID();
    await db.exec(`
      INSERT INTO public.orders (id, customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
                                 delivery_address, payment_method, payment_status, scheduled_for, created_at, status_changed_at)
      VALUES ('${id}','${uid}','${s.id}','${status}',10000,0,10000,'TRY','Test Mah. No:1','cash','pending',
              ${scheduledFor ? `now() + interval '${scheduledFor}'` : 'NULL'},
              now() - make_interval(hours => ${createdHoursAgo}), now() - make_interval(hours => ${changedHoursAgo}));
    `);
    return id;
  }
  const twoOrders = async (uid, s, options) => {
    await direct(uid, s, options);
    await direct(uid, s, options);
  };

  test('günler sonrasına planlı siparişler sayılmaz', async () => {
    const s = await seller();
    const uid = await user();
    await twoOrders(uid, s, { scheduledFor: '3 days' });
    assert.ok(await place(uid, s));
  });

  test('iki saat içine planlı sipariş sayılır, saati geçmiş planlı da', async () => {
    const s = await seller();
    const uid = await user();
    await direct(uid, s, { status: 'accepted', scheduledFor: '1 hour' });
    await direct(uid, s, { status: 'accepted', scheduledFor: '-1 hour' });
    assert.equal((await placeFails(uid, s))?.code, '55000');
  });

  test('12 saatten eski durumda kalan unutulmuş sipariş sayılmaz', async () => {
    for (const status of ['accepted', 'preparing', 'ready', 'out_for_delivery']) {
      const s = await seller();
      const uid = await user();
      await twoOrders(uid, s, { status, changedHoursAgo: 13 });
      assert.ok(await place(uid, s), status);
    }
  });

  test('12 saati dolmamış ve planlı olmayan sipariş sayılmaya devam eder', async () => {
    const s = await seller();
    const uid = await user();
    await twoOrders(uid, s, { status: 'accepted', changedHoursAgo: 11 });
    const f = await placeFails(uid, s);
    assert.equal(f?.code, '55000');
    assert.match(f.message, /Aynı anda en çok 2/);
  });

  test('durum zamanı boşsa oluşturma zamanına bakılır', async () => {
    const s = await seller();
    const old = await user();
    await twoOrders(old, s, { status: 'accepted', createdHoursAgo: 13 });
    await db.exec(`UPDATE public.orders SET status_changed_at = NULL WHERE customer_id='${old}'`);
    assert.ok(await place(old, s));

    const fresh = await user();
    await twoOrders(fresh, s, { status: 'accepted', createdHoursAgo: 1, changedHoursAgo: 1 });
    await db.exec(`UPDATE public.orders SET status_changed_at = NULL WHERE customer_id='${fresh}'`);
    assert.equal((await placeFails(fresh, s))?.code, '55000');
  });

  test('süreler fraud_rules ile değişir, varsayılanlar iki ve on iki saat', async () => {
    const defaults = (await one('SELECT public.fraud_rule_defaults() AS d')).d;
    assert.equal(defaults.door_active_horizon_hours, 2);
    assert.equal(defaults.door_active_stale_hours, 12);

    const s = await seller();
    const planned = await user();
    await twoOrders(planned, s, { scheduledFor: '3 days' });
    await setRules({ door_active_horizon_hours: 100 });
    assert.equal((await placeFails(planned, s))?.code, '55000');

    await setRules({ door_active_stale_hours: 1 });
    const stale = await user();
    await twoOrders(stale, s, { status: 'accepted', changedHoursAgo: 2 });
    assert.ok(await place(stale, s));

    // Bozuk ayar sipariş almayı durdurmaz, varsayılan geçerli olur.
    await setRules({ door_active_stale_hours: 'bozuk' });
    const broken = await user();
    await twoOrders(broken, s, { status: 'accepted', changedHoursAgo: 13 });
    assert.ok(await place(broken, s));
  });

  test('unutulmuş sipariş kendiliğinden kapanmaz', async () => {
    const s = await seller();
    const uid = await user();
    const id = await direct(uid, s, { status: 'preparing', changedHoursAgo: 48 });
    await as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
    assert.equal((await one(`SELECT status FROM public.orders WHERE id='${id}'`)).status, 'preparing');
  });
});

describe('1. Eski kurye konumu silinir', () => {
  const location = async (s, uid, hours) => {
    const id = randomUUID();
    await db.exec(`
      INSERT INTO public.orders (id, customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
                                 delivery_address, payment_method, payment_status)
      VALUES ('${id}','${uid}','${s.id}','out_for_delivery',10000,0,10000,'TRY','Test Mah. No:1','cash','pending');
      INSERT INTO public.order_courier_locations (order_id, lat, lng, updated_at)
      VALUES ('${id}', 41, 29, now() - make_interval(hours => ${hours}));
    `);
    return id;
  };
  const has = async (id) => (await one(`SELECT count(*)::int AS n FROM public.order_courier_locations WHERE order_id='${id}'`)).n === 1;

  test('altı saat güncellenmeyen satır gider, güncel olan kalır, sipariş değişmez', async () => {
    const s = await seller();
    const uid = await user();
    const stale = await location(s, uid, 7);
    const fresh = await location(s, uid, 5);
    await as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
    assert.equal(await has(stale), false);
    assert.equal(await has(fresh), true);
    assert.equal((await one(`SELECT status FROM public.orders WHERE id='${stale}'`)).status, 'out_for_delivery');
  });

  test('görevin diğer işleri sürer: cevapsız sipariş yine iptal olur', async () => {
    const s = await seller();
    const uid = await user();
    const o = await place(uid, s);
    await db.exec(`UPDATE public.orders SET pending_since = now() - interval '31 minutes' WHERE id='${o.id}'`);
    const { rows } = await as(db, null, 'SELECT public.expire_pending_orders(10, 30) AS n');
    assert.ok(rows[0].n >= 1);
    assert.equal((await one(`SELECT status FROM public.orders WHERE id='${o.id}'`)).status, 'cancelled');
  });
});

describe('2. Pazaryeri: iyzico onaylı dediği halde kayıt bekliyor görünen sipariş', () => {
  async function payMarketplace(s, buyer) {
    const o = await place(buyer, s, { method: 'online' });
    await as(db, null, 'SELECT public.record_payment_init($1,$2,$3,$4,$5,$6)', [o.id, `token-${o.id}`, true, 'KEY', 10700, null]);
    await as(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4) AS r', [
      o.id, 'P1', JSON.stringify([{ paymentTransactionId: 999, paidPrice: 115 }]), 11500,
    ]);
    return o;
  }
  /** Teslim edildi, müşteri iade istedi, yönetici onayladı: para iade bekliyor. */
  async function refundPending() {
    const s = await seller();
    const buyer = await user();
    const o = await payMarketplace(s, buyer);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.equal((await one(`SELECT payment_status FROM public.orders WHERE id='${o.id}'`)).payment_status, 'refund_pending');
    return { s, o };
  }
  const debt = async (s) => (await as(db, admin, 'SELECT * FROM public.admin_payout_overview()')).rows.find((r) => r.seller_id === s.id);
  const status = async (id) => (await one(`SELECT marketplace_status AS m FROM public.orders WHERE id='${id}'`)).m;
  const queue = async (id) => (await one(`SELECT status FROM public.payment_approvals WHERE order_id='${id}'`)).status;
  const recordApproved = (id) => as(db, null, `SELECT public.mark_marketplace_approved('${id}')`);

  test('geri çekme başarısız, panelden iade edildi: satıcının payı borç olur', async () => {
    const { s, o } = await refundPending();
    // handleRefund'ın sırası: kuyruk iptal, iyzico "onaylı" dedi, kayıt düzeltildi, geri çekme başarısız.
    await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}')`);
    assert.equal(await status(o.id), 'held');
    await recordApproved(o.id);
    assert.equal(await status(o.id), 'approved');
    assert.equal(await queue(o.id), 'approved');
    assert.equal(await debt(s), undefined, 'iade yapılmadan borç doğmaz');

    await as(db, admin, `SELECT public.admin_mark_refunded('${o.id}')`);
    const row = await debt(s);
    assert.equal(row.balance_cents, -10700);
    assert.equal(row.order_count, 1);
  });

  test('geri çekme başarılı: kayıt geri döner, borç doğmaz', async () => {
    const { s, o } = await refundPending();
    await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}')`);
    await recordApproved(o.id);
    await as(db, null, `SELECT public.mark_marketplace_reversed('${o.id}')`);
    await as(db, null, `SELECT public.mark_order_refunded('${o.id}')`);
    assert.equal(await status(o.id), 'reversed');
    assert.equal(await debt(s), undefined);
  });

  test('önceki denemede geri alınmış görünen sipariş için de iyzico kazanır', async () => {
    const { s, o } = await refundPending();
    await as(db, null, `SELECT public.mark_marketplace_reversed('${o.id}')`);
    await recordApproved(o.id);
    assert.equal(await status(o.id), 'approved');
    await as(db, admin, `SELECT public.admin_mark_refunded('${o.id}')`);
    assert.equal((await debt(s)).balance_cents, -10700);
  });

  test('pazaryerinden geçmeyen siparişe dokunmaz, tekrar çağrı zarar vermez', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    await recordApproved(o.id);
    assert.equal(await status(o.id), null);
    const refund = await refundPending();
    await recordApproved(refund.o.id);
    await recordApproved(refund.o.id);
    assert.equal(await status(refund.o.id), 'approved');
  });

  test('yalnızca service role çağırır', async () => {
    const id = randomUUID();
    for (const who of [await user(), admin]) {
      assert.equal((await failure(db, who, `SELECT public.mark_marketplace_approved('${id}')`))?.code, '42501');
    }
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
    await assert.rejects(db.query(`SELECT public.mark_marketplace_approved('${id}')`), /permission denied/);
    await db.exec('RESET ROLE');
  });

  test('onay yanıtı, iade kuyruğu iptal ettikten sonra gelirse onay kaydedilir, borç doğar', async () => {
    const { s, o } = await refundPending();
    // Görev satırı aldı, onay yoldayken yönetici iade edildi olarak işaretledi (kilide bakmaz).
    await db.exec(`UPDATE public.payment_approvals SET locked_until = now() + interval '5 minutes' WHERE order_id='${o.id}'`);
    await as(db, admin, `SELECT public.admin_mark_refunded('${o.id}')`);
    assert.equal(await queue(o.id), 'cancelled');
    assert.equal(await debt(s), undefined);

    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal(await status(o.id), 'approved');
    assert.equal(await queue(o.id), 'approved');
    assert.equal((await debt(s)).balance_cents, -10700);
  });

  test('kilit süresi dolmuşken iade başladıysa onay yine kaydedilir, geri çekme yolu açık kalır', async () => {
    const { s, o } = await refundPending();
    assert.equal((await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}') AS r`)).rows[0].r, 'cancelled');
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal(await status(o.id), 'approved');
    assert.equal(await debt(s), undefined, 'iade bekliyor, geri çekilirse çift kayıt olmasın');
    assert.equal((await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}') AS r`)).rows[0].r, 'approved');
  });

  test('iyzico sorulup geri alındıysa geç gelen onay yanıtı kaydı bozmaz', async () => {
    const { s, o } = await refundPending();
    await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}')`);
    await as(db, null, `SELECT public.mark_marketplace_reversed('${o.id}')`);
    await as(db, null, `SELECT public.mark_order_refunded('${o.id}')`);
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal(await status(o.id), 'reversed');
    assert.equal(await queue(o.id), 'cancelled');
    assert.equal(await debt(s), undefined);
  });

  test('normal onay akışı değişmedi', async () => {
    const s = await seller();
    const o = await payMarketplace(s, await user());
    await deliver(s, o.id);
    await as(db, null, 'SELECT * FROM public.claim_payment_approvals(100)');
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal(await status(o.id), 'approved');
    assert.equal(await queue(o.id), 'approved');
    assert.equal(await debt(s), undefined);
  });
});

describe('3. Kupon: telefon başına hak hesap silinince sıfırlanmaz', () => {
  const coupon = async (perUser = 1, target = db) => {
    const code = `K${randomUUID().slice(0, 8)}`.toUpperCase();
    await target.exec(`INSERT INTO public.coupons (code, discount_type, discount_value, max_uses_per_user) VALUES ('${code}','fixed',500,${perUser ?? 'NULL'})`);
    return code;
  };
  const couponId = async (code, target = db) => (await target.query(`SELECT id FROM public.coupons WHERE code='${code}'`)).rows[0].id;
  const phone = () => `90555${Math.floor(1000000 + Math.random() * 8999999)}`;
  const hash = (id, p) => createHash('sha256').update(`${id}:${p}`).digest('hex');
  const uses = async (id, target = db) => (await target.query(`SELECT * FROM public.coupon_phone_uses WHERE coupon_id='${id}'`)).rows;

  test('hesap silinip aynı telefonla yeni hesap açılınca kupon yine kullanılamaz', async () => {
    const s = await seller();
    const code = await coupon();
    const p = phone();
    const a = await user('buyer', p);
    const o = await place(a, s, { coupon: code });
    await deliver(s, o.id);
    await as(db, a, 'SELECT public.delete_my_account()');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.coupon_redemptions WHERE user_id='${a}'`)).rows[0].n, 0);

    const f = await placeFails(await user('buyer', p), s, { coupon: code });
    assert.equal(f?.code, '55000');
    assert.match(f.message, /telefon numaran/);
  });

  test('yalnızca kupon, özet ve zaman saklanır; telefonun kendisi ve hesap bağı yok', async () => {
    const s = await seller();
    const code = await coupon();
    const id = await couponId(code);
    const p = phone();
    await place(await user('buyer', p), s, { coupon: code });

    const rows = await uses(id);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['coupon_id', 'created_at', 'phone_hash']);
    assert.equal(rows[0].phone_hash, hash(id, p));
    assert.equal(JSON.stringify(rows[0]).includes(p), false);

    const { rows: columns } = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coupon_redemptions' AND column_name='verified_phone'`,
    );
    assert.equal(columns.length, 0, 'ham telefon sütunu kaldırıldı');
  });

  test('tablo istemciye kapalı: müşteri, yönetici ve girişsiz okuyamaz, yazamaz', async () => {
    const s = await seller();
    const code = await coupon();
    const id = await couponId(code);
    const a = await user('buyer', phone());
    await place(a, s, { coupon: code });
    for (const who of [a, admin]) {
      assert.equal((await failure(db, who, 'SELECT * FROM public.coupon_phone_uses'))?.code, '42501');
      assert.equal((await failure(db, who, `DELETE FROM public.coupon_phone_uses WHERE coupon_id='${id}'`))?.code, '42501');
      assert.equal((await failure(db, who, `INSERT INTO public.coupon_phone_uses (coupon_id, phone_hash) VALUES ('${id}','x')`))?.code, '42501');
    }
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
    await assert.rejects(db.query('SELECT * FROM public.coupon_phone_uses'), /permission denied/);
    await db.exec('RESET ROLE');
    assert.equal((await uses(id)).length, 1);
  });

  test('iptal hakkı geri verir, kayıt da silinir', async () => {
    const s = await seller();
    const code = await coupon();
    const id = await couponId(code);
    const p = phone();
    const a = await user('buyer', p);
    const o = await place(a, s, { coupon: code });
    await as(db, a, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await uses(id)).length, 0);
    assert.ok(await place(await user('buyer', p), s, { coupon: code }));
  });

  test('iki haklı kuponda iptal yalnızca bir hak geri verir', async () => {
    const s = await seller();
    const code = await coupon(2);
    const id = await couponId(code);
    const a = await user('buyer', phone());
    const first = await place(a, s, { coupon: code });
    await place(a, s, { coupon: code });
    assert.equal((await uses(id)).length, 2);
    await as(db, a, `UPDATE public.orders SET status='cancelled' WHERE id='${first.id}'`);
    assert.equal((await uses(id)).length, 1);
  });

  test('doğrulanmamış hesap iz bırakmaz', async () => {
    const s = await seller();
    const code = await coupon();
    await place(await user(), s, { coupon: code });
    assert.equal((await uses(await couponId(code))).length, 0);
  });

  test('canlıdaki eski kullanımlar taşınır: 036 üstüne 037', async () => {
    const old = await createDb({ until: '037' });
    await allowManyDoorOrders(old);
    const s = await seller(old);
    const code = await coupon(1, old);
    const id = await couponId(code, old);
    const recorded = phone();
    await placeOn(old, await user('buyer', recorded, old), s, { coupon: code });
    // Önce doğrulanmamış, sonra doğrulanmış: 035 satıra telefon yazmadı, güncel numaradan bulunur.
    const later = phone();
    const lateUser = await user('buyer', null, old);
    await placeOn(old, lateUser, s, { coupon: code });
    await old.exec(`UPDATE auth.users SET phone='${later}', phone_confirmed_at=now() WHERE id='${lateUser}'`);

    const migration = readFileSync(new URL('../../supabase/migrations/037_review_fixes.sql', import.meta.url), 'utf8');
    await old.exec(migration);
    const hashes = (await uses(id, old)).map((r) => r.phone_hash).sort();
    assert.deepEqual(hashes, [hash(id, recorded), hash(id, later)].sort());

    // Yeniden çalıştırmak çift kayıt yazmaz ve hata vermez.
    await old.exec(migration);
    assert.equal((await uses(id, old)).length, 2);
    await old.close();
  });
});

describe('Canlıya alma belgesi', () => {
  const doc = readFileSync(new URL('../../docs/CANLIYA-ALMA.md', import.meta.url), 'utf8');

  test('037 iki migration listesinde de var', () => {
    assert.match(doc, /`036`, `037`\. `023` online/);
    assert.match(doc, /sonradan çalıştırılabilir,[^.]*`036`, `037`\./);
  });

  test('büyük bahşiş sandbox denemesi ve geri çekilemeyen iadenin koşulu yazılı', () => {
    const section = doc.slice(doc.indexOf('## Otomatik satıcı ödemesi'), doc.indexOf('## 6. Tanıtım sayfası'));
    assert.match(section, /Sandbox'ta mutlaka dene, büyük bahşiş/);
    assert.match(section, /"İade Et"i en az bir kez dene/);
  });
});

describe('6. Satıcı ödeme hesabı: updated_at cihaz saatinden gelmez', () => {
  const IBAN = 'TR000000000000000000000001';
  const save = (s, deviceTime, iban = IBAN) => as(db, s.uid, `
    INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name, updated_at)
    VALUES ('${s.id}', '${iban}', 'Lokanta Ltd', '${deviceTime}')
    ON CONFLICT (seller_id) DO UPDATE SET iban = EXCLUDED.iban, account_name = EXCLUDED.account_name, updated_at = EXCLUDED.updated_at`);
  const skew = async (s) => (await one(`SELECT abs(extract(epoch FROM updated_at - now()))::float AS s FROM public.seller_payout_accounts WHERE seller_id='${s.id}'`)).s;
  const needsSync = async (s) =>
    (await as(db, admin, 'SELECT * FROM public.admin_marketplace_sellers()')).rows.find((r) => r.seller_id === s.id).needs_sync;

  test('eklerken ve güncellerken istemcinin yolladığı zaman yok sayılır', async () => {
    const s = await seller();
    await save(s, '2099-01-01T00:00:00Z');
    assert.ok(await skew(s) < 60, 'ekleme');
    await save(s, '2099-01-01T00:00:00Z', 'TR000000000000000000000002');
    assert.ok(await skew(s) < 60, 'güncelleme');
    await as(db, null, `UPDATE public.seller_payout_accounts SET updated_at='2000-01-01' WHERE seller_id='${s.id}'`);
    assert.ok(await skew(s) < 60, 'service role da');
  });

  test('ileri saatli cihaz kaydı sonsuza dek "güncelleme gerekir" göstermez', async () => {
    const s = await seller();
    await db.exec(`INSERT INTO public.seller_submerchants (seller_id, submerchant_key, status, synced_at) VALUES ('${s.id}','KEY-${s.id}','active', now() + interval '1 minute')`);
    await save(s, '2099-01-01T00:00:00Z');
    assert.equal(await needsSync(s), false);
  });

  test('geri saatli cihazda yapılan IBAN değişikliği gözden kaçmaz', async () => {
    const s = await seller();
    await db.exec(`INSERT INTO public.seller_submerchants (seller_id, submerchant_key, status, synced_at) VALUES ('${s.id}','KEY-${s.id}','active', now() - interval '1 hour')`);
    await save(s, '2000-01-01T00:00:00Z');
    assert.equal(await needsSync(s), true);
  });
});
