// 052: Restoranın kendi SLA ve fatura kaydı, tek iade karar yolu, fatura düzeltmesi, ödeme tarihli mutabakat.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  admin = await user('admin');
  await db.exec(`UPDATE public.app_config SET value = value || '{"enabled":true}'::jsonb WHERE key = 'einvoice_policy'`);
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
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
    INSERT INTO public.seller_company_info (seller_id, company_type, legal_company_title, tax_office, tax_number,
      identity_number, email, gsm_number, address)
    VALUES ('${id}','LIMITED_OR_JOINT_STOCK_COMPANY','Test Gıda','Kadıköy','1234567890','10000000146',
      'fatura@ornek.com','+905551112233','Moda Cad. No:1 Kadıköy');
  `);
  return { id, item, uid };
}

const place = (uid, s) => as(db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash']).then(r => r.rows[0]);

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

async function deliveredOrder() {
  const s = await seller();
  const buyer = await user();
  const o = await place(buyer, s);
  await deliver(s, o.id);
  return { s, buyer, o };
}

const requestRefund = (buyer, orderId) =>
  as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Yemek soğuk geldi' WHERE id='${orderId}'`);

async function invoiceFor(buyer, orderId) {
  return (await as(db, admin, `SELECT * FROM public.admin_create_invoice($1, $2::jsonb)`, [orderId, JSON.stringify({
    title: 'Alıcı A.Ş.', taxNumber: '9876543210', taxOffice: 'Şişli', address: 'Test Mah. No:1', email: 'muhasebe@ornek.com',
  })])).rows[0];
}

const invoiceRow = async id => (await db.query('SELECT * FROM public.invoices WHERE id=$1', [id])).rows[0];

describe('Restoran kendi kayıtlarını görür', () => {
  test('SLA ihlalleri ve faturalar yalnızca kendi restoranına aittir', async () => {
    const a = await deliveredOrder();
    const b = await deliveredOrder();
    await db.exec(`INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late)
      VALUES ('${a.o.id}','${a.s.id}','acceptance_timeout',4), ('${b.o.id}','${b.s.id}','preparation_timeout',9)`);
    const inv = await invoiceFor(a.buyer, a.o.id);

    const mine = (await as(db, a.s.uid, 'SELECT * FROM public.seller_list_sla_violations(50)')).rows;
    assert.deepEqual(mine.map(r => r.order_id), [a.o.id]);
    const invoices = (await as(db, a.s.uid, 'SELECT * FROM public.seller_list_invoices(50)')).rows;
    assert.deepEqual(invoices.map(r => r.id), [inv.id]);
    assert.equal(invoices[0].buyer_title, 'Alıcı A.Ş.');

    assert.equal((await as(db, b.s.uid, 'SELECT * FROM public.seller_list_invoices(50)')).rows.length, 0);
    assert.equal((await as(db, b.s.uid, 'SELECT * FROM public.seller_list_sla_violations(50)')).rows[0].order_id, b.o.id);
    // Müşteri restoranın kaydını göremez.
    assert.equal((await as(db, a.buyer, 'SELECT * FROM public.seller_list_sla_violations(50)')).rows.length, 0);
  });
});

describe('Tek iade karar yolu', () => {
  test('sipariş ekranı iade ekranıyla aynı vakayı karara bağlar', async () => {
    const { buyer, o } = await deliveredOrder();
    await requestRefund(buyer, o.id);
    await as(db, admin, `SELECT public.admin_decide_refund('${o.id}', 'approved', 'Fotoğraf incelendi')`);
    const order = (await db.query('SELECT refund_status FROM public.orders WHERE id=$1', [o.id])).rows[0];
    assert.equal(order.refund_status, 'approved');
    const rc = (await db.query('SELECT * FROM public.refund_cases WHERE order_id=$1', [o.id])).rows[0];
    assert.equal(rc.status, 'approved');
    assert.equal(rc.decided_by, admin);
    assert.equal(rc.decision_note, 'Fotoğraf incelendi');
    assert.equal(rc.approved_cents, o.total_cents);

    // Karara bağlanmış vaka ikinci kez karara bağlanamaz.
    assert.equal((await failure(db, admin, `SELECT public.admin_decide_refund('${o.id}', 'rejected', NULL)`))?.code, '22023');
    // Yönetici olmayan karar veremez.
    assert.equal((await failure(db, buyer, `SELECT public.admin_decide_refund('${o.id}', 'approved', NULL)`))?.code, '42501');
  });
});

