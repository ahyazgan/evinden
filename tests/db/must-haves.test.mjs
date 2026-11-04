import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, failure } from './harness.mjs';

const U = {
  buyer: '00000000-0000-0000-0000-0000000000b1',
  other: '00000000-0000-0000-0000-0000000000b2',
  seller: '00000000-0000-0000-0000-0000000000a1',
  admin: '00000000-0000-0000-0000-0000000000ad',
};
const S = '10000000-0000-0000-0000-000000000001';
const M = '20000000-0000-0000-0000-000000000001';

let db;
const place = (uid, terms = null) => as(
  db, uid,
  'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL,NULL,NULL,NULL,$5)',
  [S, JSON.stringify([{ menu_item_id: M, quantity: 1 }]), 'Moda Cad. No:1', 'cash', terms],
);

before(async () => {
  db = await createDb();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${U.buyer}'),('${U.other}'),('${U.seller}'),('${U.admin}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES
      ('${U.buyer}','Alıcı','buyer',true),('${U.other}','Başka','buyer',true),
      ('${U.seller}','Satıcı','seller',true),('${U.admin}','Yönetici','admin',true);
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active, city, district)
      VALUES ('${S}','${U.seller}','Mutfak','home',true,'İstanbul','Kadıköy');
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${M}','${S}','Mantı',50000);
  `);
});

describe('alerjen', () => {
  test('varsayılan belirtilmedi (NULL), boş liste içermiyor demektir', async () => {
    const { rows } = await as(db, U.buyer, `SELECT allergens FROM public.menu_items WHERE id='${M}'`);
    assert.equal(rows[0].allergens, null);
    await as(db, U.seller, `UPDATE public.menu_items SET allergens='{}' WHERE id='${M}'`);
    const after = await as(db, U.buyer, `SELECT allergens FROM public.menu_items WHERE id='${M}'`);
    assert.deepEqual(after.rows[0].allergens, []);
  });
  test('satıcı alerjen seçer, müşteri okur', async () => {
    await as(db, U.seller, `UPDATE public.menu_items SET allergens='{gluten,milk}' WHERE id='${M}'`);
    const { rows } = await as(db, U.buyer, `SELECT allergens FROM public.menu_items WHERE id='${M}'`);
    assert.deepEqual(rows[0].allergens, ['gluten', 'milk']);
  });
  test('listede olmayan değer reddedilir', async () => {
    const f = await failure(db, U.seller, `UPDATE public.menu_items SET allergens='{uydurma}' WHERE id='${M}'`);
    assert.ok(f);
  });
  test('başka kullanıcı değiştiremez', async () => {
    await as(db, U.other, `UPDATE public.menu_items SET allergens='{}' WHERE id='${M}'`);
    const { rows } = await as(db, U.buyer, `SELECT allergens FROM public.menu_items WHERE id='${M}'`);
    assert.deepEqual(rows[0].allergens, ['gluten', 'milk']);
  });
});

describe('sipariş onayı', () => {
  test('onay sürümü ve zamanı kaydedilir', async () => {
    const { rows } = await place(U.buyer, '2026-11');
    assert.equal(rows[0].terms_version, '2026-11');
    assert.ok(rows[0].terms_accepted_at);
  });
  test('sürüm gelmezse zaman da yazılmaz', async () => {
    const { rows } = await place(U.buyer);
    assert.equal(rows[0].terms_version, null);
    assert.equal(rows[0].terms_accepted_at, null);
  });
  test('kayıt sonradan değiştirilemez', async () => {
    const { rows } = await place(U.buyer, '2026-11');
    const id = rows[0].id;
    await db.exec(`UPDATE public.orders SET terms_version='sahte', terms_accepted_at=NULL WHERE id='${id}'`);
    const check = await db.query(`SELECT terms_version, terms_accepted_at FROM public.orders WHERE id='${id}'`);
    assert.equal(check.rows[0].terms_version, '2026-11');
    assert.ok(check.rows[0].terms_accepted_at);
  });
});

describe('destek talepleri', () => {
  const create = (uid, msg = 'Siparişim gelmedi', order = null) => as(
    db, uid, 'SELECT * FROM public.create_support_ticket($1,$2,$3)', ['order', msg, order],
  );

  test('müşteri açar, yalnızca kendi talebini görür', async () => {
    const { rows } = await create(U.buyer);
    const mine = await as(db, U.buyer, `SELECT id FROM public.support_tickets WHERE id='${rows[0].id}'`);
    assert.equal(mine.rows.length, 1);
    const theirs = await as(db, U.other, `SELECT id FROM public.support_tickets WHERE id='${rows[0].id}'`);
    assert.equal(theirs.rows.length, 0);
  });
  test('doğrudan tabloya yazılamaz', async () => {
    const f = await failure(db, U.buyer, `INSERT INTO public.support_tickets (user_id, category, message) VALUES ('${U.buyer}','other','doğrudan yazı')`);
    assert.ok(f);
  });
  test('başkasının siparişine bağlanamaz', async () => {
    const { rows } = await place(U.buyer);
    const f = await failure(db, U.other, 'SELECT * FROM public.create_support_ticket($1,$2,$3)', ['order', 'Bu sipariş benim', rows[0].id]);
    assert.equal(f?.code, '42501');
  });
  test('satıcı kendi siparişine talep açabilir', async () => {
    const { rows } = await place(U.buyer);
    const t = await create(U.seller, 'Müşteriye ulaşamıyorum', rows[0].id);
    assert.equal(t.rows[0].order_id, rows[0].id);
  });
  test('yönetici yanıtlar, müşteriye bildirim gider', async () => {
    const { rows } = await create(U.buyer, 'Yanıt bekleyen talep');
    const f = await failure(db, U.other, 'SELECT * FROM public.admin_answer_support_ticket($1,$2)', [rows[0].id, 'x']);
    assert.equal(f?.code, '42501');
    await as(db, U.admin, 'SELECT * FROM public.admin_answer_support_ticket($1,$2)', [rows[0].id, 'İlgileniyoruz']);
    const after = await as(db, U.buyer, `SELECT status, reply FROM public.support_tickets WHERE id='${rows[0].id}'`);
    assert.equal(after.rows[0].status, 'answered');
    assert.equal(after.rows[0].reply, 'İlgileniyoruz');
    const n = await as(db, U.buyer, `SELECT type, data FROM public.notifications WHERE type='support' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(n.rows[0].data.ticketId, rows[0].id);
  });
  test('listeyi yalnızca yönetici okur', async () => {
    const f = await failure(db, U.buyer, 'SELECT * FROM public.admin_list_support_tickets()');
    assert.equal(f?.code, '42501');
    const { rows } = await as(db, U.admin, 'SELECT * FROM public.admin_list_support_tickets($1)', ['answered']);
    assert.ok(rows.length >= 1);
    assert.ok(rows[0].user_name);
  });
  test('günde beş talepten fazlası açılamaz', async () => {
    await db.exec(`INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000f1');
      INSERT INTO public.users (id, name, role, is_approved) VALUES ('00000000-0000-0000-0000-0000000000f1','Sık','buyer',true);`);
    const uid = '00000000-0000-0000-0000-0000000000f1';
    for (let i = 0; i < 5; i++) await create(uid, `Talep numarası ${i}`);
    const f = await failure(db, uid, 'SELECT * FROM public.create_support_ticket($1,$2,$3)', ['other', 'Altıncı talep', null]);
    assert.equal(f?.code, '55000');
  });
});

