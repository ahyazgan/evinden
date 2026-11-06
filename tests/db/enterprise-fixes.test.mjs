// 045-050 incelemesinde bulunan hataların düzeltmeleri: SLA, iade, hesap silme, e-fatura, mutabakat ve 050 açıkları.
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

async function user(role = 'buyer') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

async function seller({ taxNumber = '1234567890', companyType = 'LIMITED_OR_JOINT_STOCK_COMPANY' } = {}) {
  const id = randomUUID();
  const item = randomUUID();
  const twin = randomUUID();
  const uid = await user('seller');
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Test Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',12000), ('${twin}','${id}','Diğer yemek',12000);
    INSERT INTO public.seller_company_info (
      seller_id, company_type, legal_company_title, tax_office, tax_number,
      identity_number, email, gsm_number, address
    ) VALUES ('${id}','${companyType}','Test Gıda','Kadıköy',${taxNumber ? `'${taxNumber}'` : 'NULL'},
      '10000000146','fatura@ornek.com','+905551112233','Moda Cad. No:1 Kadıköy');
  `);
  return { id, item, twin, uid };
}

const place = (uid, s, method = 'cash') => as(db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 2 }]), 'Test Mah. Test Sok. No:1', method]).then(r => r.rows[0]);

async function deliver(s, id) {
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${status}' WHERE id='${id}'`);
  }
}

