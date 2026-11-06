// 036: iyzico pazaryeri anahtarı, alt üye kaydı, onay kuyruğu, hesap kesimi; EVN05 ve track_events sınırı.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';
import { orderBalanceCents, orderNetCents } from '../../lib/earnings.ts';

let db;
let admin;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
  await db.exec(`UPDATE public.app_config SET value='{"enabled": true}' WHERE key='online_payment'`);
  // Bu dosya onay kuyruğunun mantığını sınar; teslim sonrası bekletme (054) payout-schedule testinde.
  await db.exec(`UPDATE public.app_config SET value = value || '{"approve_delay_hours":0}' WHERE key='payout_policy'`);
  admin = await user('admin');
});

const one = async (sql) => (await db.query(sql)).rows[0];

async function user(role = 'buyer') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

// Komisyon %8, teslimat ₺15. Yemek ₺100: toplam ₺115, komisyon ₺8, satıcının hakkı ₺107.
async function seller() {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Mağaza',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

const placeOrder = (buyer, s, method = 'cash') =>
  as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method]).then((r) => r.rows[0]);

/** Edge Function'ların yaptığı: başlatma kaydı ve ödeme sonucu (service role). */
async function payOnline(s, buyer, marketplace) {
  const o = await placeOrder(buyer, s, 'online');
  await as(db, null, 'SELECT public.record_payment_init($1,$2,$3,$4,$5,$6)', [
    o.id, `token-${o.id}`, marketplace, marketplace ? 'KEY' : null, marketplace ? 10700 : null, marketplace ? null : 'no_submerchant_key',
  ]);
  const paid = await as(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4) AS r', [
    o.id, 'P1', JSON.stringify([{ paymentTransactionId: 999, paidPrice: 115 }]), 11500,
  ]);
  assert.equal(paid.rows[0].r, 'paid');
  return o;
}

async function deliver(s, id) {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${st}' WHERE id='${id}'`);
  }
}

const overview = async (s) =>
  (await as(db, admin, 'SELECT * FROM public.admin_payout_overview()')).rows.find((r) => r.seller_id === s.id);
const earnings = async (s) =>
  (await as(db, s.uid, `SELECT * FROM public.get_my_earnings(now() - interval '1 day', now() + interval '1 day')`)).rows[0];
const settleFails = (s, cents) => failure(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${cents})`);
const settle = (s, cents) => as(db, admin, `SELECT * FROM public.admin_settle_seller('${s.id}', ${cents})`);
const order = (id) => one(`SELECT * FROM public.orders WHERE id='${id}'`);
const approval = (id) => one(`SELECT * FROM public.payment_approvals WHERE order_id='${id}'`);
const claim = async () => (await as(db, null, 'SELECT * FROM public.claim_payment_approvals(100)')).rows;
const unlock = (id) => db.exec(`UPDATE public.payment_approvals SET locked_until=NULL, next_attempt_at=now() WHERE order_id='${id}'`);

async function asAnon(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}

const COMPANY = {
  company_type: 'LIMITED_OR_JOINT_STOCK_COMPANY', legal_company_title: 'Lokanta Ltd.', tax_office: 'Kadıköy', tax_number: '1234567890',
  identity_number: '10000000146', email: 'a@ornek.com', gsm_number: '+905551112233', address: 'Moda Cad. No:1',
};
const insertCompany = (uid, sellerId, over = {}) => {
  const row = { seller_id: sellerId, ...COMPANY, ...over };
  const keys = Object.keys(row);
  return as(db, uid, `INSERT INTO public.seller_company_info (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => row[k]));
};
const failsCompany = (uid, sellerId, over = {}) => insertCompany(uid, sellerId, over).then(() => null, (e) => ({ code: e.code }));

