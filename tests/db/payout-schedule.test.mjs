// 054: iyzico onayında bekletme, haftalık otomatik hesap kesimi, ödeme bekleyen kesimin ödendi işaretlenmesi.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
  admin = await user('admin');
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
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Kesim Lokantası',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
    INSERT INTO public.seller_payout_accounts (seller_id, iban, account_name) VALUES ('${id}','TR000000000000000000000001','Kesim Ltd');
  `);
  return { uid, id, item };
}

const place = (buyer, s) => as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash']).then(r => r.rows[0]);

async function deliver(s, id) {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${id}'`);
  }
}

async function service(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const setPolicy = value => db.exec(`UPDATE public.app_config SET value='${JSON.stringify(value)}'::jsonb WHERE key='payout_policy'`);
// allow_daily: 055 (restoran günlük ödeme seçebilir).
const DEFAULT = { approve_delay_hours: 24, settlement_weekday: 1, auto_settlement: true, allow_daily: true };

describe('Ödeme ayarı', () => {
  test('varsayılan 24 saat ve pazartesi; yalnızca yönetici, geçerli değerle değiştirir', async () => {
    const p = (await as(db, admin, 'SELECT public.payout_policy() AS p')).rows[0].p;
    assert.deepEqual(p, DEFAULT);
    const s = await seller();
    assert.equal((await failure(db, s.uid, `SELECT public.admin_update_payout_policy('{"approve_delay_hours":0}')`))?.code, '42501');
    for (const bad of ['{"approve_delay_hours":200}', '{"approve_delay_hours":"24"}', '{"approve_delay_hours":1.5}',
      '{"settlement_weekday":8}', '{"auto_settlement":"yes"}', '{"bilinmeyen":1}', '[]']) {
      assert.equal((await failure(db, admin, `SELECT public.admin_update_payout_policy('${bad}')`))?.code, '22023', bad);
    }
    const updated = (await as(db, admin, `SELECT public.admin_update_payout_policy('{"approve_delay_hours":48,"settlement_weekday":3}') AS p`)).rows[0].p;
    assert.deepEqual(updated, { ...DEFAULT, approve_delay_hours: 48, settlement_weekday: 3 });
    // Bozuk kayıtta güvenli varsayılan.
    await db.exec(`UPDATE public.app_config SET value='{"approve_delay_hours":"x","settlement_weekday":9}' WHERE key='payout_policy'`);
    assert.deepEqual((await as(db, admin, 'SELECT public.payout_policy() AS p')).rows[0].p, DEFAULT);
    await setPolicy(DEFAULT);
  });
});

describe('iyzico onayında bekletme', () => {
  test('teslimden 24 saat geçmeden onay alınmaz; geçince alınır; yönetici onay zamanını görür', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    await deliver(s, o.id);
    await db.exec(`
      UPDATE public.orders SET payment_method='online', payment_status='paid', marketplace_status='held' WHERE id='${o.id}';
      INSERT INTO public.order_payments (order_id, paid_at, marketplace, submerchant_key, submerchant_price_cents, transactions)
        VALUES ('${o.id}', now(), true, 'KEY', 10000, '[{"paymentTransactionId":1}]');
      INSERT INTO public.payment_approvals (order_id) VALUES ('${o.id}') ON CONFLICT DO NOTHING;
    `);
    const claimed = async () => (await service('SELECT * FROM public.claim_payment_approvals(100)')).rows.map(r => r.order_id);
    assert.ok(!(await claimed()).includes(o.id));
    const queue = (await as(db, admin, 'SELECT * FROM public.admin_payment_approval_queue()')).rows.find(r => r.order_id === o.id);
    const delivered = (await one('SELECT delivered_at FROM public.orders WHERE id=$1', [o.id])).delivered_at;
    assert.equal(new Date(queue.due_at).getTime(), new Date(delivered).getTime() + 24 * 3600 * 1000);

    // İade talebi açıkken süre dolsa da onay gitmez.
    await db.exec(`UPDATE public.orders SET delivered_at = now() - interval '25 hours', refund_status='requested' WHERE id='${o.id}'`);
    assert.ok(!(await claimed()).includes(o.id));
    await db.exec(`UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    assert.ok((await claimed()).includes(o.id));

    // Bekletme 0 yapılırsa teslimden hemen sonra alınır.
    await setPolicy({ ...DEFAULT, approve_delay_hours: 0 });
    const s2 = await seller();
    const o2 = await place(await user(), s2);
    await deliver(s2, o2.id);
    await db.exec(`
      UPDATE public.orders SET payment_method='online', payment_status='paid', marketplace_status='held' WHERE id='${o2.id}';
      INSERT INTO public.order_payments (order_id, paid_at, marketplace, submerchant_key, submerchant_price_cents, transactions)
        VALUES ('${o2.id}', now(), true, 'KEY', 10000, '[]');
      INSERT INTO public.payment_approvals (order_id) VALUES ('${o2.id}') ON CONFLICT DO NOTHING;
    `);
    assert.ok((await claimed()).includes(o2.id));
    await setPolicy(DEFAULT);
  });
});

describe('Haftalık hesap kesimi', () => {
  // 2031-06-04 çarşamba öğlen (İstanbul). Dönem sonu 2031-06-02 pazartesi 00:00.
  const NOW = '2031-06-04T12:00:00+03:00';
  const END = '2031-06-02T00:00:00+03:00';

  test('dönem sonu kesim gününün 00:00ıdır', async () => {
    const end = async (now, day) => (await one('SELECT public._settlement_period_end($1::timestamptz, $2) AS e', [now, day])).e;
    assert.equal(new Date(await end(NOW, 1)).getTime(), new Date(END).getTime());
    assert.equal(new Date(await end('2031-06-02T00:30:00+03:00', 1)).getTime(), new Date(END).getTime());
    assert.equal(new Date(await end('2031-06-01T23:30:00+03:00', 1)).getTime(), new Date('2031-05-26T00:00:00+03:00').getTime());
    assert.equal(new Date(await end(NOW, 3)).getTime(), new Date('2031-06-04T00:00:00+03:00').getTime());
  });

  test('dönem içinde teslim edilen kesilir, sonrası ve iade incelemesi kalır; ödendi işaretlenir', async () => {
    const s = await seller();
    const buyer = await user();
    const inPeriod = await place(buyer, s);
    await deliver(s, inPeriod.id);
    const afterEnd = await place(buyer, s);
    await deliver(s, afterEnd.id);
    const disputed = await place(buyer, s);
    await deliver(s, disputed.id);
    await db.exec(`
      UPDATE public.orders SET delivered_at='2031-05-30T12:00:00+03:00' WHERE id IN ('${inPeriod.id}','${disputed.id}');
      UPDATE public.orders SET delivered_at='2031-06-02T10:00:00+03:00' WHERE id='${afterEnd.id}';
    `);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Eksik geldi' WHERE id='${disputed.id}'`);

    assert.equal((await failure(db, s.uid, 'SELECT public.admin_run_weekly_settlement()'))?.code, '42501');
    const totalsBefore = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];

    const r = (await service('SELECT public.generate_weekly_settlements($1::timestamptz) AS r', [NOW])).rows[0].r;
    assert.equal(r.skipped, false);
    assert.equal(new Date(r.period_end).getTime(), new Date(END).getTime());

    const payout = await one(`SELECT * FROM public.seller_payouts WHERE seller_id=$1`, [s.id]);
    assert.equal(payout.status, 'pending');
    assert.equal(payout.kind, 'weekly');
    assert.equal(payout.order_count, 1);
    // Kapıda nakit: restoran parayı aldı, komisyonu borçlu.
    assert.equal(payout.amount_cents, -inPeriod.commission_cents);
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [inPeriod.id])).payout_id, payout.id);
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [afterEnd.id])).payout_id, null);
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [disputed.id])).payout_id, null);
    assert.equal((await one(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Haftalık hesap kesimin hazır'`, [s.uid])).n, 1);

    // Kesim yapıldı ama para alınmadı: platform toplamında alacak olarak kalır.
    const totalsAfter = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    assert.equal(Number(totalsAfter.receivable_cents), Number(totalsBefore.receivable_cents));
    // Restoran kendi kesimini görür.
    assert.equal((await as(db, s.uid, `SELECT status FROM public.seller_payouts WHERE id='${payout.id}'`)).rows[0].status, 'pending');
    // Aynı dönem ikinci kez kesilmez.
    assert.equal((await service('SELECT public.generate_weekly_settlements($1::timestamptz) AS r', [NOW])).rows[0].r.skipped, true);
    // Ödenmemiş kesim varken hesap silinemez.
    assert.equal((await failure(db, s.uid, 'SELECT public.delete_my_account()'))?.code, '55000');

    const pending = (await as(db, admin, 'SELECT * FROM public.admin_pending_payouts()')).rows.find(p => p.id === payout.id);
    assert.equal(pending.iban, 'TR000000000000000000000001');
    assert.equal((await failure(db, s.uid, `SELECT public.admin_mark_payout_paid('${payout.id}', ${payout.amount_cents}, NULL)`))?.code, '42501');
    // Ekrandaki tutar güncel değilse işaretlenmez.
    assert.equal((await failure(db, admin, `SELECT public.admin_mark_payout_paid('${payout.id}', ${payout.amount_cents - 1}, NULL)`))?.code, 'EVN04');
    await as(db, admin, `SELECT public.admin_mark_payout_paid('${payout.id}', ${payout.amount_cents}, 'EFT 123')`);
    const paid = await one('SELECT * FROM public.seller_payouts WHERE id=$1', [payout.id]);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.paid_reference, 'EFT 123');
    assert.equal(paid.paid_by, admin);
    assert.equal((await one(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Komisyon ödemen alındı'`, [s.uid])).n, 1);
    assert.equal((await failure(db, admin, `SELECT public.admin_mark_payout_paid('${payout.id}', ${payout.amount_cents}, NULL)`))?.code, 'P0002');

    // Sonraki hafta: dönem sonrası teslim edilen sipariş kesilir.
    const next = (await service(`SELECT public.generate_weekly_settlements('2031-06-10T12:00:00+03:00') AS r`)).rows[0].r;
    assert.equal(next.skipped, false);
    assert.equal(new Date(next.period_start).getTime(), new Date(END).getTime());
    assert.notEqual((await one('SELECT payout_id FROM public.orders WHERE id=$1', [afterEnd.id])).payout_id, null);
  });

  test('hafta bekletme bitince kesilir; pazar akşamı teslimi aynı haftaya girer; otomatik kesim kapatılabilir', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    await deliver(s, o.id);
    await db.exec(`UPDATE public.orders SET delivered_at='2031-06-15T23:00:00+03:00' WHERE id='${o.id}'`);
    // Pazartesi 06:00: 16 Haziran'da biten haftanın bekletmesi henüz bitmedi, o hafta kesilmez.
    const early = (await service(`SELECT public.generate_weekly_settlements('2031-06-16T06:00:00+03:00') AS r`)).rows[0].r;
    assert.notEqual(new Date(early.period_end).getTime(), new Date('2031-06-16T00:00:00+03:00').getTime());
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [o.id])).payout_id, null);
    // Salı 06:00: hafta kesilir, pazar 23:00 teslimi de girer.
    const r = (await service(`SELECT public.generate_weekly_settlements('2031-06-17T06:00:00+03:00') AS r`)).rows[0].r;
    assert.equal(new Date(r.period_end).getTime(), new Date('2031-06-16T00:00:00+03:00').getTime());
    assert.notEqual((await one('SELECT payout_id FROM public.orders WHERE id=$1', [o.id])).payout_id, null);

    await setPolicy({ ...DEFAULT, auto_settlement: false });
    assert.equal((await service('SELECT public.run_weekly_settlements() AS r')).rows[0].r.reason, 'disabled');
    await setPolicy(DEFAULT);
  });

  test('kesildikten sonra, havaleden önce iadesi onaylanan sipariş kesimden çıkar', async () => {
    const s = await seller();
    const buyer = await user();
    const keep = await place(buyer, s);
    await deliver(s, keep.id);
    const refund = await place(buyer, s);
    await deliver(s, refund.id);
    // İkisi de online, para platformda: restorana ödenecek.
    await db.exec(`
      UPDATE public.orders SET payment_method='online', payment_status='paid', delivered_at='2031-06-20T12:00:00+03:00'
       WHERE id IN ('${keep.id}','${refund.id}');
    `);
    await service(`SELECT public.generate_weekly_settlements('2031-06-24T06:00:00+03:00')`);
    const payout = await one('SELECT * FROM public.seller_payouts WHERE seller_id=$1', [s.id]);
    assert.equal(payout.order_count, 2);
    const net = (await one('SELECT public.order_net_cents(o) AS n FROM public.orders o WHERE id=$1', [refund.id])).n;
    assert.equal(payout.amount_cents, 2 * net);

    // Havale yapılmadan iade onaylandı: kesimden çıkar, tutar düşer, sipariş ters kayıt beklemez.
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Yanlış ürün' WHERE id='${refund.id}'`);
    await as(db, admin, `SELECT public.admin_decide_refund('${refund.id}','approved',NULL)`);
    const after = await one('SELECT * FROM public.seller_payouts WHERE id=$1', [payout.id]);
    assert.equal(after.order_count, 1);
    assert.equal(after.amount_cents, net);
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [refund.id])).payout_id, null);
    // Eski tutarla işaretleme reddedilir; güncel tutarla geçer.
    assert.equal((await failure(db, admin, `SELECT public.admin_mark_payout_paid('${payout.id}', ${2 * net}, NULL)`))?.code, 'EVN04');
    await as(db, admin, `SELECT public.admin_mark_payout_paid('${payout.id}', ${net}, NULL)`);
    // Ödenmiş kesimde iade ters kayıt olur (eski davranış).
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk' WHERE id='${keep.id}'`);
    await as(db, admin, `SELECT public.admin_decide_refund('${keep.id}','approved',NULL)`);
    assert.equal((await one('SELECT payout_id FROM public.orders WHERE id=$1', [keep.id])).payout_id, payout.id);
    const overview = (await as(db, admin, 'SELECT * FROM public.admin_payout_overview()')).rows.find(r => r.seller_id === s.id);
    assert.equal(overview.balance_cents, -net);
  });

  test('elle kesim ödenmiş sayılır ve ödeme zamanı yazılır', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    await deliver(s, o.id);
    const { balance_cents } = (await as(db, admin, 'SELECT * FROM public.admin_payout_overview()')).rows.find(r => r.seller_id === s.id);
    const p = (await as(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${balance_cents}, 'havale')`)).rows[0];
    assert.equal(p.status, 'paid');
    assert.equal(p.kind, 'manual');
    assert.ok(p.paid_at);
  });
});
