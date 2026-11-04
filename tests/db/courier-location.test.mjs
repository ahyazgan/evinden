import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, failure } from './harness.mjs';

const U = {
  buyer: '00000000-0000-0000-0000-0000000000b1',
  other: '00000000-0000-0000-0000-0000000000b2',
  seller: '00000000-0000-0000-0000-0000000000a1',
  rival: '00000000-0000-0000-0000-0000000000a2',
  admin: '00000000-0000-0000-0000-0000000000ad',
};
const S = '10000000-0000-0000-0000-000000000001';
const R = '10000000-0000-0000-0000-000000000002';
const M = '20000000-0000-0000-0000-000000000001';

let db;

const send = (uid, order, lat = 40.99, lng = 29.03) =>
  as(db, uid, 'SELECT public.update_courier_location($1,$2,$3) AS written', [order, lat, lng]);
const sendFails = (uid, order, lat = 40.99, lng = 29.03) =>
  failure(db, uid, 'SELECT public.update_courier_location($1,$2,$3)', [order, lat, lng]);
const read = (uid, order) =>
  as(db, uid, 'SELECT lat, lng, updated_at FROM public.order_courier_locations WHERE order_id=$1', [order]);
const stored = (order) =>
  db.query('SELECT lat, lng FROM public.order_courier_locations WHERE order_id=$1', [order]);
const setStatus = (order, status) =>
  as(db, U.seller, 'UPDATE public.orders SET status=$1 WHERE id=$2', [status, order]);

async function placeOrder() {
  const { rows } = await as(
    db, U.buyer,
    'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
    [S, JSON.stringify([{ menu_item_id: M, quantity: 1 }]), 'Moda Cad. No:1'],
  );
  return rows[0].id;
}

async function onTheRoad() {
  const id = await placeOrder();
  for (const st of ['accepted', 'preparing', 'ready', 'out_for_delivery']) await setStatus(id, st);
  return id;
}

/** Sonraki yazımın yok sayılmaması için son yazımı geçmişe alır. */
const age = (order) =>
  db.exec(`UPDATE public.order_courier_locations SET updated_at = now() - interval '6 seconds' WHERE order_id='${order}'`);