describe('Anahtar', () => {
  test('kapalı gelir, herkese açık okunmaz, yönetici okur', async () => {
    assert.deepEqual((await one(`SELECT value FROM public.app_config WHERE key='iyzico_marketplace'`)).value, { enabled: false });
    const sql = `SELECT * FROM public.app_config WHERE key='iyzico_marketplace'`;
    assert.equal((await asAnon(sql)).rows.length, 0);
    assert.equal((await as(db, await user(), sql)).rows.length, 0);
    assert.equal((await as(db, admin, sql)).rows.length, 1);
    // Diğer ayarlar açık kalır, fraud_rules gizli kalır.
    assert.equal((await asAnon(`SELECT * FROM public.app_config WHERE key='order_pricing'`)).rows.length, 1);
    assert.equal((await asAnon(`SELECT * FROM public.app_config WHERE key='fraud_rules'`)).rows.length, 0);
  });

  test('uygulama yalnızca açık mı diye sorabilir, kullanıcı değiştiremez', async () => {
    const buyer = await user();
    assert.equal((await as(db, buyer, 'SELECT public.marketplace_enabled() AS on')).rows[0].on, false);
    await as(db, buyer, `UPDATE public.app_config SET value='{"enabled": true}' WHERE key='iyzico_marketplace'`);
    assert.equal((await one(`SELECT value FROM public.app_config WHERE key='iyzico_marketplace'`)).value.enabled, false);
    await db.exec(`UPDATE public.app_config SET value='{"enabled": true}' WHERE key='iyzico_marketplace'`);
    assert.equal((await as(db, buyer, 'SELECT public.marketplace_enabled() AS on')).rows[0].on, true);
    await db.exec(`UPDATE public.app_config SET value='{"enabled": false}' WHERE key='iyzico_marketplace'`);
  });

  test('anahtar kapalıyken online sipariş bugünkü gibi elle kesime girer', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), false);
    await deliver(s, o.id);
    assert.equal((await order(o.id)).marketplace_status, null);
    assert.equal(await approval(o.id), undefined);
    assert.equal((await overview(s)).balance_cents, 10700);
  });
});

describe('Şirket bilgisi ve alt üye kaydı (RLS)', () => {
  test('satıcı kendi bilgisini yazar ve okur; başkası, müşteri, girişsiz ve yönetici okuyamaz', async () => {
    const s = await seller();
    const other = await seller();
    await insertCompany(s.uid, s.id);
    const sql = `SELECT * FROM public.seller_company_info WHERE seller_id='${s.id}'`;
    assert.equal((await as(db, s.uid, sql)).rows[0].identity_number, COMPANY.identity_number);
    assert.equal((await as(db, other.uid, sql)).rows.length, 0);
    assert.equal((await as(db, await user(), sql)).rows.length, 0);
    assert.equal((await as(db, admin, sql)).rows.length, 0);
    assert.equal((await failure(db, null, 'SELECT 1')), null);
    await assert.rejects(asAnon(sql), /permission denied/);
  });

  test('başkası adına yazılamaz, başkasınınki değiştirilemez', async () => {
    const s = await seller();
    const other = await seller();
    assert.equal((await failsCompany(other.uid, s.id))?.code, '42501');
    await insertCompany(s.uid, s.id);
    await as(db, other.uid, `UPDATE public.seller_company_info SET tax_office='Hileli' WHERE seller_id='${s.id}'`);
    assert.equal((await one(`SELECT tax_office FROM public.seller_company_info WHERE seller_id='${s.id}'`)).tax_office, COMPANY.tax_office);
  });

  test('geçersiz alanlar veritabanında da reddedilir', async () => {
    const s = await seller();
    for (const bad of [
      { company_type: 'PERSONAL' }, { legal_company_title: 'Ab' }, { tax_office: '' }, { tax_number: '12' },
      { tax_number: null }, { identity_number: '123' }, { email: 'x' }, { gsm_number: '0555' }, { address: 'kısa' },
    ]) {
      assert.equal((await failsCompany(s.uid, s.id, bad))?.code, '23514', JSON.stringify(bad));
    }
    // Şahıs şirketinde vergi numarası zorunlu değil.
    assert.equal(await failsCompany(s.uid, s.id, { company_type: 'PRIVATE_COMPANY', tax_number: null }), null);
  });

  test('alt üye anahtarını satıcı ve yönetici görür, yalnızca service role yazar', async () => {
    const s = await seller();
    const other = await seller();
    await db.exec(`INSERT INTO public.seller_submerchants (seller_id, submerchant_key, status) VALUES ('${s.id}','KEY','active')`);
    const sql = `SELECT submerchant_key FROM public.seller_submerchants WHERE seller_id='${s.id}'`;
    assert.equal((await as(db, s.uid, sql)).rows[0].submerchant_key, 'KEY');
    assert.equal((await as(db, admin, sql)).rows[0].submerchant_key, 'KEY');
    assert.equal((await as(db, other.uid, sql)).rows.length, 0);
    await assert.rejects(asAnon(sql), /permission denied/);
    for (const uid of [s.uid, admin]) {
      assert.equal((await failure(db, uid, `UPDATE public.seller_submerchants SET submerchant_key='X' WHERE seller_id='${s.id}'`))?.code, '42501');
      assert.equal((await failure(db, uid, `INSERT INTO public.seller_submerchants (seller_id, status) VALUES ('${other.id}','error')`))?.code, '42501');
      assert.equal((await failure(db, uid, `DELETE FROM public.seller_submerchants WHERE seller_id='${s.id}'`))?.code, '42501');
    }
  });

  test('aktif kayıtta anahtar şart', async () => {
    const s = await seller();
    await assert.rejects(db.exec(`INSERT INTO public.seller_submerchants (seller_id, status) VALUES ('${s.id}','active')`), /active_has_key/);
  });

  test('iyzico kaydından sonra şirket türü değişmez, diğer alanlar değişir', async () => {
    const s = await seller();
    await insertCompany(s.uid, s.id);
    const change = `UPDATE public.seller_company_info SET company_type='PRIVATE_COMPANY' WHERE seller_id='${s.id}'`;
    assert.equal(await failure(db, s.uid, change), null, 'kayıttan önce değişir');
    await as(db, s.uid, `UPDATE public.seller_company_info SET company_type='LIMITED_OR_JOINT_STOCK_COMPANY' WHERE seller_id='${s.id}'`);
    await db.exec(`INSERT INTO public.seller_submerchants (seller_id, submerchant_key, status) VALUES ('${s.id}','KEY2','active')`);
    assert.equal((await failure(db, s.uid, change))?.code, '55000');
    await as(db, s.uid, `UPDATE public.seller_company_info SET tax_office='Üsküdar' WHERE seller_id='${s.id}'`);
    assert.equal((await one(`SELECT tax_office FROM public.seller_company_info WHERE seller_id='${s.id}'`)).tax_office, 'Üsküdar');
  });

  test('yönetici listesi durumu gösterir, kimlik ve vergi numarası döndürmez', async () => {
    const s = await seller();
    await insertCompany(s.uid, s.id);
    const row = (await as(db, admin, 'SELECT * FROM public.admin_marketplace_sellers()')).rows.find((r) => r.seller_id === s.id);
    assert.equal(row.has_company_info, true);
    assert.equal(row.has_iban, false);
    assert.equal(row.has_key, false);
    assert.equal(row.legal_company_title, COMPANY.legal_company_title);
    assert.equal(JSON.stringify(row).includes(COMPANY.identity_number), false);
    assert.equal(JSON.stringify(row).includes(COMPANY.tax_number), false);
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.admin_marketplace_sellers()'))?.code, '42501');
  });

  test('kayıttan sonra bilgi değişirse güncelleme gerekir', async () => {
    const s = await seller();
    await insertCompany(s.uid, s.id);
    await db.exec(`INSERT INTO public.seller_submerchants (seller_id, submerchant_key, status, synced_at) VALUES ('${s.id}','KEY3','active', now() + interval '1 hour')`);
    const row = async () => (await as(db, admin, 'SELECT * FROM public.admin_marketplace_sellers()')).rows.find((r) => r.seller_id === s.id);
    assert.equal((await row()).needs_sync, false);
    await db.exec(`UPDATE public.seller_submerchants SET synced_at = now() - interval '1 hour' WHERE seller_id='${s.id}'`);
    assert.equal((await row()).needs_sync, true);
  });
});

