// 057: menü bölümleri, ürün sırası, ekstra/porsiyon/çeşit kaydı.
// 058: destek geçmişi, başvuru reddi, restorana özel komisyon.
// 059: restoran kalitesi raporu, birim ekonomi ayarı.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

let db;
let admin;

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
  admin = await user(db, 'admin');
});

async function user(d, role = 'buyer') {
  const id = randomUUID();
  await d.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

async function seller(d = db, { active = true } = {}) {
  // Onay bekleyen başvuran henüz müşteri rolündedir; rol onayda satıcıya geçer.
  const uid = await user(d, active ? 'seller' : 'buyer');
  const id = randomUUID();
  const item = randomUUID();
  await d.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active, seller_type) VALUES ('${id}','${uid}','Menü Lokanta',${active},'restaurant');
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Adana',20000);
  `);
  return { uid, id, item };
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;

async function order(s, buyer, items) {
  return (await as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4)',
    [s.id, JSON.stringify(items ?? [{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', 'cash'])).rows[0];
}

describe('Menü bölümleri', () => {
  test('restoran bölümlerini açar, sıralar, adlandırır; silinen bölümün ürünü bölümsüz kalır', async () => {
    const s = await seller();
    const created = (await as(db, s.uid, `SELECT * FROM public.save_menu_sections('[{"title":"Kebaplar"},{"title":"İçecekler"}]')`)).rows;
    assert.deepEqual(created.map(r => [r.title, r.sort_order]), [['Kebaplar', 0], ['İçecekler', 1]]);
    const [kebap, icecek] = created;
    await as(db, s.uid, `UPDATE public.menu_items SET section_id='${kebap.id}' WHERE id='${s.item}'`);
    assert.equal((await one('SELECT section_id FROM public.menu_items WHERE id=$1', [s.item])).section_id, kebap.id);

    // Sıra değişir, ad değişir, kimlik korunur.
    const next = (await as(db, s.uid, 'SELECT * FROM public.save_menu_sections($1::jsonb)',
      [JSON.stringify([{ id: icecek.id, title: 'Soğuk İçecekler' }, { id: kebap.id, title: 'Kebaplar' }])])).rows;
    assert.deepEqual(next.map(r => [r.id, r.title, r.sort_order]), [[icecek.id, 'Soğuk İçecekler', 0], [kebap.id, 'Kebaplar', 1]]);

    // Bölüm silinir, ürünü silinmez.
    await as(db, s.uid, 'SELECT * FROM public.save_menu_sections($1::jsonb)', [JSON.stringify([{ id: icecek.id, title: 'Soğuk İçecekler' }])]);
    assert.equal((await one('SELECT section_id FROM public.menu_items WHERE id=$1', [s.item])).section_id, null);
    assert.equal((await one('SELECT count(*)::int n FROM public.menu_items WHERE id=$1', [s.item])).n, 1);
  });

  test('aynı ad, boş ad ve başkasının bölümü reddedilir; tabloya doğrudan yazılamaz', async () => {
    const s = await seller();
    const other = await seller();
    assert.equal((await failure(db, s.uid, `SELECT public.save_menu_sections('[{"title":"Tatlı"},{"title":"tatlı"}]')`))?.code, '22023');
    assert.equal((await failure(db, s.uid, `SELECT public.save_menu_sections('[{"title":"  "}]')`))?.code, '22023');
    const [theirs] = (await as(db, other.uid, `SELECT * FROM public.save_menu_sections('[{"title":"Onların"}]')`)).rows;
    assert.equal((await failure(db, s.uid, 'SELECT public.save_menu_sections($1::jsonb)', [JSON.stringify([{ id: theirs.id, title: 'Benim' }])]))?.code, '42501');
    // Başkasının bölümüne ürün konamaz.
    assert.equal((await failure(db, s.uid, `UPDATE public.menu_items SET section_id='${theirs.id}' WHERE id='${s.item}'`))?.code, '42501');
    assert.equal((await failure(db, s.uid, `INSERT INTO public.menu_sections (seller_id, title) VALUES ('${s.id}','X')`))?.code, '42501');
    // Müşteri bölümleri okur, yazamaz.
    const buyer = await user(db);
    assert.equal((await as(db, buyer, 'SELECT count(*)::int n FROM public.menu_sections WHERE seller_id=$1', [other.id])).rows[0].n, 1);
    assert.equal((await failure(db, buyer, `SELECT public.save_menu_sections('[{"title":"X"}]')`))?.code, '42501');
  });
});

describe('Ürün sırası', () => {
  test('sıra tek çağrıyla yazılır; yalnızca kendi ürünleri, tekrarsız', async () => {
    const s = await seller();
    const b = randomUUID(); const c = randomUUID();
    await db.exec(`INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${b}','${s.id}','Ayran',3000),('${c}','${s.id}','Künefe',9000)`);
    await as(db, s.uid, 'SELECT public.reorder_menu_items($1::uuid[])', [[c, s.item, b]]);
    const order = (await rows('SELECT id FROM public.menu_items WHERE seller_id=$1 ORDER BY sort_order', [s.id])).map(r => r.id);
    assert.deepEqual(order, [c, s.item, b]);
    const other = await seller();
    assert.equal((await failure(db, s.uid, 'SELECT public.reorder_menu_items($1::uuid[])', [[c, other.item]]))?.code, '42501');
    assert.equal((await failure(db, s.uid, 'SELECT public.reorder_menu_items($1::uuid[])', [[c, c]]))?.code, '22023');
    assert.equal((await failure(db, s.uid, 'SELECT public.reorder_menu_items($1::uuid[])', [[]]))?.code, '22023');
  });
});

