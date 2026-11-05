import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure, allowRepeatDoorCoupons } from './harness.mjs';
import { orderBalanceCents, orderNetCents } from '../../lib/earnings.ts';

let db;
let admin;

before(async () => {
  db = await createDb();
  await allowRepeatDoorCoupons(db);
  // 035: aynı müşteriyle çok sayıda tamamlanmamış sipariş açılıyor, kapıda ödeme sınırı bu dosyanın konusu değil.
  await allowManyDoorOrders(db);
  admin = await user('admin');
});

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => (await db.query(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0].n;

async function user(role = 'buyer', name = 'Test') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','${name}','${role}',true);
  `);
  return id;
}

// Komisyon %8, teslimat ₺15 (₺150 üstü ücretsiz). Yemek ₺100: teslimat ücreti uygulanır.
async function seller(price = 10000) {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Mağaza',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',${price});
  `);
  return { uid, id, item };
}

const placeOrder = (buyer, s, coupon = null, method = 'cash') =>
  as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method, coupon]).then((r) => r.rows[0]);

const orderFails = (buyer, s, coupon) =>
  failure(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', coupon]);

async function deliver(s, orderId) {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${orderId}'`);
  }
}

const earnings = (s) => as(db, s.uid, `SELECT * FROM public.get_my_earnings(now() - interval '1 day', now() + interval '1 day')`).then((r) => r.rows[0]);
const overview = async (s) => (await as(db, admin, `SELECT * FROM public.admin_payout_overview() WHERE seller_id='${s.id}'`)).rows[0];
const settle = (s, cents) => as(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${cents}, 'havale')`).then((r) => r.rows[0]);
const adminCoupon = async (code, type, value) => db.exec(
  `INSERT INTO public.coupons (code, discount_type, discount_value, is_active) VALUES ('${code}','${type}',${value},true)`);
const createCoupon = (s, code, type = 'percent', value = 10, extra = {}) =>
  as(db, s.uid, `SELECT * FROM public.create_seller_coupon($1,$2,$3,$4,$5,$6,now() + interval '30 days',$7)`,
    [code, extra.title ?? 'Hafta Sonu', type, value, extra.min ?? 0, extra.maxUses ?? null, extra.cap ?? null]).then((r) => r.rows[0]);

describe('Kazanç hesabı', () => {
  test('nakit siparişte para satıcıda kalır, bakiye komisyon borcudur', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    assert.equal(o.total_cents, 11500);
    assert.equal(o.commission_cents, 800);
    await deliver(s, o.id);

    const e = await earnings(s);
    assert.equal(e.order_count, 1);
    assert.equal(e.gross_cents, 11500);
    assert.equal(e.commission_cents, 800);
    assert.equal(e.net_cents, 10700);
    assert.equal(e.collected_cents, 11500);
    assert.equal(e.open_balance_cents, -800);
  });

  test('teslim edilmeyen ve iptal edilen sipariş kazanca girmez', async () => {
    const s = await seller();
    const buyer = await user();
    const a = await placeOrder(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${a.id}'`);
    const b = await placeOrder(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled' WHERE id='${b.id}'`);
    const e = await earnings(s);
    assert.equal(e.order_count, 0);
    assert.equal(e.open_balance_cents, 0);
  });

  test('online ödemede para platformdadır, satıcıya ödenir', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    await deliver(s, o.id);
    await as(db, null, `UPDATE public.orders SET payment_method='online', payment_status='paid' WHERE id='${o.id}'`);
    assert.equal((await earnings(s)).open_balance_cents, 10700);
  });

  test('platform kuponunun indirimini platform öder: satıcı hakkı azalmaz', async () => {
    const s = await seller();
    await adminCoupon('PLATFORM25', 'fixed', 2500);
    const o = await placeOrder(await user(), s, 'PLATFORM25');
    assert.equal(o.total_cents, 9000);
    assert.equal(o.seller_discount_cents, 0);
    assert.equal(o.commission_cents, 800);
    await deliver(s, o.id);
    const e = await earnings(s);
    assert.equal(e.net_cents, 10700);
    // Satıcı ₺90 aldı, hakkı ₺107: platform farkı öder.
    assert.equal(e.open_balance_cents, 1700);
  });

  test('platformun ücretsiz teslimat kuponunda teslimat bedelini platform öder', async () => {
    const s = await seller();
    await adminCoupon('PLATFORMTES', 'free_delivery', 0);
    const o = await placeOrder(await user(), s, 'PLATFORMTES');
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.platform_delivery_cents, 1500);
    await deliver(s, o.id);
    const e = await earnings(s);
    assert.equal(e.net_cents, 10700);
    assert.equal(e.open_balance_cents, 700);
  });

  test('satıcı teslimat ücretini şişirip platform kuponuyla para çekemez', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.sellers SET delivery_fee_cents=100000, free_delivery_threshold_cents=1000000 WHERE id='${s.id}'`);
    await adminCoupon('SISIRME', 'free_delivery', 0);
    const o = await placeOrder(await user(), s, 'SISIRME');
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.platform_delivery_cents, 1500, 'platform en çok kendi ücretini karşılar');
    await deliver(s, o.id);
    assert.equal((await earnings(s)).open_balance_cents, 700);
  });

  test('istemci hesabı sunucuyla aynı', async () => {
    const s = await seller();
    const buyer = await user();
    await adminCoupon('HESAP10', 'percent', 10);
    await createCoupon(s, 'SATICI20', 'percent', 20);
    await adminCoupon('HESAPTES', 'free_delivery', 0);
    for (const [coupon, method] of [[null, 'cash'], ['HESAP10', 'card_door'], ['SATICI20', 'cash'], ['HESAPTES', 'cash']]) {
      const o = await placeOrder(buyer, s, coupon, method);
      const sql = await one(`SELECT public.order_net_cents(o) AS net, public.order_balance_cents(o) AS bal, * FROM public.orders o WHERE id='${o.id}'`);
      assert.equal(orderNetCents(sql), sql.net, `net ${coupon}`);
      assert.equal(orderBalanceCents(sql), sql.bal, `bakiye ${coupon}`);
    }
    assert.equal(orderBalanceCents({ subtotal_cents: 10000, delivery_fee_cents: 1500, commission_cents: 800, total_cents: 11500, payment_method: 'online' }), 10700);
  });
});

describe('Hesap kesimi', () => {
  test('yalnızca yönetici görür ve keser; satıcı keyfi kesim yapamaz', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    await deliver(s, o.id);
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.admin_payout_overview()'))?.code, '42501');
    assert.equal((await failure(db, s.uid, `SELECT * FROM public.admin_settle_seller('${s.id}', -800)`))?.code, '42501');
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.admin_platform_totals()'))?.code, '42501');
    assert.ok(await failure(db, s.uid, `INSERT INTO public.seller_payouts (seller_id, amount_cents, order_count, commission_cents) VALUES ('${s.id}',1,1,0)`));
    assert.ok(await failure(db, s.uid, `UPDATE public.orders SET payout_id=gen_random_uuid() WHERE id='${o.id}'`));
    assert.equal((await failure(db, admin, `UPDATE public.orders SET seller_discount_cents=1 WHERE id='${o.id}'`))?.code, '42501');
  });

  test('kesim bakiyeyi sıfırlar, bildirir ve geçmişte görünür', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    await deliver(s, o.id);
    const row = await overview(s);
    assert.equal(row.balance_cents, -800);
    assert.equal(row.order_count, 1);
    assert.equal(row.commission_cents, 800);

    const p = await settle(s, -800);
    assert.equal(p.amount_cents, -800);
    assert.equal(p.order_count, 1);
    assert.equal(p.note, 'havale');
    assert.equal(await overview(s), undefined);
    assert.equal((await earnings(s)).open_balance_cents, 0);
    assert.equal((await earnings(s)).order_count, 1, 'kesim geçmiş kazancı silmez');
    assert.equal((await one(`SELECT payout_id FROM public.orders WHERE id='${o.id}'`)).payout_id, p.id);
    assert.equal((await as(db, s.uid, 'SELECT count(*)::int AS n FROM public.seller_payouts')).rows[0].n, 1);
    assert.equal((await as(db, await user(), 'SELECT count(*)::int AS n FROM public.seller_payouts')).rows[0].n, 0);
    assert.equal(await count(`public.notifications WHERE user_id='${s.uid}' AND type='payout'`), 1);
    assert.equal((await failure(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', 0)`))?.code, '55000');
  });

  test('ekrandaki tutar eskidiyse kesim yapılmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const a = await placeOrder(buyer, s);
    await deliver(s, a.id);
    const b = await placeOrder(buyer, s);
    await deliver(s, b.id);
    const err = await failure(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', -800)`);
    assert.equal(err?.code, 'EVN04');
    assert.equal((await settle(s, -1600)).order_count, 2);
  });

  test('açık iade talebi beklemede kalır, onaylanırsa kazançtan düşer', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    const row = await overview(s);
    assert.equal(row.balance_cents, 0);
    assert.equal(row.order_count, 0);
    assert.equal(row.held_count, 1);
    assert.equal((await failure(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', 0)`))?.code, '55000');

    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.equal((await earnings(s)).order_count, 0);
    assert.equal(await overview(s), undefined);
  });

  test('reddedilen iade yeniden kesime girer', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    assert.equal((await overview(s)).balance_cents, -800);
  });

  test('kesilmiş sipariş iade edilirse sonraki kesime ters kayıt girer, bir kez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await settle(s, -800);

    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    const row = await overview(s);
    assert.equal(row.balance_cents, 800, 'ödenen komisyon satıcıya döner');
    assert.equal(row.commission_cents, -800);

    const p = await settle(s, 800);
    assert.equal(p.amount_cents, 800);
    assert.equal(p.commission_cents, -800);
    const after = await one(`SELECT payout_id, reversal_payout_id FROM public.orders WHERE id='${o.id}'`);
    assert.equal(after.reversal_payout_id, p.id);
    assert.notEqual(after.payout_id, p.id);
    assert.equal(await overview(s), undefined);
  });

  test('ters kaydı işlenmiş sipariş yeniden satışa dönemez, para durumu ilerleyebilir', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s);
    await deliver(s, o.id);
    await settle(s, -800);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    await settle(s, 800);
    const err = await failure(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    assert.equal(err?.code, '55000');

    // Teslimden sonra yönetici iptali de ters kayda girer, sipariş geri açılamaz.
    const c = await placeOrder(await user(), s);
    await deliver(s, c.id);
    await settle(s, -800);
    await as(db, admin, `UPDATE public.orders SET status='cancelled' WHERE id='${c.id}'`);
    await settle(s, 800);
    assert.equal((await failure(db, admin, `UPDATE public.orders SET status='delivered' WHERE id='${c.id}'`))?.code, '55000');
  });

  test('platform toplamları iptal edilen ve iade edilen siparişi saymaz', async () => {
    const before = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    const s = await seller();
    const buyer = await user();
    const a = await placeOrder(buyer, s);
    await deliver(s, a.id);
    const b = await placeOrder(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled' WHERE id='${b.id}'`);
    const c = await placeOrder(buyer, s);
    await deliver(s, c.id);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${c.id}'`);

    const t = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    assert.equal(Number(t.delivered_count) - Number(before.delivered_count), 1);
    assert.equal(Number(t.sales_cents) - Number(before.sales_cents), 11500);
    assert.equal(Number(t.commission_cents) - Number(before.commission_cents), 800);
    assert.equal(Number(t.receivable_cents) - Number(before.receivable_cents), 800);
  });
});