describe('İadesi onaylanan siparişin faturası', () => {
  test('gönderilmemiş fatura iptal edilir ve gönderilemez', async () => {
    const { buyer, o } = await deliveredOrder();
    const inv = await invoiceFor(buyer, o.id);
    assert.equal(inv.status, 'queued');
    await requestRefund(buyer, o.id);
    await as(db, admin, `SELECT public.admin_decide_refund('${o.id}', 'approved', NULL)`);
    const row = await invoiceRow(inv.id);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.correction_status, null);
    const claimed = (await service('SELECT (public.service_claim_invoice($1)).id AS id', [inv.id])).rows[0];
    assert.equal(claimed.id, null);
  });

  test('gönderilmiş fatura düzeltme bekler; yönetici sonucu kaydeder', async () => {
    const { buyer, o } = await deliveredOrder();
    const inv = await invoiceFor(buyer, o.id);
    await db.exec(`UPDATE public.invoices SET status='accepted', submitted_at=now(), accepted_at=now() WHERE id='${inv.id}'`);
    await requestRefund(buyer, o.id);
    await as(db, admin, `SELECT public.admin_decide_refund('${o.id}', 'approved', NULL)`);

    let row = await invoiceRow(inv.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.correction_status, 'required');
    const overview = (await as(db, admin, 'SELECT public.admin_operations_overview() AS r')).rows[0].r;
    assert.ok(overview.invoice_corrections >= 1);
    const notes = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Fatura düzeltmesi gerekiyor'`, [admin])).rows[0].n;
    assert.ok(notes >= 1);
    // Restoran da düzeltme durumunu görür.
    const sellerInvoices = (await as(db, (await db.query('SELECT s.user_id FROM public.sellers s WHERE s.id=$1', [inv.seller_id])).rows[0].user_id,
      'SELECT * FROM public.seller_list_invoices(10)')).rows;
    assert.equal(sellerInvoices[0].correction_status, 'required');

    // Alıcının iade faturası numarası olmadan kapatılamaz.
    assert.equal((await failure(db, admin, `SELECT public.admin_resolve_invoice_correction('${inv.id}', 'credit_note', NULL, NULL)`))?.code, '22023');
    await as(db, admin, `SELECT public.admin_resolve_invoice_correction('${inv.id}', 'credit_note', 'ABC2026000000012', 'Alıcı iade faturası kesti')`);
    row = await invoiceRow(inv.id);
    assert.equal(row.status, 'accepted');
    assert.equal(row.correction_status, 'resolved');
    assert.equal(row.correction_reference, 'ABC2026000000012');
    assert.equal(row.corrected_by, admin);
    // İkinci kez kapatılamaz.
    assert.equal((await failure(db, admin, `SELECT public.admin_resolve_invoice_correction('${inv.id}', 'cancelled', NULL, NULL)`))?.code, 'P0002');
  });

  test('GİB iptali seçilirse fatura iptal olur', async () => {
    const { buyer, o } = await deliveredOrder();
    const inv = await invoiceFor(buyer, o.id);
    await db.exec(`UPDATE public.invoices SET status='submitted', submitted_at=now() WHERE id='${inv.id}'`);
    await requestRefund(buyer, o.id);
    await as(db, admin, `SELECT public.admin_decide_refund('${o.id}', 'approved', NULL)`);
    await as(db, admin, `SELECT public.admin_resolve_invoice_correction('${inv.id}', 'cancelled', NULL, 'Portaldan iptal edildi')`);
    const row = await invoiceRow(inv.id);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.correction_outcome, 'cancelled');
    assert.equal((await failure(db, admin, `SELECT public.admin_retry_invoice('${inv.id}')`))?.code, '55000');
  });
});

describe('Mutabakat ödeme tarihine göre', () => {
  test('ay sonunda alınan ödeme o aya, ertesi ay yapılan iade ertesi aya yazılır', async () => {
    const { o } = await deliveredOrder();
    // Sipariş ocakta verilip ödendi, iadesi şubatta yapıldı.
    await db.exec(`
      UPDATE public.orders SET payment_method='online', payment_status='paid', created_at='2031-01-31T20:00:00Z' WHERE id='${o.id}';
      INSERT INTO public.order_payments (order_id, paid_at) VALUES ('${o.id}', '2031-01-31T20:01:00Z');
    `);
    const jan = (await as(db, admin, `SELECT * FROM public.admin_create_reconciliation('2031-01-01T00:00:00Z','2031-02-01T00:00:00Z',$1,'iyzico',NULL,NULL)`, [o.total_cents])).rows[0];
    assert.equal(jan.expected_cents, o.total_cents);
    assert.equal(jan.status, 'matched');

    await db.exec(`
      UPDATE public.orders SET payment_status='refunded' WHERE id='${o.id}';
      UPDATE public.order_payments SET refunded_at='2031-02-03T10:00:00Z' WHERE order_id='${o.id}';
    `);
    // Ocak dökümü değişmez: para ocakta çekildi.
    const janAgain = (await as(db, admin, `SELECT * FROM public.admin_create_reconciliation('2031-01-01T00:00:00Z','2031-02-01T00:00:00Z',$1,'iyzico',NULL,NULL)`, [o.total_cents])).rows[0];
    assert.equal(janAgain.expected_cents, o.total_cents);
    const feb = (await as(db, admin, `SELECT * FROM public.admin_create_reconciliation('2031-02-01T00:00:00Z','2031-03-01T00:00:00Z',0,'iyzico',NULL,NULL)`)).rows[0];
    assert.equal(feb.expected_cents, -o.total_cents);
    const breakdown = (await as(db, admin, `SELECT public.admin_reconciliation_breakdown('${feb.id}') AS r`)).rows[0].r;
    assert.equal(Number(breakdown.refunds_cents), o.total_cents);
    assert.equal(Number(breakdown.gross_sales_cents), 0);
    assert.equal(breakdown.basis, 'payment_date');
    assert.equal((await failure(db, admin, `SELECT public.admin_create_reconciliation('2031-02-01T00:00:00Z','2031-03-01T00:00:00Z',0,'kasa',NULL,NULL)`))?.code, '22023');
  });
});