describe('Yetkiler', () => {
  test('kuyruk ve ödeme fonksiyonları istemciden çağrılamaz', async () => {
    const uid = await user();
    const id = randomUUID();
    for (const sql of [
      'SELECT * FROM public.claim_payment_approvals(10)',
      `SELECT public.complete_payment_approval('${id}')`,
      `SELECT public.fail_payment_approval('${id}', 'x')`,
      `SELECT public.begin_marketplace_refund('${id}')`,
      `SELECT public.mark_marketplace_reversed('${id}')`,
      `SELECT public.record_payment_init('${id}', 't', true, 'k', 1, NULL)`,
      'SELECT public.run_payment_approve()',
    ]) {
      for (const who of [uid, admin]) assert.equal((await failure(db, who, sql))?.code, '42501', sql);
    }
  });

  test('kuyruk tablosu istemciye kapalı', async () => {
    assert.equal((await failure(db, admin, 'SELECT * FROM public.payment_approvals'))?.code, '42501');
    await assert.rejects(asAnon('SELECT * FROM public.payment_approvals'), /permission denied/);
  });

  test('sipariş akış alanı istemciden değiştirilemez, yönetici dahil', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s);
    for (const uid of [s.uid, buyer, admin]) {
      const sql = `UPDATE public.orders SET marketplace_status='held' WHERE id='${o.id}'`;
      assert.equal((await failure(db, uid, sql))?.code, '42501');
    }
    assert.equal((await order(o.id)).marketplace_status, null);
  });

  test('order_payments akış kaydı istemciye açılmadı', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    assert.equal((await as(db, s.uid, `SELECT * FROM public.order_payments WHERE order_id='${o.id}'`)).rows.length, 0);
    assert.equal((await as(db, admin, `SELECT marketplace FROM public.order_payments WHERE order_id='${o.id}'`)).rows[0].marketplace, true);
  });
});