describe('Ödeme hesabı (IBAN)', () => {
  const iban = 'TR330006100519786457841326';

  test('satıcı kendi IBANını yazar; başkası göremez, yönetici görür', async () => {
    const s = await seller();
    await as(db, s.uid, `INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name) VALUES ('${s.id}','${iban}','Ayşe Yılmaz')`);
    const q = `SELECT count(*)::int AS n FROM public.seller_payout_accounts WHERE seller_id='${s.id}'`;
    assert.equal((await as(db, s.uid, q)).rows[0].n, 1);
    assert.equal((await as(db, admin, q)).rows[0].n, 1);
    assert.equal((await as(db, await user(), q)).rows[0].n, 0);
    const baska = await seller();
    assert.equal((await as(db, baska.uid, q)).rows[0].n, 0);
    assert.ok(await failure(db, baska.uid, `INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name) VALUES ('${s.id}','${iban}','Sahte')`));
    await as(db, baska.uid, `UPDATE public.seller_payout_accounts SET iban='${iban}', account_name='Sahte' WHERE seller_id='${s.id}'`);
    assert.equal((await one(`SELECT account_name FROM public.seller_payout_accounts WHERE seller_id='${s.id}'`)).account_name, 'Ayşe Yılmaz');

    const o = await placeOrder(await user(), s);
    await deliver(s, o.id);
    assert.equal((await overview(s)).iban, iban);
  });

  test('geçersiz IBAN reddedilir', async () => {
    const s = await seller();
    const err = await failure(db, s.uid, `INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name) VALUES ('${s.id}','TR12','Ayşe')`);
    assert.equal(err?.code, '23514');
  });
});

