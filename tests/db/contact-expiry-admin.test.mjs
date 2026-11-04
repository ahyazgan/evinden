import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { allowManyDoorOrders, createDb, as } from './harness.mjs';

const BUYER = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const SELLER_USER = '00000000-0000-4000-8000-0000000000a1';
const STRANGER = '00000000-0000-4000-8000-0000000000a2';
const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const SELLER = '22222222-2222-4222-8222-222222222222';
const ITEM = 'b1000000-0000-4000-8000-000000000001';

async function place(db, uid = BUYER) {
  const r = await as(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)', [
    SELLER, JSON.stringify([{ menu_item_id: ITEM, quantity: 1 }]), 'Test Mah. Test Sok. No:1',
  ]);
  return r.rows[0];
}

describe('028: iletişim, cevapsız sipariş, askıya alma, duyuru', () => {
  let db;
  before(async () => {
    db = await createDb();
    // 035: aynı müşteriyle çok sayıda tamamlanmamış sipariş açılıyor, kapıda ödeme sınırı bu dosyanın konusu değil.
    await allowManyDoorOrders(db);
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${BUYER}'),('${OTHER}'),('${SELLER_USER}'),('${STRANGER}'),('${ADMIN}');
      INSERT INTO public.users (id,name,phone,role,is_approved) VALUES
        ('${BUYER}','Ayşe','+905551112233','buyer',true),
        ('${OTHER}','Veli',NULL,'buyer',true),
        ('${SELLER_USER}','Fatma',NULL,'seller',true),
        ('${STRANGER}','Başka',NULL,'seller',true),
        ('${ADMIN}','Yönetici',NULL,'admin',true);
      INSERT INTO public.sellers (id,user_id,display_name,seller_type,is_active,city,district)
        VALUES ('${SELLER}','${SELLER_USER}','Mutfak','home',true,'İstanbul','Kadıköy');
      INSERT INTO public.menu_items (id,seller_id,title,price_cents,category)
        VALUES ('${ITEM}','${SELLER}','Mantı',10000,'Ana Yemekler');
    `);
  });

  test('satıcı sürmekte olan siparişte müşterinin adını ve telefonunu görür', async () => {
    const o = await place(db);
    const r = await as(db, SELLER_USER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]);
    const row = r.rows.find((x) => x.order_id === o.id);
    assert.equal(row.customer_name, 'Ayşe');
    assert.equal(row.customer_phone, '+905551112233');
  });

  test('sipariş bitince telefon satıcıya kapanır', async () => {
    const o = await place(db);
    await as(db, BUYER, 'SELECT public.cancel_order($1)', [o.id]).catch(async () => {
      await as(db, null, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    });
    const r = await as(db, SELLER_USER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]);
    const row = r.rows.find((x) => x.order_id === o.id);
    assert.equal(row.customer_name, 'Ayşe');
    assert.equal(row.customer_phone, null);
  });

  test('başka satıcı müşteri bilgilerini okuyamaz', async () => {
    await assert.rejects(as(db, STRANGER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]), /göremezsiniz/);
    await assert.rejects(as(db, BUYER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]), /göremezsiniz/);
  });

  test('satıcı siparişten sohbet açar, başkası açamaz', async () => {
    const o = await place(db, OTHER);
    const r = await as(db, SELLER_USER, 'SELECT public.open_order_conversation($1) AS id', [o.id]);
    assert.ok(r.rows[0].id);
    await assert.rejects(as(db, STRANGER, 'SELECT public.open_order_conversation($1)', [o.id]), /erişemezsiniz/);
  });

  test('cevapsız sipariş önce hatırlatılır, süre dolunca iptal edilir', async () => {
    const o = await place(db);
    await as(db, null, `UPDATE public.orders SET pending_since = now() - interval '12 minutes' WHERE id='${o.id}'`);
    let n = await as(db, null, 'SELECT public.expire_pending_orders(10, 30) AS n');
    let row = (await as(db, null, `SELECT status, pending_reminded_at FROM public.orders WHERE id='${o.id}'`)).rows[0];
    assert.equal(row.status, 'pending');
    assert.ok(row.pending_reminded_at);
    const reminders = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${SELLER_USER}' AND title='Bekleyen siparişin var'`);
    assert.equal(reminders.rows[0].c, 1);

    // ikinci çalışmada yeni hatırlatma yok
    await as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
    const again = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${SELLER_USER}' AND title='Bekleyen siparişin var'`);
    assert.equal(again.rows[0].c, 1);

    await as(db, null, `UPDATE public.orders SET pending_since = now() - interval '31 minutes' WHERE id='${o.id}'`);
    n = await as(db, null, 'SELECT public.expire_pending_orders(10, 30) AS n');
    assert.ok(n.rows[0].n >= 1);
    row = (await as(db, null, `SELECT status, cancel_reason FROM public.orders WHERE id='${o.id}'`)).rows[0];
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancel_reason, 'Satıcı zamanında yanıtlamadı');
  });

  test('yeni sipariş süresi dolmadan iptal edilmez', async () => {
    const o = await place(db);
    await as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
    const row = (await as(db, null, `SELECT status FROM public.orders WHERE id='${o.id}'`)).rows[0];
    assert.equal(row.status, 'pending');
  });

  test('müşteri expire_pending_orders çağıramaz', async () => {
    await assert.rejects(as(db, BUYER, 'SELECT public.expire_pending_orders(0, 0)'), /permission denied/);
  });

  test('askıya alma: yalnızca yönetici, kullanıcı kendini açamaz, sipariş veremez', async () => {
    await assert.rejects(as(db, BUYER, 'SELECT public.admin_set_user_suspended($1, true)', [OTHER]), /Yetkiniz yok/);
    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, true)', [OTHER]);

    await as(db, OTHER, `UPDATE public.users SET is_suspended = false WHERE id='${OTHER}'`);
    const still = await as(db, null, `SELECT is_suspended FROM public.users WHERE id='${OTHER}'`);
    assert.equal(still.rows[0].is_suspended, true);

    await assert.rejects(place(db, OTHER), /askıya alındı/);
    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, false)', [OTHER]);
    const o = await place(db, OTHER);
    assert.ok(o.id);
  });

  test('yönetici hesabı askıya alınamaz, satıcı askıda mağazası durur', async () => {
    await assert.rejects(as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, true)', [ADMIN]), /askıya alınamaz/);
    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, true)', [STRANGER]);
    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, false)', [STRANGER]);
  });

  test('toplu duyuru: yalnızca yönetici, hedef kitleye gider', async () => {
    await assert.rejects(as(db, BUYER, 'SELECT public.admin_broadcast($1,$2,$3)', ['B', 'M', 'all']), /Yetkiniz yok/);
    await assert.rejects(as(db, ADMIN, 'SELECT public.admin_broadcast($1,$2,$3)', ['', 'M', 'all']), /Başlık/);
    const r = await as(db, ADMIN, 'SELECT public.admin_broadcast($1,$2,$3) AS n', ['Duyuru', 'Merhaba', 'buyer']);
    assert.equal(r.rows[0].n, 2);
    const seller = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${SELLER_USER}' AND title='Duyuru'`);
    assert.equal(seller.rows[0].c, 0);
  });

  test('kullanıcı yalnızca kendi bildirimini siler', async () => {
    const before = await as(db, null, `SELECT id FROM public.notifications WHERE user_id='${BUYER}' AND title='Duyuru'`);
    const id = before.rows[0].id;
    await as(db, OTHER, `DELETE FROM public.notifications WHERE id='${id}'`);
    let left = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE id='${id}'`);
    assert.equal(left.rows[0].c, 1);
    await as(db, BUYER, `DELETE FROM public.notifications WHERE id='${id}'`);
    left = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE id='${id}'`);
    assert.equal(left.rows[0].c, 0);
  });

  test('satıcı ve müşteri süre alanlarını değiştiremez', async () => {
    const o = await place(db);
    const read = async () => (await as(db, null, `SELECT pending_since FROM public.orders WHERE id='${o.id}'`)).rows[0].pending_since;
    const before = await read();
    await as(db, SELLER_USER, `UPDATE public.orders SET pending_since = now() + interval '100 years' WHERE id='${o.id}'`).catch(() => {});
    await as(db, BUYER, `UPDATE public.orders SET pending_since = now() - interval '100 years' WHERE id='${o.id}'`).catch(() => {});
    assert.equal((await read()).getTime(), before.getTime());
  });

  test('askıdaki satıcıya sipariş verilemez, mağazasını açamaz, sipariş kabul edemez, müşteriyi göremez', async () => {
    const o = await place(db);
    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, true)', [SELLER_USER]);
    await assert.rejects(place(db), /kapalı|sipariş alamıyor/);

    await as(db, SELLER_USER, `UPDATE public.sellers SET is_paused = false WHERE id='${SELLER}'`);
    const paused = await as(db, null, `SELECT is_paused FROM public.sellers WHERE id='${SELLER}'`);
    assert.equal(paused.rows[0].is_paused, true);

    await assert.rejects(as(db, SELLER_USER, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`), /askıya alındı/);
    await assert.rejects(as(db, SELLER_USER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]), /askıya alındı/);
    await assert.rejects(as(db, SELLER_USER, 'SELECT public.open_order_conversation($1)', [o.id]), /askıya alındı/);
    await assert.rejects(as(db, SELLER_USER, 'SELECT public.notify_my_followers($1,$2)', ['B', 'M']), /askıya alındı/);

    await as(db, ADMIN, 'SELECT public.admin_set_user_suspended($1, false)', [SELLER_USER]);
    await as(db, SELLER_USER, `UPDATE public.sellers SET is_paused = false WHERE id='${SELLER}'`);
    const open = await as(db, null, `SELECT is_paused FROM public.sellers WHERE id='${SELLER}'`);
    assert.equal(open.rows[0].is_paused, false);
    assert.ok((await place(db)).id);
  });

  test('parası alınmamış sipariş satıcıya görünmez', async () => {
    const o = await place(db);
    await as(db, null, `UPDATE public.orders SET status='awaiting_payment' WHERE id='${o.id}'`);
    const r = await as(db, SELLER_USER, 'SELECT * FROM public.get_seller_order_contacts($1)', [SELLER]);
    assert.equal(r.rows.some((x) => x.order_id === o.id), false);
    await assert.rejects(as(db, SELLER_USER, 'SELECT public.open_order_conversation($1)', [o.id]), /erişemezsiniz/);
    await as(db, null, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
  });

  test('ödemesi alınmış sipariş otomatik iptalde iadeye düşer ve haber verilir', async () => {
    const o = await place(db);
    await as(db, null, `UPDATE public.orders SET payment_method='online', payment_status='paid', pending_since = now() - interval '31 minutes' WHERE id='${o.id}'`);
    await as(db, null, 'SELECT public.expire_pending_orders(10, 30)');
    const row = (await as(db, null, `SELECT status, payment_status FROM public.orders WHERE id='${o.id}'`)).rows[0];
    assert.equal(row.status, 'cancelled');
    assert.equal(row.payment_status, 'refund_pending');
    const admin = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${ADMIN}' AND title='Para iadesi bekliyor'`);
    assert.ok(admin.rows[0].c >= 1);
    const buyer = await as(db, null, `SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${BUYER}' AND title='Ödemeniz iade sürecinde'`);
    assert.ok(buyer.rows[0].c >= 1);
  });
});