describe('Ekstra, porsiyon, çeşit', () => {
  test('yerinde güncellenir, kimlik korunur, bitti olan siparişe giremez', async () => {
    const s = await seller();
    const save = (kind, list) => as(db, s.uid, 'SELECT public.save_menu_item_choices($1,$2,$3::jsonb)', [s.item, kind, JSON.stringify(list)]);
    await save('portion', [{ label: 'Tek', price_cents: 20000, is_available: true }, { label: 'Duble', price_cents: 30000, is_available: true }]);
    const first = await rows('SELECT id, label, sort_order FROM public.menu_item_portions WHERE menu_item_id=$1 ORDER BY sort_order', [s.item]);
    assert.deepEqual(first.map(r => [r.label, r.sort_order]), [['Tek', 0], ['Duble', 1]]);
    const [tek, duble] = first;

    // Sıra ve fiyat değişir, Duble biter; kimlikler aynı kalır.
    await save('portion', [
      { id: duble.id, label: 'Duble', price_cents: 32000, is_available: false },
      { id: tek.id, label: 'Tek porsiyon', price_cents: 20000, is_available: true },
    ]);
    const after = await rows('SELECT id, label, price_cents, is_available, sort_order FROM public.menu_item_portions WHERE menu_item_id=$1 ORDER BY sort_order', [s.item]);
    assert.deepEqual(after.map(r => [r.id, r.label, r.price_cents, r.is_available]),
      [[duble.id, 'Duble', 32000, false], [tek.id, 'Tek porsiyon', 20000, true]]);

    // Bitti olan porsiyonla sipariş verilemez, satıştakiyle verilir.
    const buyer = await user(db);
    assert.ok(await failure(db, buyer, 'SELECT public.place_order($1,$2::jsonb,$3,NULL,$4)',
      [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1, portion_id: duble.id }]), 'Test Mah. Test Sok. No:1', 'cash']));
    const o = await order(s, buyer, [{ menu_item_id: s.item, quantity: 1, portion_id: tek.id }]);
    assert.equal(o.subtotal_cents, 20000);

    // Çeşit fiyat farkı 0 olabilir; ekstra listeden çıkan silinir.
    await save('variant', [{ label: 'Acılı', price_cents: 0, is_available: true }, { label: 'Acısız', price_cents: 0, is_available: true }]);
    assert.equal((await one('SELECT count(*)::int n FROM public.menu_item_variants WHERE menu_item_id=$1', [s.item])).n, 2);
    await save('extra', [{ label: 'Lavaş', price_cents: 500, is_available: true }]);
    await save('extra', []);
    assert.equal((await one('SELECT count(*)::int n FROM public.menu_item_extras WHERE menu_item_id=$1', [s.item])).n, 0);
  });

  test('geçersiz fiyat, tekrar eden ad ve başkasının ürünü reddedilir', async () => {
    const s = await seller();
    const other = await seller();
    const call = (uid, item, kind, list) => failure(db, uid, 'SELECT public.save_menu_item_choices($1,$2,$3::jsonb)', [item, kind, JSON.stringify(list)]);
    assert.equal((await call(s.uid, s.item, 'portion', [{ label: 'Bedava', price_cents: 0 }]))?.code, '22023');
    assert.equal((await call(s.uid, s.item, 'extra', [{ label: 'Sos', price_cents: -100 }]))?.code, '22023');
    assert.equal((await call(s.uid, s.item, 'extra', [{ label: 'Sos', price_cents: 100 }, { label: 'SOS', price_cents: 0 }]))?.code, '22023');
    assert.equal((await call(s.uid, s.item, 'topping', []))?.code, '22023');
    assert.equal((await call(s.uid, other.item, 'extra', []))?.code, '42501');
    // Başka ürünün satırı bu ürünün listesine kimliğiyle sokulamaz.
    await as(db, other.uid, 'SELECT public.save_menu_item_choices($1,$2,$3::jsonb)', [other.item, 'extra', JSON.stringify([{ label: 'Peynir', price_cents: 100 }])]);
    const theirs = await one('SELECT id FROM public.menu_item_extras WHERE menu_item_id=$1', [other.item]);
    assert.equal((await call(s.uid, s.item, 'extra', [{ id: theirs.id, label: 'Peynir', price_cents: 100 }]))?.code, '42501');
  });
});