describe('Satıcı kampanyaları', () => {
  test('satıcı kuponu yalnızca kendi mağazasında geçer, indirimi satıcı öder', async () => {
    const s = await seller();
    const baska = await seller();
    const buyer = await user();
    const c = await createCoupon(s, 'kisikampanya', 'percent', 20);
    assert.equal(c.code, 'KISIKAMPANYA');
    assert.equal(c.seller_id, s.id);
    assert.equal(c.max_uses_per_user, 1);

    const err = await orderFails(buyer, baska, 'KISIKAMPANYA');
    assert.equal(err?.code, '22023');
    assert.match(err.message, /satıcıda geçerli/);
    assert.equal((await one(`SELECT used_count FROM public.coupons WHERE id='${c.id}'`)).used_count, 0);

    const o = await placeOrder(buyer, s, 'KISIKAMPANYA');
    assert.equal(o.discount_cents, 2000);
    assert.equal(o.seller_discount_cents, 2000);
    assert.equal(o.total_cents, 9500);
    assert.equal(o.commission_cents, 640, 'komisyon indirimli tutardan');
    await deliver(s, o.id);
    const e = await earnings(s);
    assert.equal(e.net_cents, 10000 + 1500 - 2000 - 640);
    assert.equal(e.open_balance_cents, -640);
  });

  test('kişi başı tek kullanım ve iptalde hak iadesi', async () => {
    const s = await seller();
    const buyer = await user();
    await createCoupon(s, 'TEKKULLAN', 'fixed', 1000);
    const o = await placeOrder(buyer, s, 'TEKKULLAN');
    assert.ok(await orderFails(buyer, s, 'TEKKULLAN'));
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await placeOrder(buyer, s, 'TEKKULLAN')).discount_cents, 1000);
  });

  test('satıcının ücretsiz teslimat kuponunu satıcı üstlenir', async () => {
    const s = await seller();
    await createCoupon(s, 'BEDAVATES', 'free_delivery', 0);
    const o = await placeOrder(await user(), s, 'BEDAVATES');
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.platform_delivery_cents, 0);
    assert.equal(o.total_cents, 10000);
    await deliver(s, o.id);
    assert.equal((await earnings(s)).open_balance_cents, -800);
  });

  test('yüzde kuponda tavan uygulanır', async () => {
    const s = await seller();
    await createCoupon(s, 'TAVANLI', 'percent', 50, { cap: 1000 });
    assert.equal((await placeOrder(await user(), s, 'TAVANLI')).discount_cents, 1000);
  });

  test('kurallar sunucuda', async () => {
    const s = await seller();
    const call = (args) => failure(db, s.uid, `SELECT * FROM public.create_seller_coupon($1,$2,$3,$4,$5,$6,$7,$8)`, args);
    const soon = new Date(Date.now() + 86400000).toISOString();
    for (const bad of [
      ['AB', 'Başlık', 'percent', 10, 0, null, soon, null],
      ['GEÇERSİZ', 'Başlık', 'percent', 10, 0, null, soon, null],
      ['KODTAMAM', 'X', 'percent', 10, 0, null, soon, null],
      ['KODTAMAM', 'Başlık', 'bedava', 10, 0, null, soon, null],
      ['KODTAMAM', 'Başlık', 'percent', 91, 0, null, soon, null],
      ['KODTAMAM', 'Başlık', 'percent', 0, 0, null, soon, null],
      ['KODTAMAM', 'Başlık', 'fixed', 99, 0, null, soon, null],
      ['KODTAMAM', 'Başlık', 'percent', 10, -1, null, soon, null],
      ['KODTAMAM', 'Başlık', 'percent', 10, 0, 0, soon, null],
      ['KODTAMAM', 'Başlık', 'percent', 10, 0, null, '2020-01-01T00:00:00Z', null],
      ['KODTAMAM', 'Başlık', 'percent', 10, 0, null, new Date(Date.now() + 200 * 86400000).toISOString(), null],
    ]) {
      assert.equal((await call(bad))?.code, '55000', JSON.stringify(bad));
    }
    await createCoupon(s, 'AYNIKOD');
    assert.match((await call(['AYNIKOD', 'Başlık', 'percent', 10, 0, null, soon, null])).message, /kullanılıyor/);
  });

  test('müşteri, başka satıcı ve pasif satıcı kupon açamaz, değiştiremez', async () => {
    const s = await seller();
    const c = await createCoupon(s, 'SAHIPLI');
    const buyer = await user();
    assert.equal((await failure(db, buyer, `SELECT * FROM public.create_seller_coupon('YABANCI','Başlık','percent',10,0,NULL,now()+interval '1 day')`))?.code, '42501');
    const baska = await seller();
    assert.equal((await failure(db, baska.uid, `SELECT public.set_seller_coupon_active('${c.id}', false)`))?.code, 'P0002');
    assert.equal((await failure(db, baska.uid, `SELECT public.delete_seller_coupon('${c.id}')`))?.code, 'P0002');
    assert.ok(await failure(db, s.uid, `INSERT INTO public.coupons (code, discount_type, discount_value, seller_id) VALUES ('DIREKT','percent',90,'${s.id}')`));
    await as(db, s.uid, `UPDATE public.coupons SET discount_value=90 WHERE id='${c.id}'`);
    assert.equal((await one(`SELECT discount_value FROM public.coupons WHERE id='${c.id}'`)).discount_value, 10);
  });

  test('durdurulan kupon kullanılamaz; kullanılmış kupon silinmez, kapanır', async () => {
    const s = await seller();
    const c = await createCoupon(s, 'DURDUR');
    await as(db, s.uid, `SELECT public.set_seller_coupon_active('${c.id}', false)`);
    assert.ok(await orderFails(await user(), s, 'DURDUR'));
    await as(db, s.uid, `SELECT public.set_seller_coupon_active('${c.id}', true)`);
    await placeOrder(await user(), s, 'DURDUR');

    assert.equal((await as(db, s.uid, `SELECT public.delete_seller_coupon('${c.id}') AS ok`)).rows[0].ok, false);
    assert.equal((await one(`SELECT is_active FROM public.coupons WHERE id='${c.id}'`)).is_active, false);

    const bos = await createCoupon(s, 'KULLANILMADI');
    assert.equal((await as(db, s.uid, `SELECT public.delete_seller_coupon('${bos.id}') AS ok`)).rows[0].ok, true);
    assert.equal(await count(`public.coupons WHERE id='${bos.id}'`), 0);
  });
});

