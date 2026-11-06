// 051: Rapor doğruluğu ve destek/kurumsal talep sınırları.
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
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Rapor Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
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

describe('Karar raporu cirosu', () => {
  test('bahşiş ve iadesi onaylanan sipariş ciroya girmez', async () => {
    const s = await seller();
    const buyer = await user();
    const kept = await place(buyer, s);
    const refunded = await place(buyer, s);
    for (const o of [kept, refunded]) await deliver(s, o.id);
    // Birine 10 TL bahşiş eklenir, diğerinin iadesi onaylanır.
    await db.exec(`
      UPDATE public.orders SET tip_cents = 1000, total_cents = total_cents + 1000 WHERE id = '${kept.id}';
      UPDATE public.orders SET refund_status = 'approved' WHERE id = '${refunded.id}';
    `);
    const before = (await as(db, admin, 'SELECT public.admin_decision_report(1) AS r')).rows[0].r;
    const row = (await db.query('SELECT total_cents, tip_cents FROM public.orders WHERE id=$1', [kept.id])).rows[0];
    const sellerRow = before.sellers.find(x => x.id === s.id);
    assert.equal(Number(sellerRow.revenue_cents), row.total_cents - row.tip_cents);
    const cmp = (await as(db, admin, 'SELECT public.admin_decision_comparison(1) AS r')).rows[0].r;
    assert.equal(typeof Number(cmp.current.revenue_cents), 'number');
  });

  test('müşteri listesi en fazla 200 kişidir', async () => {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'admin_decision_report'`)).rows[0].prosrc;
    assert.match(src, /LIMIT 200/);
  });
});

describe('Birim ekonomi', () => {
  test('kapıda ödenen siparişe online ödeme komisyonu ve platform kurye maliyeti yazılmaz', async () => {
    await db.exec(`UPDATE public.app_config SET value = '{"delivery_cost_cents":2500,"support_cost_cents":0,"payment_fee_bps":290,"acquisition_cost_cents":0}'::jsonb WHERE key = 'unit_economics'`);
    await db.exec(`UPDATE public.orders SET created_at = now() - interval '400 days'`);
    const s = await seller();
    const o = await place(await user(), s);
    await deliver(s, o.id);
    const r = (await as(db, admin, 'SELECT public.admin_unit_economics(30) AS r')).rows[0].r;
    assert.equal(r.orders, 1);
    assert.equal(Number(r.payment_fee_cents), 0);
    assert.equal(Number(r.delivery_cost_cents), 0);
    // Online ödenen ve platform kuryesiyle giden siparişte ikisi de yazılır.
    await db.exec(`UPDATE public.orders SET payment_method = 'online', payment_status = 'paid', delivery_mode = 'platform_courier' WHERE id = '${o.id}'`);
    const r2 = (await as(db, admin, 'SELECT public.admin_unit_economics(30) AS r')).rows[0].r;
    assert.equal(Number(r2.payment_fee_cents), Math.round(o.total_cents * 290 / 10000));
    assert.equal(Number(r2.delivery_cost_cents), 2500);
    // İadesi onaylanan sipariş sayılmaz.
    await db.exec(`UPDATE public.orders SET refund_status = 'approved' WHERE id = '${o.id}'`);
    const r3 = (await as(db, admin, 'SELECT public.admin_unit_economics(30) AS r')).rows[0].r;
    assert.equal(r3.orders, 0);
    assert.equal((await failure(db, s.uid, 'SELECT public.admin_unit_economics(30)'))?.code, '42501');
  });

  test('kampanya raporu yöneticiye açık ve çalışıyor', async () => {
    await as(db, admin, 'SELECT * FROM public.admin_campaign_performance(30)');
    assert.equal((await failure(db, await user(), 'SELECT * FROM public.admin_campaign_performance(30)'))?.code, '42501');
  });
});

describe('Spam sınırları', () => {
  test('destek talebine saatte en fazla 10 mesaj; art arda mesajlar tek bildirim üretir', async () => {
    const buyer = await user();
    const ticket = (await as(db, buyer, `SELECT * FROM public.create_support_ticket('other','Siparişim gelmedi, yardım eder misiniz?',NULL)`)).rows[0];
    const notesBefore = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Destek talebine yeni mesaj'`, [admin])).rows[0].n;
    // create_support_ticket ilk müşteri mesajını yazar; o mesaj 10 dakika içinde olduğundan yanıt bildirim üretmez.
    for (let i = 0; i < 9; i++) await as(db, buyer, `SELECT public.reply_support_ticket('${ticket.id}', 'Ek bilgi ${i}')`);
    const err = await failure(db, buyer, `SELECT public.reply_support_ticket('${ticket.id}', 'Fazla mesaj')`);
    assert.equal(err?.code, '55000');
    const notesAfter = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Destek talebine yeni mesaj'`, [admin])).rows[0].n;
    assert.equal(notesAfter, notesBefore);
    // 10 dakikadan eski mesajdan sonra gelen yanıt bildirim üretir.
    await db.exec(`UPDATE public.support_ticket_messages SET created_at = now() - interval '2 hours' WHERE ticket_id = '${ticket.id}'`);
    await as(db, buyer, `SELECT public.reply_support_ticket('${ticket.id}', 'Hâlâ bekliyorum')`);
    const notesLast = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title='Destek talebine yeni mesaj'`, [admin])).rows[0].n;
    assert.equal(notesLast, notesBefore + 1);
    assert.equal((await failure(db, buyer, `SELECT public.reply_support_ticket('${ticket.id}', '   ')`))?.code, '22023');
  });

  test('kurumsal çalışma alanında aynı anda tek bekleyen talep olur', async () => {
    const buyer = await user();
    await as(db, buyer, `SELECT public.request_corporate_workspace('Ofis A', NULL)`);
    const err = await failure(db, buyer, `SELECT public.request_corporate_workspace('Ofis B', NULL)`);
    assert.equal(err?.code, '55000');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.corporate_workspaces WHERE owner_id=$1', [buyer])).rows[0].n, 1);
  });
});