describe('Hesap kesimi: çift ödeme yok', () => {
  test('pazaryeri siparişi elle kesime girmez, kesilemez', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    assert.equal((await order(o.id)).marketplace_status, 'held');
    await deliver(s, o.id);
    assert.equal(await overview(s), undefined, 'ödeme listesinde görünmez');
    assert.equal((await settleFails(s, 10700))?.code, '55000');
    assert.equal((await settleFails(s, 0))?.code, '55000');
    assert.equal((await order(o.id)).payout_id, null);
  });

  test('onay verilse de verilmese de platformun borcu doğmaz', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal((await order(o.id)).marketplace_status, 'approved');
    assert.equal(await overview(s), undefined);
    const row = await one(`SELECT public.order_balance_cents(o) AS b, public.order_open_amount_cents(o) AS a, public.order_net_cents(o) AS n FROM public.orders o WHERE id='${o.id}'`);
    assert.equal(row.b, 0);
    assert.equal(row.a, null);
    assert.equal(row.n, 10700);
  });

  test('kapıda ödemenin komisyon borcu pazaryeriyle yan yana izlenir, kesim yalnızca onu kapatır', async () => {
    const s = await seller();
    const buyer = await user();
    const online = await payOnline(s, buyer, true);
    const cash = await placeOrder(buyer, s);
    const card = await placeOrder(buyer, s, 'card_door');
    await deliver(s, online.id);
    await deliver(s, cash.id);
    await deliver(s, card.id);
    const row = await overview(s);
    assert.equal(row.balance_cents, -1600);
    assert.equal(row.order_count, 2);
    assert.equal(row.commission_cents, 1600);
    assert.equal((await settle(s, -1600)).rows[0].amount_cents, -1600);
    assert.equal((await order(online.id)).payout_id, null);
    assert.ok((await order(cash.id)).payout_id);
    assert.equal(await overview(s), undefined);
  });

  test('anahtar açık, kayıt yok: sipariş elle kesime kalır ve bir kez ödenir', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), false);
    assert.equal((await one(`SELECT fallback_reason FROM public.order_payments WHERE order_id='${o.id}'`)).fallback_reason, 'no_submerchant_key');
    await deliver(s, o.id);
    assert.equal(await approval(o.id), undefined);
    assert.equal((await overview(s)).balance_cents, 10700);
    await settle(s, 10700);
    assert.equal(await overview(s), undefined);
    assert.equal((await settleFails(s, 10700))?.code, '55000');
  });

  test('pazaryeri olmayan her siparişte numaralar istemci hesabıyla aynı ve değişmedi', async () => {
    const s = await seller();
    const buyer = await user();
    const expected = { cash: -800, card_door: -800, online: 10700 };
    for (const [method, balance] of Object.entries(expected)) {
      const o = method === 'online' ? await payOnline(s, buyer, false) : await placeOrder(buyer, s, method);
      await deliver(s, o.id);
      const row = await order(o.id);
      const sql = await one(`SELECT public.order_balance_cents(o) AS b, public.order_net_cents(o) AS n, public.order_open_amount_cents(o) AS a FROM public.orders o WHERE id='${o.id}'`);
      assert.equal(sql.b, balance, method);
      assert.equal(sql.a, balance, method);
      assert.equal(sql.n, 10700, method);
      assert.equal(orderBalanceCents(row), balance, method);
      assert.equal(orderNetCents(row), 10700, method);
    }
    assert.equal((await overview(s)).balance_cents, 10700 - 800 - 800);
  });

  test('istemci hesabı pazaryeri siparişinde de sunucuyla aynı', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    const row = await order(o.id);
    assert.equal(orderBalanceCents(row), 0);
    assert.equal(orderNetCents(row), 10700);
  });

  test('kazanç raporu: net aynı, tahsil edilen değişmez, iyzico payı ayrı görünür', async () => {
    const s = await seller();
    const buyer = await user();
    const online = await payOnline(s, buyer, true);
    const manual = await payOnline(s, buyer, false);
    const cash = await placeOrder(buyer, s);
    for (const o of [online, manual, cash]) await deliver(s, o.id);
    const e = await earnings(s);
    assert.equal(e.order_count, 3);
    assert.equal(e.net_cents, 3 * 10700);
    assert.equal(e.marketplace_cents, 10700);
    assert.equal(e.collected_cents, 11500);
    assert.equal(e.open_balance_cents, 10700 - 800);
    assert.equal(e.commission_cents, 2400);
  });

  test('platform toplamı: komisyon sayılır, ödenecekte görünmez', async () => {
    const before = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    const after = (await as(db, admin, 'SELECT * FROM public.admin_platform_totals()')).rows[0];
    assert.equal(Number(after.commission_cents) - Number(before.commission_cents), 800);
    assert.equal(Number(after.sales_cents) - Number(before.sales_cents), 11500);
    assert.equal(Number(after.payable_cents), Number(before.payable_cents));
    assert.equal(Number(after.receivable_cents), Number(before.receivable_cents));
  });

  test('iade talebi açıkken pazaryeri siparişi elle kesimi bekletmez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await payOnline(s, buyer, true);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    assert.equal(await overview(s), undefined);
  });

  test('iade: onay geri çekildiyse satıcı borçlanmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await payOnline(s, buyer, true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    assert.equal((await order(o.id)).payment_status, 'refund_pending');
    // Onay henüz geri çekilmedi: geri çekilirse çift kayıt olmasın diye borç doğmaz.
    assert.equal(await overview(s), undefined);
    await as(db, null, `SELECT public.mark_marketplace_reversed('${o.id}')`);
    await as(db, null, `SELECT public.mark_order_refunded('${o.id}')`);
    assert.equal((await order(o.id)).marketplace_status, 'reversed');
    assert.equal(await overview(s), undefined);
  });

  test('iade: onay geri çekilemedi, panelden iade edildi: satıcının hakkı bir kez borç olur', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await payOnline(s, buyer, true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    await as(db, admin, `SELECT public.admin_mark_refunded('${o.id}')`);
    const row = await overview(s);
    assert.equal(row.balance_cents, -10700);
    assert.equal(row.order_count, 1);
    assert.equal(row.commission_cents, 0);
    const p = (await settle(s, -10700)).rows[0];
    assert.equal(p.amount_cents, -10700);
    assert.equal(p.commission_cents, 0);
    assert.equal(await overview(s), undefined);
    assert.equal((await settleFails(s, -10700))?.code, '55000');
  });

  test('teslimden önce iptal edilen pazaryeri siparişi hiçbir kesime girmez, kuyruğa da girmez', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await payOnline(s, buyer, true);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    assert.equal((await order(o.id)).payment_status, 'refund_pending');
    assert.equal(await approval(o.id), undefined);
    assert.equal(await overview(s), undefined);
    assert.equal((await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}') AS r`)).rows[0].r, 'none');
  });

  test('ödeme iptalden sonra gelirse de akış kayda geçer, iade kuyruğuna girer', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await placeOrder(buyer, s, 'online');
    await as(db, null, 'SELECT public.record_payment_init($1,$2,$3,$4,$5,$6)', [o.id, `t-${o.id}`, true, 'KEY', 10700, null]);
    await as(db, buyer, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    const r = await as(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4) AS r', [o.id, 'P', '[]', 11500]);
    assert.equal(r.rows[0].r, 'refund_pending');
    assert.equal((await order(o.id)).marketplace_status, 'held');
  });

  test('yeniden başlatmada akış kararı güncellenir, aynı ödeme iki kez işlenmez', async () => {
    const s = await seller();
    const o = await placeOrder(await user(), s, 'online');
    await as(db, null, 'SELECT public.record_payment_init($1,$2,$3,$4,$5,$6)', [o.id, `a-${o.id}`, true, 'KEY', 10700, null]);
    await as(db, null, 'SELECT public.record_payment_init($1,$2,$3,$4,$5,$6)', [o.id, `b-${o.id}`, false, null, null, 'no_submerchant_key']);
    const p = await one(`SELECT * FROM public.order_payments WHERE order_id='${o.id}'`);
    assert.equal(p.marketplace, false);
    assert.equal(p.submerchant_key, null);
    assert.equal(p.token, `b-${o.id}`);
    const pay = () => as(db, null, 'SELECT public.mark_order_paid($1,$2,$3::jsonb,$4) AS r', [o.id, 'P', '[]', 11500]);
    assert.equal((await pay()).rows[0].r, 'paid');
    assert.equal((await pay()).rows[0].r, 'already_paid');
    assert.equal((await order(o.id)).marketplace_status, null);
  });
});