describe('telefon doğrulama', () => {
  test('kapalıyken doğrulanmamış müşteri sipariş verebilir', async () => {
    const { rows } = await place(U.other);
    assert.ok(rows[0].id);
  });
  test('açıkken doğrulanmamış müşteri veremez, doğrulanmış verir', async () => {
    await db.exec(`UPDATE public.app_config SET value='{"required": true}' WHERE key='phone_verification'`);
    const f = await failure(db, U.other, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)', [S, JSON.stringify([{ menu_item_id: M, quantity: 1 }]), 'Moda Cad. No:1']);
    assert.equal(f?.code, 'EVN02');
    await db.exec(`UPDATE auth.users SET phone_confirmed_at=now() WHERE id='${U.other}'`);
    const { rows } = await place(U.other);
    assert.ok(rows[0].id);
    await db.exec(`UPDATE public.app_config SET value='{"required": false}' WHERE key='phone_verification'`);
  });
  test('müşteri ayarı kendisi kapatamaz', async () => {
    await as(db, U.other, `UPDATE public.app_config SET value='{"required": false}' WHERE key='phone_verification'`).catch(() => undefined);
    await db.exec(`UPDATE public.app_config SET value='{"required": true}' WHERE key='phone_verification'`);
    await as(db, U.other, `UPDATE public.app_config SET value='{"required": false}' WHERE key='phone_verification'`).catch(() => undefined);
    const { rows } = await db.query(`SELECT value FROM public.app_config WHERE key='phone_verification'`);
    assert.equal(rows[0].value.required, true);
    await db.exec(`UPDATE public.app_config SET value='{"required": false}' WHERE key='phone_verification'`);
  });
});