async function service(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false); SET ROLE service_role;`);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}

const orderOf = async id => (await db.query('SELECT * FROM public.orders WHERE id=$1', [id])).rows[0];
const setPolicy = value => db.exec(`UPDATE public.app_config SET value = '${JSON.stringify(value)}'::jsonb WHERE key = 'sla_policy'`);
const DEFAULT_POLICY = { enabled: true, reminder_minutes: 10, cancel_minutes: 30, preparation_cancel_minutes: 90, action: 'penalty', penalty_cents: 0 };
const setEinvoice = enabled => db.exec(`UPDATE public.app_config SET value = value || '{"enabled":${enabled}}'::jsonb WHERE key = 'einvoice_policy'`);

async function billingProfile(uid, taxNumber = '9876543210') {
  await as(db, uid, `INSERT INTO public.corporate_billing_profiles (user_id, legal_title, tax_office, tax_number, address, email)
    VALUES ('${uid}','Alıcı A.Ş.','Şişli','${taxNumber}','Test Mah. No:1','muhasebe@ornek.com')`);
}

describe('SLA düzeltmeleri', () => {
  test('varsayılan kural hazırlanan siparişi iptal etmez, ceza yazmaz', async () => {
    await setPolicy(DEFAULT_POLICY);
    const policy = (await db.query(`SELECT value FROM public.app_config WHERE key='sla_policy'`)).rows[0].value;
    assert.equal(policy.action, 'penalty');
    const s = await seller();
    const o = await place(await user(), s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    await db.exec(`UPDATE public.orders SET accepted_at=now()-interval '5 hours' WHERE id='${o.id}'`);
    await service('SELECT public.sla_process_orders(now())');
    assert.equal((await orderOf(o.id)).status, 'accepted');
    const [v] = (await db.query('SELECT * FROM public.sla_violations WHERE order_id=$1', [o.id])).rows;
    assert.equal(v.violation_type, 'preparation_timeout');
    assert.equal(v.penalty_cents, 0);
  });

  test('planlı sipariş, saati gelince hemen iptal edilmez', async () => {
    await setPolicy({ ...DEFAULT_POLICY, action: 'cancel' });
    const s = await seller();
    const buyer = await user();
    const early = await place(buyer, s);
    const late = await place(buyer, s);
    for (const o of [early, late]) await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    // Sabah onaylanmış akşam siparişi: saati 5 dakika önce geldi. Eskiden onaydan geçen süre (9 saat) sayılıp iptal ediliyordu.
    await db.exec(`
      UPDATE public.orders SET accepted_at=now()-interval '9 hours', scheduled_for=now()-interval '5 minutes' WHERE id='${early.id}';
      UPDATE public.orders SET accepted_at=now()-interval '9 hours', scheduled_for=now()-interval '100 minutes' WHERE id='${late.id}';
    `);
    await service('SELECT public.sla_process_orders(now())');
    assert.equal((await orderOf(early.id)).status, 'accepted');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.sla_violations WHERE order_id=$1', [early.id])).rows[0].n, 0);
    assert.equal((await orderOf(late.id)).status, 'cancelled');
    await setPolicy(DEFAULT_POLICY);
  });

  test('SLA kapalıyken bekleyen sipariş yine iptal edilir, ihlal yazılmaz', async () => {
    await setPolicy({ ...DEFAULT_POLICY, enabled: false });
    const s = await seller();
    const o = await place(await user(), s);
    await db.exec(`UPDATE public.orders SET pending_since=now()-interval '45 minutes' WHERE id='${o.id}'`);
    const result = (await service('SELECT public.expire_pending_orders(10, 30) AS n')).rows[0].n;
    assert.equal(result, 1);
    assert.equal((await orderOf(o.id)).status, 'cancelled');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.sla_violations WHERE order_id=$1', [o.id])).rows[0].n, 0);
    await setPolicy(DEFAULT_POLICY);
  });

  test('bozuk kural değeri görevi durdurmaz; yönetici bozuk kural kaydedemez', async () => {
    await setPolicy({ ...DEFAULT_POLICY, enabled: 'no', cancel_minutes: 'abc' });
    const s = await seller();
    const o = await place(await user(), s);
    await db.exec(`UPDATE public.orders SET pending_since=now()-interval '45 minutes' WHERE id='${o.id}'`);
    await service('SELECT public.sla_process_orders(now())');
    assert.equal((await orderOf(o.id)).status, 'cancelled');
    await setPolicy(DEFAULT_POLICY);
    assert.equal((await failure(db, admin, `SELECT public.admin_update_sla_policy('{"enabled":"no"}'::jsonb)`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_update_sla_policy('{"action":"cancel","preparation_cancel_minutes":60}'::jsonb)`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_update_sla_policy('{"surprise":1}'::jsonb)`))?.code, '22023');
    await as(db, admin, `SELECT public.admin_update_sla_policy('{"action":"cancel","preparation_cancel_minutes":120}'::jsonb)`);
    await setPolicy(DEFAULT_POLICY);
  });
});

describe('İade ve hesap silme', () => {
  test('yemek kartıyla ödenen siparişte iade istenebilir', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    await db.exec(`UPDATE public.orders SET payment_method='meal_card_door' WHERE id='${o.id}'`);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Eksik geldi' WHERE id='${o.id}'`);
    const [c] = (await db.query('SELECT * FROM public.refund_cases WHERE order_id=$1', [o.id])).rows;
    assert.equal(c.payment_method, 'meal_card_door');
    assert.equal(c.status, 'requested');
  });

  test('kısmi iade onaylanamaz; tam onay tutarı kaydeder', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${o.id}'`);
    const [c] = (await db.query('SELECT id FROM public.refund_cases WHERE order_id=$1', [o.id])).rows;
    assert.equal((await failure(db, admin, `SELECT public.admin_decide_refund_case('${c.id}','approved',${o.total_cents - 100},'Kısmi')`))?.code, '22023');
    await as(db, admin, `SELECT public.admin_decide_refund_case('${c.id}','approved',NULL,'Kabul')`);
    const row = (await db.query('SELECT status, approved_cents, decided_at FROM public.refund_cases WHERE id=$1', [c.id])).rows[0];
    assert.equal(row.status, 'approved');
    assert.equal(row.approved_cents, o.total_cents);
    assert.ok(row.decided_at);
  });

  test('ödenmiş iade, eski yoldan gelen durum değişikliğiyle geri açılmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Yanlış ürün' WHERE id='${o.id}'`);
    const [c] = (await db.query('SELECT id FROM public.refund_cases WHERE order_id=$1', [o.id])).rows;
    await as(db, admin, `SELECT public.admin_decide_refund_case('${c.id}','approved',NULL,'Kabul')`);
    await as(db, admin, `SELECT public.admin_mark_refund_case_paid('${c.id}')`);
    await as(db, admin, `UPDATE public.orders SET refund_status='rejected' WHERE id='${o.id}'`);
    assert.equal((await db.query('SELECT status FROM public.refund_cases WHERE id=$1', [c.id])).rows[0].status, 'paid');
  });

  test('faturası ve iade kaydı olan müşteri hesabını silebilir', async () => {
    await setEinvoice(true);
    const s = await seller();
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const invoice = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o.id}')`)).rows[0];
    const other = await place(buyer, s);
    await deliver(s, other.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${other.id}'`);
    await as(db, buyer, 'SELECT public.delete_my_account()');
    const kept = (await db.query('SELECT customer_id, buyer_snapshot FROM public.invoices WHERE id=$1', [invoice.id])).rows[0];
    assert.equal(kept.customer_id, null);
    assert.equal(kept.buyer_snapshot.taxNumber, '9876543210');
    const refund = (await db.query('SELECT customer_id FROM public.refund_cases WHERE order_id=$1', [other.id])).rows[0];
    assert.equal(refund.customer_id, null);
  });
});