describe('Mesajlaşma', () => {
  const start = (uid, s, body = 'Merhaba') => as(db, uid, 'SELECT public.send_message_to_seller($1,$2) AS id', [s.id, body]).then((r) => r.rows[0].id);
  const reply = (uid, id, body = 'Buyrun') => as(db, uid, 'SELECT * FROM public.send_message($1,$2)', [id, body]).then((r) => r.rows[0]);
  const list = (uid, role = null) => as(db, uid, 'SELECT * FROM public.get_my_conversations($1)', [role]).then((r) => r.rows);

  test('müşteri yazar, satıcı yanıtlar; okunmamış sayı ve bildirim doğru', async () => {
    const s = await seller();
    const buyer = await user('buyer', 'Ayşe');
    const id = await start(buyer, s, '  Mantı var mı?  ');
    assert.equal(await start(buyer, s, 'İkinci mesaj'), id, 'aynı sohbet kullanılır');

    const sat = (await list(s.uid, 'seller'))[0];
    assert.equal(sat.id, id);
    assert.equal(sat.my_role, 'seller');
    assert.equal(sat.other_name, 'Ayşe');
    assert.equal(sat.unread_count, 2);
    assert.equal(sat.last_message_preview, 'İkinci mesaj');

    const n = await one(`SELECT title, type, data FROM public.notifications WHERE user_id='${s.uid}' AND type='message' LIMIT 1`);
    assert.equal(n.title, '💬 Ayşe');
    assert.equal(n.data.conversationId, id);

    const m = await reply(s.uid, id);
    assert.equal(m.sender_role, 'seller');
    const mus = (await list(buyer, 'customer'))[0];
    assert.equal(mus.other_name, 'Mağaza');
    assert.equal(mus.unread_count, 1);
    assert.equal(await count(`public.notifications WHERE user_id='${buyer}' AND type='message'`), 1);

    await as(db, s.uid, `SELECT public.mark_conversation_read('${id}')`);
    assert.equal((await list(s.uid, 'seller'))[0].unread_count, 0);
    assert.equal((await list(buyer))[0].unread_count, 1, 'karşı tarafın sayısına dokunmaz');
    const rows = (await as(db, buyer, `SELECT body FROM public.messages WHERE conversation_id='${id}' ORDER BY created_at`)).rows;
    assert.deepEqual(rows.map((r) => r.body), ['Mantı var mı?', 'İkinci mesaj', 'Buyrun']);
  });

  test('üçüncü kişi sohbeti göremez, yazamaz, işaretleyemez', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s);
    const yabanci = await user();
    assert.equal((await as(db, yabanci, `SELECT count(*)::int AS n FROM public.messages WHERE conversation_id='${id}'`)).rows[0].n, 0);
    assert.equal((await as(db, yabanci, `SELECT count(*)::int AS n FROM public.conversations WHERE id='${id}'`)).rows[0].n, 0);
    assert.equal((await list(yabanci)).length, 0);
    assert.equal((await failure(db, yabanci, 'SELECT * FROM public.send_message($1,$2)', [id, 'X']))?.code, 'P0002');
    assert.equal((await failure(db, yabanci, `SELECT public.mark_conversation_read('${id}')`))?.code, 'P0002');
    assert.equal((await failure(db, yabanci, `SELECT public.set_conversation_blocked('${id}', true)`))?.code, 'P0002');
    assert.equal((await as(db, admin, `SELECT count(*)::int AS n FROM public.messages WHERE conversation_id='${id}'`)).rows[0].n, 0, 'yönetici de özel mesajı okuyamaz');
  });

  test('doğrudan yazım kapalı', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s);
    assert.ok(await failure(db, buyer, `INSERT INTO public.messages (conversation_id, sender_id, sender_role, body) VALUES ('${id}','${s.uid}','seller','Sahte')`));
    assert.ok(await failure(db, buyer, `UPDATE public.conversations SET blocked_by=NULL WHERE id='${id}'`));
    assert.ok(await failure(db, buyer, `DELETE FROM public.messages WHERE conversation_id='${id}'`));
    assert.ok(await failure(db, buyer, `SELECT * FROM public._post_message('${id}','seller','Sahte')`));
  });

  test('geçersiz mesaj, kendi mağazası ve pasif satıcı', async () => {
    const s = await seller();
    const buyer = await user();
    assert.equal((await failure(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, '   ']))?.code, '55000');
    assert.equal((await failure(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'x'.repeat(1001)]))?.code, '55000');
    assert.equal((await failure(db, s.uid, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'selam']))?.code, '55000');
    const id = await start(buyer, s);
    await db.exec(`UPDATE public.sellers SET is_active=false WHERE id='${s.id}'`);
    assert.equal((await failure(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'selam']))?.code, '55000');
    assert.equal((await failure(db, buyer, 'SELECT * FROM public.send_message($1,$2)', [id, 'selam']))?.code, '55000');
  });

  test('hız sınırı', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s);
    for (let i = 0; i < 19; i++) await reply(buyer, id, `m${i}`);
    const err = await failure(db, buyer, 'SELECT * FROM public.send_message($1,$2)', [id, 'fazla']);
    assert.equal(err?.code, '55000');
    assert.match(err.message, /hızlı/);
  });

  test('engel iki yönde de durdurur, yalnızca koyan kaldırır', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s);
    await as(db, s.uid, `SELECT public.set_conversation_blocked('${id}', true)`);
    assert.equal((await failure(db, buyer, 'SELECT * FROM public.send_message($1,$2)', [id, 'x']))?.code, '55000');
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.send_message($1,$2)', [id, 'x']))?.code, '55000');
    assert.equal((await failure(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'x']))?.code, '55000');
    assert.equal((await failure(db, buyer, `SELECT public.set_conversation_blocked('${id}', false)`))?.code, '55000');
    assert.equal((await list(buyer))[0].blocked_by, 'seller');
    await as(db, s.uid, `SELECT public.set_conversation_blocked('${id}', false)`);
    await reply(buyer, id);
  });

  test('bildirme: yöneticiye gider, metin kopyalanır, tekrar sayılmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s, 'Kötü söz');
    const m = (await one(`SELECT id FROM public.messages WHERE conversation_id='${id}'`)).id;
    assert.equal((await failure(db, buyer, `SELECT public.report_message('${m}','kendi mesajım')`))?.code, '55000');
    assert.equal((await failure(db, await user(), `SELECT public.report_message('${m}','yabancı')`))?.code, 'P0002');
    assert.equal((await failure(db, s.uid, `SELECT public.report_message('${m}','x')`))?.code, '55000');

    const once = await count(`public.notifications WHERE user_id='${admin}' AND type='message_report'`);
    await as(db, s.uid, `SELECT public.report_message('${m}','Hakaret içeriyor')`);
    await as(db, s.uid, `SELECT public.report_message('${m}','Hakaret içeriyor')`);
    assert.equal(await count(`public.notifications WHERE user_id='${admin}' AND type='message_report'`), once + 1);

    const q = `SELECT * FROM public.message_reports WHERE message_id='${m}'`;
    const rows = (await as(db, admin, q)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body_snapshot, 'Kötü söz');
    assert.equal(rows[0].reported_user, buyer);
    assert.equal((await as(db, buyer, q)).rows.length, 0);
    assert.equal((await failure(db, buyer, `SELECT public.admin_close_report('${rows[0].id}')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_close_report('${rows[0].id}')`);
    assert.equal((await as(db, admin, q)).rows[0].status, 'closed');
  });

  test('müşteri hesabını silince sohbet gider, bildirim kaydı kalır', async () => {
    const s = await seller();
    const buyer = await user();
    const id = await start(buyer, s, 'Silinecek');
    const m = (await one(`SELECT id FROM public.messages WHERE conversation_id='${id}'`)).id;
    await as(db, s.uid, `SELECT public.report_message('${m}','Uygunsuz içerik')`);
    await as(db, buyer, 'SELECT public.delete_my_account()');
    assert.equal(await count(`public.conversations WHERE id='${id}'`), 0);
    assert.equal(await count(`public.messages WHERE conversation_id='${id}'`), 0);
    const r = await one(`SELECT message_id, reported_user, body_snapshot FROM public.message_reports WHERE body_snapshot='Silinecek'`);
    assert.equal(r.message_id, null);
    assert.equal(r.reported_user, null);
  });
});

