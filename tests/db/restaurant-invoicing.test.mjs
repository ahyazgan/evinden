// 053: Restoranın kestiği sipariş faturası ve platformun aylık komisyon faturası.
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

async function seller() {
  const id = randomUUID();
  const item = randomUUID();
  const uid = await user('seller');
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Fatura Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { id, item, uid };
}

const place = (uid, s) => as(db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL)',
  [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash']).then(r => r.rows[0]);

async function advance(s, id, until = 'delivered') {
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
    await as(db, s.uid, `UPDATE public.orders SET status='${status}' WHERE id='${id}'`);
    if (status === until) return;
  }
}

async function corporateBuyer() {
  const uid = await user();
  await as(db, uid, `INSERT INTO public.corporate_billing_profiles (user_id, legal_title, tax_office, tax_number, address, email)
    VALUES ('${uid}','Alıcı A.Ş.','Şişli','9876543210','Test Mah. No:1','muhasebe@ornek.com')`);
  return uid;
}

const requestOf = async id => (await db.query('SELECT * FROM public.order_invoice_requests WHERE order_id=$1', [id])).rows[0];
const notes = async (uid, title) => (await db.query('SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title=$2', [uid, title])).rows[0].n;

describe('Sipariş faturası restorandan', () => {
  test('müşteri ister, restoran görür ve numarayı işler, müşteri görür', async () => {
    const s = await seller();
    const buyer = await corporateBuyer();
    const o = await place(buyer, s);
    await as(db, buyer, `SELECT public.request_order_invoice('${o.id}')`);
    assert.equal((await requestOf(o.id)).buyer.title, 'Alıcı A.Ş.');
    assert.equal(await notes(s.uid, 'Kurumsal fatura istendi'), 1);
    // İkinci talep olmaz.
    assert.equal((await failure(db, buyer, `SELECT public.request_order_invoice('${o.id}')`))?.code, '23505');

    // Restoran ve müşteri talebi görür, başka restoran ve başka müşteri görmez.
    assert.equal((await as(db, s.uid, `SELECT count(*)::int n FROM public.order_invoice_requests WHERE order_id='${o.id}'`)).rows[0].n, 1);
    assert.equal((await as(db, buyer, `SELECT count(*)::int n FROM public.order_invoice_requests WHERE order_id='${o.id}'`)).rows[0].n, 1);
    const other = await seller();
    assert.equal((await as(db, other.uid, `SELECT count(*)::int n FROM public.order_invoice_requests WHERE order_id='${o.id}'`)).rows[0].n, 0);
    assert.equal((await as(db, await user(), `SELECT count(*)::int n FROM public.order_invoice_requests WHERE order_id='${o.id}'`)).rows[0].n, 0);
    // Tabloya doğrudan yazılamaz.
    assert.equal((await failure(db, s.uid, `UPDATE public.order_invoice_requests SET status='issued' WHERE order_id='${o.id}'`))?.code, '42501');

    // Onaylanmadan fatura işlenemez.
    assert.equal((await failure(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000001',NULL)`))?.code, '22023');
    await advance(s, o.id);
    // Başka restoran işleyemez, hatalı numara geçmez, yol başka sipariş olamaz.
    assert.equal((await failure(db, other.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000001',NULL)`))?.code, 'P0002');
    assert.equal((await failure(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','a',NULL)`))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000001','${s.uid}/${randomUUID()}/f.pdf')`))?.code, '22023');

    await as(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','abc2026000000001','${s.uid}/${o.id}/fatura.pdf')`);
    const row = await requestOf(o.id);
    assert.equal(row.status, 'issued');
    assert.equal(row.invoice_number, 'ABC2026000000001');
    assert.equal(row.document_path, `${s.uid}/${o.id}/fatura.pdf`);
    assert.equal(await notes(buyer, 'Faturan kesildi'), 1);
    // Numara düzeltilebilir, müşteriye ikinci bildirim gitmez.
    await as(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000002',NULL)`);
    assert.equal((await requestOf(o.id)).invoice_number, 'ABC2026000000002');
    assert.equal((await requestOf(o.id)).document_path, `${s.uid}/${o.id}/fatura.pdf`);
    assert.equal(await notes(buyer, 'Faturan kesildi'), 1);
  });

  test('profil yoksa, iptal edilmişse veya 30 günü geçmişse istenemez', async () => {
    const s = await seller();
    const plain = await user();
    const o1 = await place(plain, s);
    assert.equal((await failure(db, plain, `SELECT public.request_order_invoice('${o1.id}')`))?.code, '55000');

    const buyer = await corporateBuyer();
    const old = await place(buyer, s);
    await advance(s, old.id);
    await db.exec(`UPDATE public.orders SET delivered_at = now() - interval '31 days' WHERE id='${old.id}'`);
    assert.equal((await failure(db, buyer, `SELECT public.request_order_invoice('${old.id}')`))?.code, '22023');
    // Başkasının siparişi.
    assert.equal((await failure(db, plain, `SELECT public.request_order_invoice('${old.id}')`))?.code, 'P0002');
  });

  test('kesilmemiş talep iptalle kapanır; kesilmiş fatura iadede restorana düzeltme olur', async () => {
    const s = await seller();
    const buyer = await corporateBuyer();
    const cancelled = await place(buyer, s);
    await as(db, buyer, `SELECT public.request_order_invoice('${cancelled.id}')`);
    await as(db, s.uid, `UPDATE public.orders SET status='cancelled', cancel_reason='Malzeme bitti' WHERE id='${cancelled.id}'`);
    assert.equal((await requestOf(cancelled.id)).status, 'cancelled');

    const o = await place(buyer, s);
    await as(db, buyer, `SELECT public.request_order_invoice('${o.id}')`);
    await advance(s, o.id);
    await as(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000010',NULL)`);
    await as(db, buyer, `UPDATE public.orders SET refund_status='requested', refund_reason='Yemek soğuk' WHERE id='${o.id}'`);
    await as(db, admin, `SELECT public.admin_decide_refund('${o.id}','approved',NULL)`);
    assert.equal((await requestOf(o.id)).status, 'correction_required');
    assert.equal(await notes(s.uid, 'Faturanı düzelt'), 1);
    assert.equal((await failure(db, s.uid, `SELECT public.seller_mark_order_invoiced('${o.id}','ABC2026000000011',NULL)`))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.seller_mark_invoice_corrected('${o.id}','ok')`))?.code, '22023');
    await as(db, s.uid, `SELECT public.seller_mark_invoice_corrected('${o.id}','e-Arşiv fatura iptal edildi')`);
    const row = await requestOf(o.id);
    assert.equal(row.status, 'corrected');
    assert.equal(row.correction_note, 'e-Arşiv fatura iptal edildi');
  });
});

describe('Aylık komisyon faturası', () => {
  test('ay kapanınca taslak çıkar, kesilince restoran görür; sonradan iade sonraki aya ters kayıt olur', async () => {
    const s = await seller();
    const buyer = await user();
    const delivered = async () => { const o = await place(buyer, s); await advance(s, o.id); return o; };
    const a = await delivered();
    const b = await delivered();
    const late = await delivered();
    await db.exec(`
      UPDATE public.orders SET delivered_at='2025-03-10T12:00:00Z', commission_cents=1000 WHERE id IN ('${a.id}','${b.id}');
      UPDATE public.orders SET delivered_at='2025-03-31T22:30:00Z', commission_cents=700 WHERE id='${late.id}';
    `);
    // İçinde bulunulan ay kapanmadan oluşturulamaz; yönetici dışında kimse oluşturamaz.
    assert.equal((await failure(db, admin, `SELECT public.admin_generate_commission_invoices(date_trunc('month', now())::date)`))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.admin_generate_commission_invoices('2025-03-01')`))?.code, '42501');

    const mine = async month => (await as(db, admin, `SELECT * FROM public.admin_list_commission_invoices('${month}')`)).rows.find(r => r.seller_id === s.id);
    await as(db, admin, `SELECT public.admin_generate_commission_invoices('2025-03-15')`);
    let march = await mine('2025-03-01');
    // 31 Mart 22:30 UTC İstanbul'da 1 Nisan'dır, Mart'a girmez.
    assert.equal(march.order_count, 2);
    assert.equal(march.commission_cents, 2000);
    assert.equal(march.tax_cents, 400);
    assert.equal(march.total_cents, 2400);
    assert.equal(march.status, 'draft');
    // Yeniden hesaplamak satırları çoğaltmaz.
    await as(db, admin, `SELECT public.admin_generate_commission_invoices('2025-03-01')`);
    assert.equal((await mine('2025-03-01')).commission_cents, 2000);
    // Taslak restorana görünmez.
    assert.equal((await as(db, s.uid, `SELECT count(*)::int n FROM public.commission_invoices WHERE seller_id='${s.id}'`)).rows[0].n, 0);

    assert.equal((await failure(db, admin, `SELECT public.admin_mark_commission_invoiced('${march.id}','x',NULL)`))?.code, '22023');
    await as(db, admin, `SELECT public.admin_mark_commission_invoiced('${march.id}','AFY2025000000003',NULL)`);
    assert.equal((await as(db, s.uid, `SELECT invoice_number FROM public.commission_invoices WHERE seller_id='${s.id}'`)).rows[0].invoice_number, 'AFY2025000000003');
    assert.equal(await notes(s.uid, 'Komisyon faturan kesildi'), 1);
    // Kesilmiş fatura yeniden hesaplamada değişmez.
    await as(db, admin, `SELECT public.admin_generate_commission_invoices('2025-03-01')`);
    march = await mine('2025-03-01');
    assert.equal(march.status, 'issued');
    assert.equal(march.commission_cents, 2000);

    // Mart'ta faturalanan sipariş Nisan'da iade edildi: Nisan faturasında ters kayıt, bir kez.
    await db.exec(`UPDATE public.orders SET refund_status='approved' WHERE id='${a.id}'`);
    await as(db, admin, `SELECT public.admin_generate_commission_invoices('2025-04-01')`);
    const april = await mine('2025-04-01');
    assert.equal(april.order_count, 2);
    assert.equal(april.commission_cents, 700 - 1000);
    await as(db, admin, `SELECT public.admin_generate_commission_invoices('2025-04-01')`);
    assert.equal((await mine('2025-04-01')).commission_cents, -300);
    // Toplam eksi olan ay fatura olarak kesilemez.
    assert.equal((await failure(db, admin, `SELECT public.admin_mark_commission_invoiced('${april.id}','AFY2025000000004',NULL)`))?.code, '22023');
  });
});