describe('E-fatura düzeltmeleri', () => {
  test('e-fatura kapalıyken talep ve kesim yapılamaz', async () => {
    await setEinvoice(false);
    const s = await seller();
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const err = await failure(db, buyer, `SELECT public.request_invoice('${o.id}')`);
    assert.equal(err?.code, '55000');
    assert.match(err.message, /şu an alınamıyor/);
    assert.equal((await failure(db, admin, `SELECT public.admin_create_invoice('${o.id}', '{"title":"Alıcı A.Ş.","taxNumber":"9876543210","taxOffice":"Şişli","address":"Test Mah. No:1","email":"a@ornek.com"}'::jsonb)`))?.code, '55000');
    await setEinvoice(true);
  });

  test('satırlar toplamı tutar; bahşiş faturaya girmez; indirim satırı vardır', async () => {
    await setEinvoice(true);
    const s = await seller();
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    // 2 x 120 TL + 15 TL teslimat − 20 TL indirim + 10 TL bahşiş
    await db.exec(`UPDATE public.orders SET delivery_fee_cents=1500, discount_cents=2000, tip_cents=1000,
      total_cents=subtotal_cents + 1500 - 2000 + 1000 WHERE id='${o.id}'`);
    const invoice = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o.id}')`)).rows[0];
    const order = await orderOf(o.id);
    assert.equal(invoice.total_cents, order.subtotal_cents + 1500 - 2000);
    assert.equal(invoice.subtotal_cents + invoice.tax_cents, invoice.total_cents);
    const lines = invoice.lines;
    assert.equal(lines.reduce((sum, l) => sum + l.lineTotalCents, 0), invoice.total_cents);
    assert.equal(lines.reduce((sum, l) => sum + l.netCents, 0), invoice.subtotal_cents);
    assert.equal(lines.reduce((sum, l) => sum + l.taxCents, 0), invoice.tax_cents);
    assert.deepEqual(lines.map(l => l.kind), ['item', 'delivery', 'discount']);
    assert.equal(invoice.tax_rate_bps, 1000);
  });

  test('fatura numarası GİB biçiminde ve sıralıdır', async () => {
    await setEinvoice(true);
    const s = await seller();
    const numbers = [];
    for (let i = 0; i < 2; i++) {
      const buyer = await user();
      await billingProfile(buyer, `98765432${10 + i}`);
      const o = await place(buyer, s);
      await deliver(s, o.id);
      numbers.push((await as(db, buyer, `SELECT invoice_number FROM public.request_invoice('${o.id}')`)).rows[0].invoice_number);
    }
    const year = new Date().getFullYear();
    for (const n of numbers) assert.match(n, new RegExp(`^AFY${year}\\d{9}$`));
    assert.equal(Number(numbers[1].slice(7)), Number(numbers[0].slice(7)) + 1);
  });

  test('iadesi istenen siparişe fatura kesilmez', async () => {
    await setEinvoice(true);
    const s = await seller();
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${o.id}'`);
    assert.equal((await failure(db, buyer, `SELECT public.request_invoice('${o.id}')`))?.code, '22023');
    const candidates = (await as(db, admin, 'SELECT order_id FROM public.admin_list_invoice_candidates()')).rows.map(r => r.order_id);
    assert.ok(!candidates.includes(o.id));
  });

  test('şahıs şirketi restorana T.C. kimlik numarasıyla fatura kesilir', async () => {
    await setEinvoice(true);
    const s = await seller({ taxNumber: null, companyType: 'PRIVATE_COMPANY' });
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const invoice = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o.id}')`)).rows[0];
    assert.equal(invoice.seller_snapshot.taxNumber, '10000000146');
  });

  test('aynı fatura gönderime iki kez alınamaz', async () => {
    await setEinvoice(true);
    const s = await seller();
    const buyer = await user();
    await billingProfile(buyer);
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const invoice = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o.id}')`)).rows[0];
    await as(db, admin, `SELECT public.admin_queue_invoice('${invoice.id}')`);
    const first = (await service('SELECT (public.service_claim_invoice($1)).id AS id', [invoice.id])).rows[0].id;
    const second = (await service('SELECT (public.service_claim_invoice($1)).id AS id', [invoice.id])).rows[0].id;
    assert.equal(first, invoice.id);
    assert.equal(second, null);
    await service(`SELECT public.service_set_invoice_status($1,'accepted','prov-1',NULL)`, [invoice.id]);
    const row = (await db.query('SELECT status, provider_id FROM public.invoices WHERE id=$1', [invoice.id])).rows[0];
    assert.equal(row.status, 'accepted');
    assert.equal(row.provider_id, 'prov-1');
    // Gönderimde olmayan (kabul edilmiş) faturaya yeni sonuç yazılamaz.
    assert.ok(await service(`SELECT public.service_set_invoice_status($1,'rejected',NULL,'x')`, [invoice.id]).then(() => false, () => true));
    // Belirsiz gönderim yalnızca yöneticinin notuyla kuyruğa döner.
    const o2 = await place(buyer, s);
    await deliver(s, o2.id);
    const inv2 = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o2.id}')`)).rows[0];
    await as(db, admin, `SELECT public.admin_queue_invoice('${inv2.id}')`);
    await service('SELECT public.service_claim_invoice($1)', [inv2.id]);
    assert.equal((await failure(db, buyer, `SELECT public.admin_release_invoice('${inv2.id}','Sağlayıcıda yok')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_release_invoice('${inv2.id}','Sağlayıcıda yok')`);
    assert.equal((await db.query('SELECT status FROM public.invoices WHERE id=$1', [inv2.id])).rows[0].status, 'queued');
  });
});