describe('Onay kuyruğu', () => {
  test('teslimde bir kez sıraya girer; pazaryeri olmayan girmez', async () => {
    const s = await seller();
    const buyer = await user();
    const market = await payOnline(s, buyer, true);
    const manual = await payOnline(s, buyer, false);
    const cash = await placeOrder(buyer, s);
    assert.equal(await approval(market.id), undefined, 'teslimden önce sırada değil');
    for (const o of [market, manual, cash]) await deliver(s, o.id);
    assert.equal((await approval(market.id)).status, 'pending');
    assert.equal(await approval(manual.id), undefined);
    assert.equal(await approval(cash.id), undefined);
    assert.ok((await claim()).some((r) => r.order_id === market.id));
  });

  test('alınan satır kilitlenir, işlem numaralarıyla döner, deneme sayılır', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    const row = (await claim()).find((r) => r.order_id === o.id);
    assert.equal(row.attempts, 1);
    assert.equal(row.submerchant_key, 'KEY');
    assert.equal(row.submerchant_price_cents, 10700);
    assert.equal(row.transactions[0].paymentTransactionId, 999);
    assert.equal((await claim()).some((r) => r.order_id === o.id), false, 'kilit varken ikinci çalışma almaz');
    await db.exec(`UPDATE public.payment_approvals SET locked_until = now() - interval '1 minute' WHERE order_id='${o.id}'`);
    assert.equal((await claim()).find((r) => r.order_id === o.id).attempts, 2, 'süre dolunca yeniden alınır');
  });

  test('tamamlama idempotent', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    const a = await approval(o.id);
    assert.equal(a.status, 'approved');
    assert.ok(a.approved_at);
    assert.equal((await order(o.id)).marketplace_status, 'approved');
    assert.equal((await claim()).some((r) => r.order_id === o.id), false);
  });

  test('hata: üstel bekler, on denemede yöneticiye kalır, yönetici yeniden başlatır', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.fail_payment_approval('${o.id}', 'onay hatası: 11')`);
    let a = await approval(o.id);
    assert.equal(a.status, 'pending');
    assert.equal(a.last_error, 'onay hatası: 11');
    assert.equal(a.locked_until, null);
    const wait = () => one(`SELECT extract(epoch FROM next_attempt_at - now()) / 60 AS m FROM public.payment_approvals WHERE order_id='${o.id}'`);
    assert.ok(Math.abs((await wait()).m - 5) < 1);
    assert.equal((await claim()).some((r) => r.order_id === o.id), false, 'vakti gelmeden alınmaz');

    for (let i = 2; i <= 10; i += 1) {
      await unlock(o.id);
      assert.equal((await claim()).find((r) => r.order_id === o.id).attempts, i);
      await as(db, null, `SELECT public.fail_payment_approval('${o.id}', 'hata')`);
      if (i < 10) assert.ok((await wait()).m <= 361);
    }
    a = await approval(o.id);
    assert.equal(a.status, 'failed');
    assert.equal(a.attempts, 10);
    await unlock(o.id);
    assert.equal((await claim()).some((r) => r.order_id === o.id), false);
    const queue = (await as(db, admin, 'SELECT * FROM public.admin_payment_approval_queue()')).rows.find((r) => r.order_id === o.id);
    assert.equal(queue.status, 'failed');
    assert.equal(queue.amount_cents, 10700);

    assert.equal((await failure(db, s.uid, `SELECT public.admin_retry_payment_approval('${o.id}')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_retry_payment_approval('${o.id}')`);
    assert.equal((await approval(o.id)).attempts, 0);
    assert.ok((await claim()).some((r) => r.order_id === o.id));
    assert.equal((await failure(db, admin, `SELECT public.admin_retry_payment_approval('${o.id}')`))?.code, '55000', 'başarısız değilse denenmez');
  });

  test('tutar uyuşmazlığı (p_final) hemen yöneticiye kalır', async () => {
    const s = await seller();
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    await claim();
    await as(db, null, `SELECT public.fail_payment_approval('${o.id}', 'uyuşmuyor', TRUE)`);
    assert.equal((await approval(o.id)).status, 'failed');
  });

  test('iade talebi açıkken onay gitmez, reddedilirse gider, onaylanırsa gitmez', async () => {
    const s = await seller();
    const buyer = await user();
    const rejected = await payOnline(s, buyer, true);
    const approved = await payOnline(s, buyer, true);
    await deliver(s, rejected.id);
    await deliver(s, approved.id);
    for (const o of [rejected, approved]) {
      await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    }
    const has = (rows, o) => rows.some((r) => r.order_id === o.id);
    let rows = await claim();
    assert.equal(has(rows, rejected), false);
    assert.equal(has(rows, approved), false);
    await as(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${rejected.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${approved.id}'`);
    rows = await claim();
    assert.equal(has(rows, rejected), true);
    assert.equal(has(rows, approved), false);
  });

  test('iade başlarken: sıradaki iptal, gönderilmekte olan bekletilir, onaylı bildirilir', async () => {
    const s = await seller();
    const buyer = await user();
    const refundState = async (o) => (await as(db, null, `SELECT public.begin_marketplace_refund('${o.id}') AS r`)).rows[0].r;

    const queued = await payOnline(s, buyer, true);
    await deliver(s, queued.id);
    const flying = await payOnline(s, buyer, true);
    await deliver(s, flying.id);
    const done = await payOnline(s, buyer, true);
    await deliver(s, done.id);

    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${done.id}')`);
    await db.exec(`UPDATE public.payment_approvals SET locked_until=NULL WHERE order_id='${queued.id}'`);

    assert.equal(await refundState(flying), 'in_flight');
    assert.equal((await approval(flying.id)).status, 'pending');
    assert.equal(await refundState(queued), 'cancelled');
    assert.equal((await approval(queued.id)).status, 'cancelled');
    assert.equal(await refundState(done), 'approved');
    assert.equal((await approval(done.id)).status, 'approved');

    // İptal edilen satır bu arada biten onayla işaretlenir: para satıcıya gidiyor, kayıt 'held' kalmamalı (037).
    await as(db, null, `SELECT public.complete_payment_approval('${queued.id}')`);
    assert.equal((await approval(queued.id)).status, 'approved');
    assert.equal((await order(queued.id)).marketplace_status, 'approved');
    assert.equal((await claim()).some((r) => r.order_id === queued.id), false);
  });

  test('panelden iade edilen sipariş kuyruktan düşer, onay gitmez, satıcıyı bağlamaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await payOnline(s, buyer, true);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='soğuk' WHERE id='${o.id}'`);
    await as(db, admin, `UPDATE public.orders SET refund_status='approved' WHERE id='${o.id}'`);
    await as(db, admin, `SELECT public.admin_mark_refunded('${o.id}')`);
    assert.equal((await approval(o.id)).status, 'cancelled');
    assert.equal((await claim()).some((r) => r.order_id === o.id), false);
    // Onay hiç verilmedi: satıcıya para gitmedi, borç da doğmaz.
    assert.equal(await overview(s), undefined);
    assert.equal(await failure(db, s.uid, 'SELECT public.delete_my_account()'), null);
  });

  test('adres ayarlanmamışken görev sessizce biter', async () => {
    await db.query('SELECT public.run_payment_approve()');
  });
});

