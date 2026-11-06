// 045-050: SLA, gelişmiş raporlar, e-fatura, iade vakası, mutabakat ve pazar yeri operasyonları.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';

let db;
let admin;
let buyer;
let sellerUser;

before(async () => {
  db = await createDb();
  admin = await user('admin');
  buyer = await user('buyer');
  sellerUser = await user('seller');
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
  const id = randomUUID();
  const item = randomUUID();
  const uid = await user('seller');
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Test Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',12000);
    INSERT INTO public.seller_company_info (
      seller_id, company_type, legal_company_title, tax_office, tax_number,
      identity_number, email, gsm_number, address
    ) VALUES ('${id}','LIMITED_OR_JOINT_STOCK_COMPANY','Test Gıda Ltd. Şti.','Kadıköy','1234567890',
      '10000000146','fatura@ornek.com','+905551112233','Moda Cad. No:1 Kadıköy');
  `);
  return { id, item, uid };
}

const place = (uid, s, method = 'cash') => as(db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method]).then(r => r.rows[0]);

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

const setEinvoice = enabled => db.exec(`UPDATE public.app_config SET value = value || '{"enabled":${enabled}}'::jsonb WHERE key = 'einvoice_policy'`);

describe('SLA motoru', () => {
  test('geçen sipariş iptal edilir ve tek ihlal yazılır', async () => {
    const s = await seller();
    const o = await place(buyer, s);
    await db.exec(`UPDATE public.orders SET pending_since=now()-interval '45 minutes' WHERE id='${o.id}'`);
    const result = await service('SELECT public.sla_process_orders(now()) AS result');
    assert.equal(result.rows[0].result.cancelled, 1);
    assert.equal((await orderOf(o.id)).status, 'cancelled');
    const violations = (await db.query('SELECT * FROM public.sla_violations WHERE order_id=$1', [o.id])).rows;
    assert.equal(violations.length, 1);
    // Varsayılan kural yalnızca kayıt tutar; ceza tutarı 0'dır.
    assert.equal(violations[0].penalty_cents, 0);
    await service('SELECT public.sla_process_orders(now())');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.sla_violations WHERE order_id=$1', [o.id])).rows[0].n, 1);
  });

  test('kayıt modunda bekleyen sipariş yine iptal edilir, hazırlama gecikmesi yalnızca kaydedilir', async () => {
    const s = await seller();
    const pending = await place(buyer, s);
    const accepted = await place(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${accepted.id}'`);
    await db.exec(`UPDATE public.orders SET pending_since=now()-interval '45 minutes' WHERE id='${pending.id}';
      UPDATE public.orders SET accepted_at=now()-interval '3 hours' WHERE id='${accepted.id}'`);
    await service('SELECT public.sla_process_orders(now())');
    assert.equal((await orderOf(pending.id)).status, 'cancelled');
    assert.equal((await orderOf(accepted.id)).status, 'accepted');
    const types = (await db.query('SELECT violation_type FROM public.sla_violations WHERE order_id = ANY($1) ORDER BY 1', [[pending.id, accepted.id]])).rows.map(r => r.violation_type);
    assert.deepEqual(types, ['acceptance_timeout', 'preparation_timeout']);
  });

  test('SLA ihlalini yalnızca yönetici kapatır', async () => {
    const s = await seller();
    const o = await place(buyer, s);
    await db.exec(`UPDATE public.orders SET pending_since=now()-interval '45 minutes' WHERE id='${o.id}'`);
    await service('SELECT public.sla_process_orders(now())');
    const [row] = (await db.query('SELECT id FROM public.sla_violations WHERE order_id=$1', [o.id])).rows;
    assert.equal((await failure(db, buyer, `SELECT public.admin_resolve_sla_violation('${row.id}','waived')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_resolve_sla_violation('${row.id}','waived')`);
    assert.equal((await db.query('SELECT status FROM public.sla_violations WHERE id=$1', [row.id])).rows[0].status, 'waived');
  });
});