describe('Mutabakat düzeltmesi', () => {
  test('aynı dönemde çekilip iade edilen sipariş beklenen tutarı düşürmez', async () => {
    const s = await seller();
    const buyer = await user();
    const paid = await place(buyer, s);
    const refunded = await place(buyer, s);
    await db.exec(`
      UPDATE public.orders SET payment_method='online', payment_status='paid', created_at='2031-01-01T10:00:00Z' WHERE id='${paid.id}';
      UPDATE public.orders SET payment_method='online', payment_status='refunded', created_at='2031-01-01T11:00:00Z' WHERE id='${refunded.id}';
      INSERT INTO public.order_payments (order_id, paid_at) VALUES ('${paid.id}', '2031-01-01T10:01:00Z');
      INSERT INTO public.order_payments (order_id, paid_at, refunded_at) VALUES ('${refunded.id}', '2031-01-01T11:01:00Z', '2031-01-01T15:00:00Z');
    `);
    const [run] = (await as(db, admin, `SELECT * FROM public.admin_create_reconciliation('2031-01-01T00:00:00Z','2031-01-02T00:00:00Z',${paid.total_cents},'iyzico','ref-refund')`)).rows;
    assert.equal(run.expected_cents, paid.total_cents);
    assert.equal(run.difference_cents, 0);
    assert.equal(run.status, 'matched');
    const breakdown = (await as(db, admin, `SELECT public.admin_reconciliation_breakdown('${run.id}') AS r`)).rows[0].r;
    assert.equal(breakdown.gross_sales_cents, paid.total_cents + refunded.total_cents);
    assert.equal(breakdown.refunds_cents, refunded.total_cents);
    assert.equal(breakdown.net_cents, paid.total_cents);
  });
});

