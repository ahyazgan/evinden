import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

const U = {
  buyer: '00000000-0000-0000-0000-0000000000b1',
  seller: '00000000-0000-0000-0000-0000000000a1',
  other: '00000000-0000-0000-0000-0000000000a2',
};
const S = '10000000-0000-0000-0000-000000000001';
const S2 = '10000000-0000-0000-0000-000000000002';
const M = '20000000-0000-0000-0000-000000000001';
const M2 = '20000000-0000-0000-0000-000000000002';

let db;
const save = (uid, item, groups) =>
  as(db, uid, 'SELECT public.save_menu_option_groups($1, $2::jsonb)', [item, JSON.stringify(groups)]);
const saveFail = (uid, item, groups) =>
  failure(db, uid, 'SELECT public.save_menu_option_groups($1, $2::jsonb)', [item, JSON.stringify(groups)]);
const place = (optionIds, item = M, seller = S) => as(
  db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
  [seller, JSON.stringify([{ menu_item_id: item, quantity: 2, option_ids: optionIds }]), 'Moda Cad. No:1'],
);
const placeFail = (optionIds, item = M, seller = S) => failure(
  db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
  [seller, JSON.stringify([{ menu_item_id: item, quantity: 2, option_ids: optionIds }]), 'Moda Cad. No:1'],
);
const options = async () => {
  const { rows } = await db.query(`
    SELECT o.id, o.label, o.is_available, g.id AS group_id, g.title FROM public.menu_options o
      JOIN public.menu_option_groups g ON g.id = o.group_id WHERE g.menu_item_id = '${M}'`);
  return Object.fromEntries(rows.map(r => [r.label, r]));
};

const GROUPS = [
  { id: null, title: 'İçecek', min_select: 1, max_select: 1, options: [
    { id: null, label: 'Kola', price_cents: 0, is_available: true },
    { id: null, label: 'Ayran', price_cents: 1000, is_available: true },
  ] },
  { id: null, title: 'Sos', min_select: 0, max_select: 2, options: [
    { id: null, label: 'Ketçap', price_cents: 500, is_available: true },
    { id: null, label: 'Mayonez', price_cents: 500, is_available: true },
    { id: null, label: 'Acı', price_cents: 500, is_available: true },
  ] },
];