before(async () => {
  db = await createDb();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${U.buyer}'),('${U.other}'),('${U.seller}'),('${U.rival}'),('${U.admin}');
    INSERT INTO public.users (id, name, role, is_approved, phone) VALUES
      ('${U.buyer}','Alıcı','buyer',true,'+905551112233'),('${U.other}','Başka','buyer',true,NULL),
      ('${U.seller}','Satıcı','seller',true,NULL),('${U.rival}','Rakip','seller',true,NULL),
      ('${U.admin}','Yönetici','admin',true,NULL);
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active, city, district) VALUES
      ('${S}','${U.seller}','Lokanta','restaurant',true,'İstanbul','Kadıköy'),
      ('${R}','${U.rival}','Rakip','restaurant',true,'İstanbul','Kadıköy');
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${M}','${S}','Mantı',50000);
  `);
});

describe('konumu kim yazabilir', () => {
  test('sipariş sahibi satıcı yazar', async () => {
    const id = await onTheRoad();
    const { rows } = await send(U.seller, id);
    assert.equal(rows[0].written, true);
    const row = await stored(id);
    assert.equal(Number(row.rows[0].lat), 40.99);
    assert.equal(Number(row.rows[0].lng), 29.03);
  });

  test('başka satıcı, müşteri ve yabancı yazamaz', async () => {
    const id = await onTheRoad();
    for (const uid of [U.rival, U.buyer, U.other, U.admin]) {
      const f = await sendFails(uid, id);
      assert.equal(f?.code, '42501', uid);
    }
    assert.equal((await stored(id)).rows.length, 0);
  });

  test('olmayan sipariş sahibini ele vermez', async () => {
    const f = await sendFails(U.seller, '30000000-0000-0000-0000-000000000099');
    assert.equal(f?.code, '42501');
  });

  test('tabloya doğrudan yazılamaz', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    for (const uid of [U.seller, U.buyer, U.admin]) {
      const ins = await failure(db, uid, `INSERT INTO public.order_courier_locations (order_id, lat, lng) VALUES ('${id}', 1, 1)`);
      assert.equal(ins?.code, '42501', uid);
      const upd = await failure(db, uid, `UPDATE public.order_courier_locations SET lat = 1 WHERE order_id='${id}'`);
      assert.equal(upd?.code, '42501', uid);
      const del = await failure(db, uid, `DELETE FROM public.order_courier_locations WHERE order_id='${id}'`);
      assert.equal(del?.code, '42501', uid);
    }
  });
});

describe('konum ne zaman yazılır', () => {
  test('yalnızca sipariş yoldayken', async () => {
    const id = await placeOrder();
    for (const st of [null, 'accepted', 'preparing', 'ready']) {
      if (st) await setStatus(id, st);
      const f = await sendFails(U.seller, id);
      assert.equal(f?.code, '55000', st ?? 'pending');
      assert.match(f.message, /paylaşabilirsin/);
    }
    await setStatus(id, 'out_for_delivery');
    assert.equal((await send(U.seller, id)).rows[0].written, true);
    await setStatus(id, 'delivered');
    assert.equal((await sendFails(U.seller, id))?.code, '55000');
  });

  test('geçersiz koordinat reddedilir', async () => {
    const id = await onTheRoad();
    assert.equal((await sendFails(U.seller, id, 91, 29))?.code, '22023');
    assert.equal((await sendFails(U.seller, id, 41, 181))?.code, '22023');
    assert.equal((await sendFails(U.seller, id, null, 29))?.code, '22023');
    assert.equal((await stored(id)).rows.length, 0);
  });

  test('5 saniyeden sık yazım yok sayılır, sonra yazılır', async () => {
    const id = await onTheRoad();
    assert.equal((await send(U.seller, id, 41, 29)).rows[0].written, true);
    assert.equal((await send(U.seller, id, 42, 30)).rows[0].written, false);
    assert.equal(Number((await stored(id)).rows[0].lat), 41);
    await age(id);
    assert.equal((await send(U.seller, id, 42, 30)).rows[0].written, true);
    assert.equal(Number((await stored(id)).rows[0].lat), 42);
  });

  test('geçersiz yön konumu engellemez, boş yazılır', async () => {
    const id = await onTheRoad();
    await as(db, U.seller, 'SELECT public.update_courier_location($1,$2,$3,$4)', [id, 41, 29, -1]);
    assert.equal((await db.query('SELECT heading FROM public.order_courier_locations WHERE order_id=$1', [id])).rows[0].heading, null);
  });
});

describe('konumu kim okur', () => {
  test('siparişin müşterisi, satıcısı ve yönetici okur', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    for (const uid of [U.buyer, U.seller, U.admin]) {
      assert.equal((await read(uid, id)).rows.length, 1, uid);
    }
  });

  test('başka müşteri, başka satıcı ve giriş yapmamış okuyamaz', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    for (const uid of [U.other, U.rival]) {
      assert.equal((await read(uid, id)).rows.length, 0, uid);
    }
    await db.exec('SET ROLE anon');
    try {
      await assert.rejects(db.query('SELECT 1 FROM public.order_courier_locations'), { code: '42501' });
    } finally {
      await db.exec('RESET ROLE');
    }
  });
});

describe('konum saklanmaz', () => {
  test('teslim edilince silinir', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    await setStatus(id, 'delivered');
    assert.equal((await stored(id)).rows.length, 0);
  });

  test('iptal edilince silinir', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    await setStatus(id, 'cancelled');
    assert.equal((await stored(id)).rows.length, 0);
  });

  test('yoldayken başka bir alan değişince silinmez', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    await as(db, U.seller, `UPDATE public.orders SET updated_at = now() WHERE id='${id}'`);
    assert.equal((await stored(id)).rows.length, 1);
  });

  test('durdurunca silinir, yalnızca sahibi durdurur', async () => {
    const id = await onTheRoad();
    await send(U.seller, id);
    for (const uid of [U.rival, U.buyer]) {
      const f = await failure(db, uid, 'SELECT public.stop_courier_location($1)', [id]);
      assert.equal(f?.code, '42501', uid);
    }
    assert.equal((await stored(id)).rows.length, 1);
    await as(db, U.seller, 'SELECT public.stop_courier_location($1)', [id]);
    assert.equal((await stored(id)).rows.length, 0);
    // Paylaşım yeniden başlatılabilir.
    assert.equal((await send(U.seller, id)).rows[0].written, true);
  });
});

test('yoldaki siparişte satıcı müşterinin telefonunu görür, teslimden sonra göremez', async () => {
  const id = await onTheRoad();
  const contact = async () => (await as(db, U.seller, 'SELECT * FROM public.get_seller_order_contacts($1)', [S]))
    .rows.find((r) => r.order_id === id);
  assert.equal((await contact()).customer_phone, '+905551112233');
  await setStatus(id, 'delivered');
  assert.equal((await contact()).customer_phone, null);
});