describe('Hesap silme', () => {
  const del = (uid) => failure(db, uid, 'SELECT public.delete_my_account()');

  test('parası iyzico\'da bekleyen satıcı silinemez; onay bitince silinir, kimlik bilgisi kalmaz', async () => {
    const s = await seller();
    await insertCompany(s.uid, s.id);
    const o = await payOnline(s, await user(), true);
    await deliver(s, o.id);
    assert.equal((await del(s.uid))?.code, '55000');
    await claim();
    await as(db, null, `SELECT public.complete_payment_approval('${o.id}')`);
    assert.equal(await del(s.uid), null);
    assert.equal(await one(`SELECT * FROM public.seller_company_info WHERE seller_id='${s.id}'`), undefined);
    assert.equal((await one(`SELECT display_name FROM public.sellers WHERE id='${s.id}'`)).display_name, 'Silinmiş satıcı');
  });
});

describe('Hata kodları (EVN)', () => {
  test('doğrulanmamış telefon EVN05, konum yok EVN02, alan dışı EVN03', async () => {
    const buyer = await user();
    const uid = await user('seller');
    const id = randomUUID();
    const item = randomUUID();
    await db.exec(`
      INSERT INTO public.sellers (id, user_id, display_name, is_active, latitude, longitude, delivery_radius_km)
      VALUES ('${id}','${uid}','Konumlu',true,41.0,29.0,5);
      INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
    `);
    const place = (lat, lng) => failure(db, buyer,
      'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL,NULL,$5,$6)',
      [id, JSON.stringify([{ menu_item_id: item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash', lat, lng]);

    await db.exec(`UPDATE public.app_config SET value='{"required": true}' WHERE key='phone_verification'`);
    assert.equal((await place(41.0, 29.0))?.code, 'EVN05');
    await db.exec(`UPDATE public.app_config SET value='{"required": false}' WHERE key='phone_verification'`);

    const missing = await place(null, null);
    assert.equal(missing?.code, 'EVN02');
    assert.match(missing.message, /konum/i);
    const far = await place(39.0, 35.0);
    assert.equal(far?.code, 'EVN03');
    assert.match(far.message, /alan/i);
    assert.equal(await place(41.0, 29.0), null);
  });
});

describe('Uygulama ve belge', () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  test('uygulama kodları sunucuyla aynı, telefon penceresi yalnızca telefon hatasında açılır', () => {
    const db_ = read('lib/db.ts');
    assert.match(db_, /PHONE_NOT_VERIFIED = 'EVN05'/);
    assert.match(db_, /DELIVERY_LOCATION_MISSING = 'EVN02'/);
    assert.match(db_, /OUTSIDE_DELIVERY_AREA = 'EVN03'/);
    const cart = read('app/(customer)/cart.tsx');
    assert.match(cart, /err\?\.code === PHONE_NOT_VERIFIED\) \{\s+setPhoneModal\(true\)/);
    assert.match(cart, /err\?\.code === DELIVERY_LOCATION_MISSING \|\| err\?\.code === OUTSIDE_DELIVERY_AREA/);
  });

  test('canlıya alma belgesi: 036 listede, bölüm ve uyarı var', () => {
    const doc = read('docs/CANLIYA-ALMA.md');
    assert.match(doc, /`035`, `036`, `037`, `038`(, `\d+`)*\. `023`/);
    assert.match(doc, /## Otomatik satıcı ödemesi/);
    assert.match(doc, /iyzico'ya karşı hiç çalıştırılmadı/);
  });

  test('yeni fonksiyonlar kayıtlı; zamanlanan JWT istemez, yöneticininki ister', () => {
    const config = read('supabase/config.toml');
    assert.match(config, /\[functions\.payment-approve\]\s+verify_jwt = false/);
    assert.doesNotMatch(config, /functions\.submerchant-sync/);
  });
});

describe('track_events sınırı', () => {
  const SESSION = 'sinir-oturumu-0123456789';
  const track = async (session, n = 1) => (await asAnon('SELECT public.track_events($1::jsonb) AS n', [
    JSON.stringify(Array.from({ length: n }, () => ({ session_id: session, name: 'app_open', props: {} }))),
  ])).rows[0].n;
  const count = async (session) => (await db.query('SELECT count(*)::int AS n FROM public.analytics_events WHERE session_id=$1', [session])).rows[0].n;
  const seed = (session, n, age = '1 minute') => db.query(
    `INSERT INTO public.analytics_events (session_id, name, created_at)
     SELECT $1, 'app_open', now() - $3::interval FROM generate_series(1, $2::int)`, [session, n, age]);

  test('oturum günde 500 olayı geçemez, fazlası hata vermeden atlanır', async () => {
    await seed(SESSION, 495);
    assert.equal(await track(SESSION, 20), 5);
    assert.equal(await count(SESSION), 500);
    assert.equal(await track(SESSION, 20), 0);
    assert.equal(await count(SESSION), 500);
  });

  test('sınır oturum başınadır, başka oturum etkilenmez', async () => {
    const other = 'baska-oturum-0123456789ab';
    assert.equal(await track(other, 3), 3);
    assert.equal(await count(other), 3);
  });

  test('aynı partide sınırdaki oturum atlanır, diğeri yazılır', async () => {
    const full = 'dolu-oturum-0123456789abc';
    const free = 'bos-oturum-0123456789abcd';
    await seed(full, 500);
    const r = await asAnon('SELECT public.track_events($1::jsonb) AS n', [JSON.stringify([
      { session_id: full, name: 'app_open', props: {} },
      { session_id: free, name: 'app_open', props: {} },
    ])]);
    assert.equal(r.rows[0].n, 1);
    assert.equal(await count(full), 500);
    assert.equal(await count(free), 1);
  });

  test('bir günden eski olaylar sayılmaz', async () => {
    const old = 'eski-oturum-0123456789abc';
    await seed(old, 500, '25 hours');
    assert.equal(await track(old, 2), 2);
  });

  test('geçersiz olay eskisi gibi atlanır', async () => {
    assert.equal(await track('kisa'), 0);
    const r = await asAnon('SELECT public.track_events($1::jsonb) AS n', [JSON.stringify([{ name: 'app_open' }])]);
    assert.equal(r.rows[0].n, 0);
  });
});