before(async () => {
  db = await createDb();
  await allowManyDoorOrders(db);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${U.buyer}'),('${U.seller}'),('${U.other}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES
      ('${U.buyer}','Alıcı','buyer',true),('${U.seller}','Satıcı','seller',true),('${U.other}','Öteki','seller',true);
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active, city, district) VALUES
      ('${S}','${U.seller}','Mutfak','restaurant',true,'İstanbul','Kadıköy'),
      ('${S2}','${U.other}','Öteki','restaurant',true,'İstanbul','Kadıköy');
    UPDATE public.sellers SET is_active = true;
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES
      ('${M}','${S}','Burger',30000),('${M2}','${S2}','Pizza',20000);
  `);
});

describe('satıcı grupları yazar', () => {
  test('sahibi yazar, müşteri okur', async () => {
    await save(U.seller, M, GROUPS);
    const { rows } = await as(db, U.buyer, `SELECT title, min_select, max_select FROM public.menu_option_groups WHERE menu_item_id='${M}' ORDER BY sort_order`);
    assert.deepEqual(rows.map(r => r.title), ['İçecek', 'Sos']);
    assert.equal(rows[0].min_select, 1);
  });
  test('başkası ürüne yazamaz', async () => {
    const f = await saveFail(U.other, M, GROUPS);
    assert.equal(f?.code, '42501');
    assert.equal((await saveFail(U.buyer, M, GROUPS))?.code, '42501');
  });
  test('tablolara doğrudan yazılamaz', async () => {
    assert.ok(await failure(db, U.seller, `INSERT INTO public.menu_option_groups (menu_item_id, title) VALUES ('${M}','Doğrudan')`));
    const o = await options();
    await as(db, U.seller, `UPDATE public.menu_options SET price_cents = 0 WHERE id = '${o.Ayran.id}'`).catch(() => undefined);
    const { rows } = await db.query(`SELECT price_cents FROM public.menu_options WHERE id = '${o.Ayran.id}'`);
    assert.equal(rows[0].price_cents, 1000);
  });
  test('geçersiz kurallar reddedilir', async () => {
    const one = over => [{ ...GROUPS[0], ...over }];
    for (const bad of [
      one({ title: ' ' }),
      one({ options: [] }),
      one({ min_select: 3, max_select: null }),
      one({ min_select: 2, max_select: 1 }),
      one({ max_select: 0, min_select: 0 }),
      one({ options: [{ id: null, label: 'x', price_cents: -1 }] }),
      one({ options: [{ id: null, label: ' ', price_cents: 0 }] }),
    ]) {
      assert.equal((await saveFail(U.seller, M, bad))?.code, '22023', JSON.stringify(bad));
    }
    assert.equal(Object.keys(await options()).length, 5, 'hata eski kaydı bozmaz');
  });
  test('başka ürünün kimliği kullanılamaz', async () => {
    const o = await options();
    await save(U.other, M2, [{ ...GROUPS[0] }]);
    const f = await saveFail(U.other, M2, [{ ...GROUPS[0], id: o.Kola.group_id }]);
    assert.equal(f?.code, '42501');
  });
  test('kimlik korunur, listede olmayan silinir', async () => {
    const before = await options();
    await save(U.seller, M, [
      { id: before.Kola.group_id, title: 'İçeceğin', min_select: 1, max_select: 1, options: [
        { id: before.Kola.id, label: 'Kola', price_cents: 0, is_available: true },
        { id: before.Ayran.id, label: 'Ayran', price_cents: 1000, is_available: true },
      ] },
      { id: before.Ketçap.group_id, title: 'Sos', min_select: 0, max_select: 2, options: [
        { id: before.Ketçap.id, label: 'Ketçap', price_cents: 500, is_available: true },
        { id: before.Mayonez.id, label: 'Mayonez', price_cents: 500, is_available: true },
        { id: null, label: 'Hardal', price_cents: 500, is_available: true },
      ] },
    ]);
    const after = await options();
    assert.equal(after.Kola.id, before.Kola.id);
    assert.equal(after.Kola.title, 'İçeceğin');
    assert.equal(after['Acı'], undefined);
    assert.ok(after.Hardal);
  });
});

describe('sipariş', () => {
  test('zorunlu seçim yoksa reddedilir', async () => {
    const f = await placeFail([]);
    assert.equal(f?.code, '22023');
    assert.match(f.message, /İçeceğin seçimi eksik/);
  });
  test('tek seçimli grupta iki seçim reddedilir', async () => {
    const o = await options();
    const f = await placeFail([o.Kola.id, o.Ayran.id]);
    assert.match(f?.message ?? '', /en fazla 1/);
  });
  test('sınırı aşan sos reddedilir', async () => {
    const o = await options();
    const f = await placeFail([o.Kola.id, o.Ketçap.id, o.Mayonez.id, o.Hardal.id]);
    assert.match(f?.message ?? '', /en fazla 2/);
  });
  test('fiyat ve başlık sunucuda hesaplanır', async () => {
    const o = await options();
    const { rows } = await place([o.Ayran.id, o.Ketçap.id, o.Mayonez.id]);
    // (30000 + 1000 + 500 + 500) × 2
    assert.equal(rows[0].subtotal_cents, 64000);
    const lines = await as(db, U.buyer, 'SELECT * FROM public.order_items WHERE order_id = $1', [rows[0].id]);
    assert.equal(lines.rows[0].unit_price_cents, 32000);
    assert.equal(lines.rows[0].title_snapshot, 'Burger · İçeceğin: Ayran · Sos: Ketçap, Mayonez');
  });
  test('başka ürünün seçeneği kullanılamaz', async () => {
    const { rows } = await db.query(`SELECT o.id FROM public.menu_options o JOIN public.menu_option_groups g ON g.id=o.group_id WHERE g.menu_item_id='${M2}' LIMIT 1`);
    const o = await options();
    const f = await placeFail([o.Kola.id, rows[0].id]);
    assert.match(f?.message ?? '', /artık yok/);
  });
  test('biten seçenek reddedilir, kalanla sipariş verilir', async () => {
    const o = await options();
    await db.exec(`UPDATE public.menu_options SET is_available = false WHERE id = '${o.Ayran.id}'`);
    assert.match((await placeFail([o.Ayran.id]))?.message ?? '', /artık yok/);
    const { rows } = await place([o.Kola.id]);
    assert.equal(rows[0].subtotal_cents, 60000);
    await db.exec(`UPDATE public.menu_options SET is_available = true WHERE id = '${o.Ayran.id}'`);
  });
  test('grubu olmayan ürün eskisi gibi çalışır', async () => {
    await save(U.other, M2, []);
    const { rows } = await place([], M2, S2);
    assert.equal(rows[0].subtotal_cents, 40000);
  });
});