describe('Takip ve Faydalı', () => {
  const state = async (uid, s) => (await as(db, uid, `SELECT * FROM public.get_seller_follow_state('${s.id}')`)).rows[0];
  const follow = (uid, s) => as(db, uid, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${uid}','${s.id}')`);

  test('takip kalıcı, sayı doğru, bırakılabilir', async () => {
    const s = await seller();
    const a = await user();
    const b = await user();
    await follow(a, s);
    await follow(b, s);
    assert.deepEqual(await state(a, s), { is_following: true, follower_count: 2 });
    await as(db, a, `DELETE FROM public.seller_follows WHERE user_id='${a}' AND seller_id='${s.id}'`);
    assert.deepEqual(await state(a, s), { is_following: false, follower_count: 1 });
    assert.equal((await state(b, s)).is_following, true);
  });

  test('başkası adına takip yok, liste gizli, kendi mağazası ve pasif satıcı takip edilemez', async () => {
    const s = await seller();
    const a = await user();
    const b = await user();
    assert.ok(await failure(db, a, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${b}','${s.id}')`));
    await follow(b, s);
    assert.equal((await as(db, a, `SELECT count(*)::int AS n FROM public.seller_follows WHERE seller_id='${s.id}'`)).rows[0].n, 0);
    assert.equal((await as(db, s.uid, `SELECT count(*)::int AS n FROM public.seller_follows WHERE seller_id='${s.id}'`)).rows[0].n, 0);
    assert.ok(await failure(db, s.uid, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${s.uid}','${s.id}')`));
    await db.exec(`UPDATE public.sellers SET is_active=false WHERE id='${s.id}'`);
    assert.ok(await failure(db, a, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${a}','${s.id}')`));
  });

  test('duyuruyu takipçi alır, favori almaz; saatte bir', async () => {
    const s = await seller();
    const takipci = await user();
    const favori = await user();
    await follow(takipci, s);
    await db.exec(`INSERT INTO public.favorites (user_id, seller_id) VALUES ('${favori}','${s.id}')`);
    // 038: takipçi duyurusu ticari iletidir. İkisine de izin verilir ki favorinin almaması izinden değil, takip etmediğinden olsun.
    await db.exec(`UPDATE public.users SET marketing_consent = true WHERE id IN ('${takipci}','${favori}')`);
    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Mantı')`);
    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Börek')`);
    assert.equal(await count(`public.notifications WHERE user_id='${takipci}' AND type='seller_update'`), 1);
    assert.equal(await count(`public.notifications WHERE user_id='${favori}' AND type='seller_update'`), 0);
  });

  async function reviewed() {
    const s = await seller();
    const author = await user();
    const o = await placeOrder(author, s);
    await deliver(s, o.id);
    const r = (await as(db, author, `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating) VALUES ('${o.id}','${s.id}','${author}',5) RETURNING id`)).rows[0];
    return { s, author, id: r.id, order: o.id };
  }
  const helpful = (uid, id) => as(db, uid, `INSERT INTO public.review_helpful (review_id, user_id) VALUES ('${id}','${uid}')`);
  const countOf = async (id) => (await one(`SELECT helpful_count FROM public.reviews WHERE id='${id}'`)).helpful_count;

  test('faydalı sayısı sunucuda tutulur, kişi başı bir, geri alınır', async () => {
    const r = await reviewed();
    const a = await user();
    const b = await user();
    await helpful(a, r.id);
    await helpful(b, r.id);
    assert.equal(await countOf(r.id), 2);
    assert.ok(await failure(db, a, `INSERT INTO public.review_helpful (review_id, user_id) VALUES ('${r.id}','${a}')`));
    await as(db, a, `DELETE FROM public.review_helpful WHERE review_id='${r.id}' AND user_id='${a}'`);
    assert.equal(await countOf(r.id), 1);
    assert.equal((await as(db, b, 'SELECT count(*)::int AS n FROM public.review_helpful')).rows[0].n, 1);
    assert.equal((await as(db, a, 'SELECT count(*)::int AS n FROM public.review_helpful')).rows[0].n, 0);
  });

  test('sayı elle yazılamaz, kendi yorumuna oy verilemez, başkası adına oy yok', async () => {
    const r = await reviewed();
    const a = await user();
    assert.ok(await failure(db, r.author, `UPDATE public.reviews SET helpful_count=99 WHERE id='${r.id}'`));
    assert.ok(await failure(db, r.author, `INSERT INTO public.review_helpful (review_id, user_id) VALUES ('${r.id}','${r.author}')`));
    assert.ok(await failure(db, a, `INSERT INTO public.review_helpful (review_id, user_id) VALUES ('${r.id}','${r.author}')`));
    assert.equal(await countOf(r.id), 0);
  });

  test('oy veren hesabını silince sayı düşer ve silme tamamlanır', async () => {
    const r = await reviewed();
    const a = await user();
    await helpful(a, r.id);
    await as(db, a, 'SELECT public.delete_my_account()');
    assert.equal(await countOf(r.id), 0);
    assert.equal(await count(`public.users WHERE id='${a}'`), 0);
  });

  test('yorum sahibi hesabını silince oylar da gider', async () => {
    const r = await reviewed();
    await helpful(await user(), r.id);
    await as(db, r.author, 'SELECT public.delete_my_account()');
    assert.equal(await count(`public.review_helpful WHERE review_id='${r.id}'`), 0);
  });
});

describe('Satıcı hesap silme', () => {
  test('açık bakiye varken silinemez, kesimden sonra her şey temizlenir', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await createCoupon(s, 'SILMEKUPON');
    await as(db, buyer, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${buyer}','${s.id}')`);
    await as(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'Selam']);
    await as(db, s.uid, `INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name) VALUES ('${s.id}','TR330006100519786457841326','Ayşe')`);

    const err = await failure(db, s.uid, 'SELECT public.delete_my_account()');
    assert.equal(err?.code, '55000');
    assert.match(err.message, /hesap kesimi/i);

    const p = await settle(s, -800);
    await as(db, s.uid, 'SELECT public.delete_my_account()');
    assert.equal((await one(`SELECT user_id FROM public.sellers WHERE id='${s.id}'`)).user_id, null);
    assert.equal(await count(`public.conversations WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.seller_follows WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.seller_payout_accounts WHERE seller_id='${s.id}'`), 0);
    assert.equal((await one(`SELECT is_active FROM public.coupons WHERE code='SILMEKUPON'`)).is_active, false);
    assert.equal((await one(`SELECT id FROM public.seller_payouts WHERE id='${p.id}'`)).id, p.id, 'muhasebe kaydı kalır');
  });

  test('bakiye sıfır olsa da açık iade talebi veya kesilmemiş sipariş varken silinemez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested' WHERE id='${o.id}'`);
    assert.equal((await overview(s)).balance_cents, 0);
    assert.equal((await failure(db, s.uid, 'SELECT public.delete_my_account()'))?.code, '55000');

    await as(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    await settle(s, -800);
    // Kesilmiş siparişe sonradan açılan iade talebi de sonuçlanmalı.
    await as(db, null, `UPDATE public.orders SET refund_status='requested' WHERE id='${o.id}'`);
    assert.equal((await failure(db, s.uid, 'SELECT public.delete_my_account()'))?.code, '55000');
    await as(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    await as(db, s.uid, 'SELECT public.delete_my_account()');

    // Komisyonsuz, tutarı sıfıra denk gelen kesilmemiş sipariş de engeller.
    const z = await seller();
    const zo = await placeOrder(await user(), z);
    await deliver(z, zo.id);
    await db.exec(`UPDATE public.orders SET commission_cents=1500, delivery_fee_cents=1500, total_cents=10000 WHERE id='${zo.id}'`);
    assert.equal((await overview(z)).balance_cents, 0);
    assert.equal((await failure(db, z.uid, 'SELECT public.delete_my_account()'))?.code, '55000');
  });

  test('siparişsiz mağaza kuponu, sohbeti ve takibiyle tamamen silinir', async () => {
    const s = await seller();
    const buyer = await user();
    await createCoupon(s, 'SIPARISSIZ');
    await as(db, buyer, `INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${buyer}','${s.id}')`);
    await as(db, buyer, 'SELECT public.send_message_to_seller($1,$2)', [s.id, 'Selam']);
    await as(db, s.uid, 'SELECT public.delete_my_account()');
    assert.equal(await count(`public.sellers WHERE id='${s.id}'`), 0);
    assert.equal(await count(`public.conversations WHERE seller_id='${s.id}'`), 0);
    assert.equal(await count(`public.coupons WHERE code='SIPARISSIZ'`), 0);
  });
});