describe('050 düzeltmeleri', () => {
  test('ürün değişikliği yanıtı değiştirilemez, bitmiş siparişte uygulanmaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    const [item] = (await db.query('SELECT id FROM public.order_items WHERE order_id=$1', [o.id])).rows;
    const sub = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution('${item.id}','${s.twin}',NULL,'Yemek bitti')`)).rows[0];
    await as(db, buyer, `SELECT public.respond_item_substitution('${sub.id}', true)`);
    assert.equal((await failure(db, buyer, `SELECT public.respond_item_substitution('${sub.id}', false)`))?.code, '22023');
    assert.equal((await db.query('SELECT status FROM public.order_item_substitutions WHERE id=$1', [sub.id])).rows[0].status, 'accepted');

    const o2 = await place(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o2.id}'`);
    const [item2] = (await db.query('SELECT id, title_snapshot FROM public.order_items WHERE order_id=$1', [o2.id])).rows;
    const sub2 = (await as(db, s.uid, `SELECT * FROM public.propose_item_substitution('${item2.id}','${s.twin}',NULL,'Yemek bitti')`)).rows[0];
    await deliver(s, o2.id).catch(() => {});
    await db.exec(`UPDATE public.orders SET status='delivered' WHERE id='${o2.id}'`);
    const res = (await as(db, buyer, `SELECT (public.respond_item_substitution('${sub2.id}', true)).status AS status`)).rows[0];
    assert.equal(res.status, 'expired');
    assert.equal((await db.query('SELECT title_snapshot FROM public.order_items WHERE id=$1', [item2.id])).rows[0].title_snapshot, item2.title_snapshot);
  });

  test('iade kanıtı yalnızca müşterinin kendi klasöründen eklenir', async () => {
    const s = await seller();
    const buyer = await user();
    const stranger = await user();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const bad = await failure(db, buyer, `SELECT public.request_refund_with_evidence('${o.id}','Paket ezik geldi','["${stranger}/${o.id}/a.jpg"]'::jsonb)`);
    assert.equal(bad?.code, '22023');
    await as(db, buyer, `SELECT public.request_refund_with_evidence('${o.id}','Paket ezik geldi','["${buyer}/${o.id}/a.jpg"]'::jsonb)`);
    assert.equal((await orderOf(o.id)).refund_status, 'requested');
  });

  test('istemci operasyon ve kalite alanlarını doğrudan yazamaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await as(db, buyer, `UPDATE public.orders SET eta_minutes=1, delivery_mode='platform_courier' WHERE id='${o.id}'`);
    const row = await orderOf(o.id);
    assert.equal(row.eta_minutes, null);
    assert.equal(row.delivery_mode, 'seller_courier');
    await as(db, s.uid, `UPDATE public.sellers SET quality_score=100 WHERE id='${s.id}'`);
    assert.equal((await db.query('SELECT quality_score FROM public.sellers WHERE id=$1', [s.id])).rows[0].quality_score, null);
    assert.equal((await failure(db, buyer, `SELECT public.refresh_seller_quality('${s.id}')`))?.code, '42501');
    await as(db, s.uid, `SELECT public.refresh_seller_quality('${s.id}')`);
    assert.notEqual((await db.query('SELECT quality_score FROM public.sellers WHERE id=$1', [s.id])).rows[0].quality_score, null);
  });

  test('SLA cezası tahsil edildi diye hakedişten düşülmez', async () => {
    assert.equal((await db.query(`SELECT to_regclass('public.seller_balance_adjustments') AS t`)).rows[0].t, null);
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'admin_settle_seller'`)).rows[0].prosrc;
    assert.ok(!src.includes('seller_balance_adjustments'));
  });
});