describe('Karar raporları', () => {
  test('rapor yalnızca yöneticiye açık ve satış/iade özetini doğru verir', async () => {
    assert.equal((await failure(db, buyer, 'SELECT public.admin_decision_report(30)'))?.code, '42501');
    const s = await seller();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    const report = (await as(db, admin, 'SELECT public.admin_decision_report(30) AS report')).rows[0].report;
    assert.ok(report.daily.length >= 1);
    assert.ok(report.summary.orders >= 1);
    assert.ok(report.summary.delivered >= 1);
    assert.ok(report.summary.revenue_cents >= o.total_cents);
    assert.equal(report.sellers[0].display_name, 'Test Restoran');
  });
});

describe('E-fatura', () => {
  before(() => setEinvoice(true));
  test('profil olmadan talep oluşturulmaz; profil ile taslak oluşur', async () => {
    const s = await seller();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    assert.equal((await failure(db, buyer, `SELECT public.request_invoice('${o.id}')`))?.code, '55000');
    await as(db, buyer, `INSERT INTO public.corporate_billing_profiles
      (user_id, legal_title, tax_office, tax_number, address, email)
      VALUES ('${buyer}','Test A.Ş.','Kadıköy','9876543210','Test Mah. No:1','muhasebe@ornek.com')`);
    const invoice = (await as(db, buyer, `SELECT * FROM public.request_invoice('${o.id}')`)).rows[0];
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.total_cents, o.total_cents);
    assert.equal(invoice.buyer_snapshot.taxNumber, '9876543210');
    assert.equal((await failure(db, buyer, `SELECT public.admin_queue_invoice('${invoice.id}')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_queue_invoice('${invoice.id}')`);
    assert.equal((await db.query('SELECT status FROM public.invoices WHERE id=$1', [invoice.id])).rows[0].status, 'queued');
  });

  test('başka müşterinin faturası okunamaz', async () => {
    const other = await user('buyer');
    const rows = await as(db, other, 'SELECT * FROM public.invoices');
    assert.equal(rows.rows.length, 0);
  });
});
describe('İade vakası ve mutabakat', () => {
  test('müşteri talebi vaka oluşturur, yönetici kararı orders durumuna taşır', async () => {
    const s = await seller();
    const o = await place(buyer, s);
    await deliver(s, o.id);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Soğuk geldi' WHERE id='${o.id}'`);
    const [refund] = (await as(db, admin, 'SELECT * FROM public.admin_list_refund_cases(\'requested\')')).rows;
    assert.equal(refund.order_id, o.id);
    assert.equal(refund.status, 'requested');
    await as(db, admin, `SELECT public.admin_decide_refund_case('${refund.id}','approved',${o.total_cents},'Kabul')`);
    assert.equal((await orderOf(o.id)).refund_status, 'approved');
    assert.equal((await db.query('SELECT status FROM public.refund_cases WHERE id=$1', [refund.id])).rows[0].status, 'approved');
  });

  test('mutabakat beklenen ve gerçek tutarı farkla kaydeder', async () => {
    const s = await seller();
    const o = await place(buyer, s);
    await as(db, admin, `UPDATE public.orders SET payment_method='online', payment_status='paid' WHERE id='${o.id}'`);
    // Beklenen tutar ödemenin alındığı ana göre hesaplanır (052).
    await db.exec(`INSERT INTO public.order_payments (order_id, paid_at) VALUES ('${o.id}', now() - interval '1 hour')`);
    const [run] = (await as(db, admin, `SELECT * FROM public.admin_create_reconciliation(now()-interval '1 day',now(),${o.total_cents - 500},'iyzico','ref-1')`)).rows;
    assert.equal(run.expected_cents, o.total_cents);
    assert.equal(run.actual_cents, o.total_cents - 500);
    assert.equal(run.difference_cents, -500);
    assert.equal(run.status, 'difference');
    await as(db, admin, `SELECT public.admin_close_reconciliation('${run.id}','Banka farkı incelendi')`);
    assert.equal((await db.query('SELECT status FROM public.reconciliation_runs WHERE id=$1', [run.id])).rows[0].status, 'closed');
  });
});

describe('Kurumsal yönetim deneyimi', () => {
  test('operasyon özeti ve dönem karşılaştırması yalnızca yöneticidir', async () => {
    assert.equal((await failure(db, buyer, 'SELECT public.admin_operations_overview()'))?.code, '42501');
    assert.equal((await failure(db, buyer, 'SELECT public.admin_decision_comparison(30)'))?.code, '42501');
    const overview = (await as(db, admin, 'SELECT public.admin_operations_overview() AS result')).rows[0].result;
    assert.equal(typeof overview.invoice_candidates, 'number');
    assert.equal(typeof overview.sla_open, 'number');
    const comparison = (await as(db, admin, 'SELECT public.admin_decision_comparison(30) AS result')).rows[0].result;
    assert.equal(comparison.days, 30);
    assert.equal(typeof comparison.current.orders, 'number');
    assert.equal(typeof comparison.previous.orders, 'number');
  });

  test('toplu fatura taslakları profilden üretilir ve doğrudan gönderilmez', async () => {
    await setEinvoice(true);
    const corporateBuyer = await user('buyer');
    const s = await seller();
    await as(db, corporateBuyer, `INSERT INTO public.corporate_billing_profiles
      (user_id, legal_title, tax_office, tax_number, address, email)
      VALUES ('${corporateBuyer}','Toplu A.Ş.','Kadıköy','9876543211','Test Mah. No:2','muhasebe2@ornek.com')`);
    const o = await place(corporateBuyer, s);
    await deliver(s, o.id);
    const result = (await as(db, admin, `SELECT public.admin_create_invoices(ARRAY['${o.id}'::uuid]) AS result`)).rows[0].result;
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 0);
    const invoice = (await db.query('SELECT * FROM public.invoices WHERE order_id=$1', [o.id])).rows[0];
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.buyer_snapshot.taxNumber, '9876543211');
    const detail = (await as(db, admin, `SELECT public.admin_invoice_detail('${invoice.id}') AS result`)).rows[0].result;
    assert.equal(detail.invoice_number, invoice.invoice_number);
    assert.ok(Array.isArray(detail.lines));
    assert.equal(detail.total_cents, o.total_cents);
    await db.exec(`UPDATE public.invoices SET status='rejected', error='Sağlayıcı reddetti' WHERE id='${invoice.id}'`);
    assert.equal((await failure(db, buyer, `SELECT public.admin_retry_invoice('${invoice.id}')`))?.code, '42501');
    await as(db, admin, `SELECT public.admin_retry_invoice('${invoice.id}')`);
    const retried = (await db.query('SELECT status, provider_id, error FROM public.invoices WHERE id=$1', [invoice.id])).rows[0];
    assert.equal(retried.status, 'queued');
    assert.equal(retried.provider_id, null);
    assert.equal(retried.error, null);
  });

  test('mutabakat kırılımı çok kalemli sipariş tutarını bir kez sayar', async () => {
    const isolatedBuyer = await user('buyer');
    const s = await seller();
    const o = await place(isolatedBuyer, s);
    await as(db, admin, `UPDATE public.orders SET payment_method='online', payment_status='paid', created_at='2030-01-01T12:00:00Z' WHERE id='${o.id}'`);
    await db.exec(`INSERT INTO public.order_payments (order_id, paid_at) VALUES ('${o.id}', '2030-01-01T12:01:00Z')`);
    await as(db, admin, `SELECT public.admin_create_reconciliation('2030-01-01T00:00:00Z','2030-01-02T00:00:00Z',${o.total_cents - 500},'iyzico','ref-breakdown')`);
    const run = (await db.query('SELECT id FROM public.reconciliation_runs WHERE reference=$1', ['ref-breakdown'])).rows[0];
    const breakdown = (await as(db, admin, `SELECT public.admin_reconciliation_breakdown('${run.id}') AS result`)).rows[0].result;
    assert.equal(breakdown.expected_cents, o.total_cents);
    assert.equal(breakdown.net_cents, o.total_cents);
    assert.equal(breakdown.gross_sales_cents, o.total_cents);
    assert.equal(breakdown.online_orders, 1);
  });
});