describe('Mevcut veriyle kurulum', () => {
  test('eski ürünler eklenme sırasıyla numaralanır, eski destek talepleri geçmişe taşınır', async () => {
    const old = await createDb({ until: '057' });
    const s = await seller(old);
    const second = randomUUID();
    await old.exec(`INSERT INTO public.menu_items (id, seller_id, title, price_cents, created_at) VALUES ('${second}','${s.id}','Sonraki',1000, now() + interval '1 minute')`);
    const customer = await user(old);
    const ticket = randomUUID();
    // 050 öncesi açılmış talep: mesaj geçmişi yok. Sonra müşteri 051 ile yanıt yazmış (geçmişte tek mesaj var).
    await old.exec(`
      INSERT INTO public.support_tickets (id, user_id, category, message, status, reply, replied_at, created_at)
      VALUES ('${ticket}','${customer}','order','Siparişim gelmedi','answered','Kontrol ediyoruz', now() - interval '1 hour', now() - interval '2 hours');
      DELETE FROM public.support_ticket_messages WHERE ticket_id = '${ticket}';
    `);
    await as(old, customer, `SELECT public.reply_support_ticket('${ticket}', 'Hâlâ gelmedi')`);
    for (const f of ['057_menu_sections_choices.sql', '058_support_applications_commission.sql', '059_growth_reports.sql']) {
      await old.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
    const order = (await old.query('SELECT id, sort_order FROM public.menu_items WHERE seller_id=$1 ORDER BY sort_order', [s.id])).rows;
    assert.deepEqual(order.map(r => [r.id, r.sort_order]), [[s.item, 0], [second, 1]]);
    const history = (await as(old, customer, 'SELECT author_role, body FROM public.support_ticket_history($1)', [ticket])).rows;
    assert.deepEqual(history.map(r => [r.author_role, r.body]), [['customer', 'Siparişim gelmedi'], ['admin', 'Kontrol ediyoruz'], ['customer', 'Hâlâ gelmedi']]);
    // İkinci kez çalışması bir şey çoğaltmaz, restoranın seçtiği sırayı bozmaz.
    await as(old, s.uid, 'SELECT public.reorder_menu_items($1::uuid[])', [[second, s.item]]);
    for (const f of ['057_menu_sections_choices.sql', '058_support_applications_commission.sql']) {
      await old.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
    assert.equal((await old.query('SELECT count(*)::int n FROM public.support_ticket_messages WHERE ticket_id=$1', [ticket])).rows[0].n, 3);
    const kept = (await old.query('SELECT id FROM public.menu_items WHERE seller_id=$1 ORDER BY sort_order', [s.id])).rows.map(r => r.id);
    assert.deepEqual(kept, [second, s.item]);
  });
});

describe('Restoran başvurusu', () => {
  test('yönetici nedenle reddeder; başvuran görür, yeniden başvurur; onayda kayıt silinir', async () => {
    const s = await seller(db, { active: false });
    const notes = async (uid, title) => (await one('SELECT count(*)::int n FROM public.notifications WHERE user_id=$1 AND title=$2', [uid, title])).n;
    assert.equal((await failure(db, s.uid, `SELECT public.admin_reject_seller('${s.id}', 'Belgeler okunmuyor')`))?.code, '42501');
    assert.equal((await failure(db, admin, `SELECT public.admin_reject_seller('${s.id}', 'Yok')`))?.code, '22023');
    await as(db, admin, `SELECT public.admin_reject_seller('${s.id}', 'Vergi levhası okunmuyor')`);
    assert.equal(await notes(s.uid, 'Restoran başvurun onaylanmadı'), 1);
    assert.equal((await as(db, s.uid, 'SELECT reason FROM public.seller_application_reviews')).rows[0].reason, 'Vergi levhası okunmuyor');
    // Başkası göremez, kimse doğrudan yazamaz.
    assert.equal((await as(db, await user(db), 'SELECT count(*)::int n FROM public.seller_application_reviews')).rows[0].n, 0);
    assert.equal((await failure(db, s.uid, `DELETE FROM public.seller_application_reviews`))?.code, '42501');
    assert.equal((await one('SELECT count(*)::int n FROM public.seller_application_reviews WHERE seller_id=$1', [s.id])).n, 1);

    assert.equal((await as(db, s.uid, 'SELECT public.resubmit_seller_application() AS r')).rows[0].r, true);
    assert.equal(await notes(admin, 'Restoran başvurusu yeniden gönderildi'), 1);
    assert.equal((await as(db, s.uid, 'SELECT public.resubmit_seller_application() AS r')).rows[0].r, false);

    await as(db, admin, `SELECT public.admin_reject_seller('${s.id}', 'Adres eksik, tamamla')`);
    await db.exec(`INSERT INTO public.seller_documents (seller_id, doc_type, storage_path) VALUES
      ('${s.id}','tax_certificate','${s.uid}/vergi.jpg'), ('${s.id}','business_license','${s.uid}/ruhsat.jpg')`);
    await as(db, admin, `UPDATE public.sellers SET is_active = true WHERE id = '${s.id}'`);
    assert.equal((await one('SELECT count(*)::int n FROM public.seller_application_reviews WHERE seller_id=$1', [s.id])).n, 0);
    assert.equal(await notes(s.uid, 'Restoranın satışa açıldı'), 1);
    // Satıştaki restoranın başvurusu reddedilemez; pasife alınsa da onaylanmış restoran reddedilemez.
    assert.equal((await failure(db, admin, `SELECT public.admin_reject_seller('${s.id}', 'Sonradan ret')`))?.code, '55000');
    await db.exec(`UPDATE public.users SET role='seller', is_approved=true WHERE id='${s.uid}'; UPDATE public.sellers SET is_active=false WHERE id='${s.id}'`);
    assert.equal((await failure(db, admin, `SELECT public.admin_reject_seller('${s.id}', 'Sonradan ret')`))?.code, '55000');
  });
});

describe('Restorana özel komisyon', () => {
  test('oran yeni siparişe uygulanır, kaldırılınca genel oran döner, restorana haber verilir', async () => {
    const s = await seller();
    const buyer = await user(db);
    assert.equal((await failure(db, s.uid, `SELECT public.admin_set_seller_commission('${s.id}', 1)`))?.code, '42501');
    assert.equal((await failure(db, admin, `SELECT public.admin_set_seller_commission('${s.id}', 51)`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_set_seller_commission('${s.id}', 7.555)`))?.code, '22023');

    const general = await order(s, buyer);
    await as(db, admin, `UPDATE public.orders SET status='cancelled' WHERE id='${general.id}'`);
    await as(db, admin, `SELECT public.admin_set_seller_commission('${s.id}', 7.5, 'lansman')`);
    const n = await one(`SELECT body FROM public.notifications WHERE user_id=$1 AND title='Komisyon oranın güncellendi' ORDER BY created_at DESC LIMIT 1`, [s.uid]);
    assert.match(n.body, /%7,5\./);
    const special = await order(s, buyer);
    assert.equal(Number(special.commission_rate), 7.5);
    // Restoran kendi oranını görür.
    assert.equal(Number((await as(db, s.uid, 'SELECT rate_percent FROM public.seller_commission_rates')).rows[0].rate_percent), 7.5);

    await as(db, admin, `UPDATE public.orders SET status='cancelled' WHERE id='${special.id}'`);
    await as(db, admin, `SELECT public.admin_set_seller_commission('${s.id}', NULL)`);
    const back = await order(s, buyer);
    assert.equal(Number(back.commission_rate), Number(general.commission_rate));
  });
});

describe('Restoran kalitesi raporu', () => {
  test('sipariş ve ihlal sayıları birbirini çarpmaz; ödenmemiş online sipariş sayılmaz', async () => {
    const s = await seller();
    const buyer = await user(db);
    const orders = [];
    for (let i = 0; i < 3; i++) {
      const o = await order(s, buyer);
      orders.push(o);
      await as(db, admin, `UPDATE public.orders SET status='cancelled' WHERE id='${o.id}'`);
    }
    for (const o of orders.slice(0, 2)) {
      await db.exec(`INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late) VALUES ('${o.id}','${s.id}','acceptance_timeout',5)`);
    }
    // Ödemesi tamamlanmamış online sipariş restorana hiç düşmedi.
    const unpaid = await order(s, buyer);
    await db.exec(`UPDATE public.orders SET payment_method='online', payment_status='pending', status='cancelled' WHERE id='${unpaid.id}'`);

    const row = (await as(db, admin, 'SELECT * FROM public.admin_seller_quality(90)')).rows.find(r => r.seller_id === s.id);
    assert.equal(row.orders, 3);
    assert.equal(row.cancelled, 3);
    assert.equal(row.sla_violations, 2);
    assert.equal(Number(row.score), 50, 'yeterli sipariş yok: nötr puan');
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.admin_seller_quality(90)'))?.code, '42501');
    assert.equal(Number((await as(db, s.uid, `SELECT public.refresh_seller_quality('${s.id}') AS v`)).rows[0].v), 50);
  });

  test('birim ekonomi ayarı doğrulanır ve raporlara yansır', async () => {
    assert.equal((await failure(db, admin, `SELECT public.admin_update_unit_economics('{"delivery_cost_cents": -1}')`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_update_unit_economics('{"delivery_cost_cents": "100"}')`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_update_unit_economics('{"kur": 1}')`))?.code, '22023');
    assert.equal((await failure(db, admin, `SELECT public.admin_update_unit_economics('{"payment_fee_bps": 2500}')`))?.code, '22023');
    assert.equal((await failure(db, (await seller()).uid, `SELECT public.admin_update_unit_economics('{"support_cost_cents": 100}')`))?.code, '42501');
    const v = (await as(db, admin, `SELECT public.admin_update_unit_economics('{"support_cost_cents": 700}') AS v`)).rows[0].v;
    assert.equal(v.support_cost_cents, 700);
    assert.equal(v.payment_fee_bps, 290, 'diğer değerler korunur');
    const report = (await as(db, admin, 'SELECT public.admin_unit_economics(30) AS r')).rows[0].r;
    assert.equal(report.support_cost_cents, report.orders * 700);
    // Varsayımlar müşteriye ve ziyaretçiye görünmez; genel ayarlar görünmeye devam eder.
    const buyer = await user(db);
    assert.equal((await as(db, buyer, `SELECT count(*)::int n FROM public.app_config WHERE key IN ('unit_economics','seller_quality')`)).rows[0].n, 0);
    assert.equal((await as(db, admin, `SELECT count(*)::int n FROM public.app_config WHERE key IN ('unit_economics','seller_quality')`)).rows[0].n, 2);
    assert.equal((await as(db, buyer, `SELECT count(*)::int n FROM public.app_config WHERE key = 'order_pricing'`)).rows[0].n, 1);
  });
});
