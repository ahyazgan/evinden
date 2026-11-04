import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allowManyDoorOrders, createDb, as, failure } from './harness.mjs';

const U = {
  buyer: '00000000-0000-0000-0000-0000000000b1',
  buyer2: '00000000-0000-0000-0000-0000000000b2',
  sellerA: '00000000-0000-0000-0000-0000000000a1',
  sellerB: '00000000-0000-0000-0000-0000000000a2',
  admin: '00000000-0000-0000-0000-0000000000ad',
  stranger: '00000000-0000-0000-0000-0000000000e1',
};
const S = {
  A: '10000000-0000-0000-0000-000000000001',
  B: '10000000-0000-0000-0000-000000000002',
};
const M = {
  kebap: '20000000-0000-0000-0000-000000000001', // 10000 kuruş
  ayran: '20000000-0000-0000-0000-000000000002', // 2000 kuruş
  limited: '20000000-0000-0000-0000-000000000003', // günlük limit 3
  other: '20000000-0000-0000-0000-000000000004', // B satıcısının ürünü
};
const V = { buyuk: '30000000-0000-0000-0000-000000000001' }; // +3000
const X = {
  sos: '40000000-0000-0000-0000-000000000001', // +500
  peynir: '40000000-0000-0000-0000-000000000002', // +700
  kapali: '40000000-0000-0000-0000-000000000003', // is_available=false
};
const P = { aile: '50000000-0000-0000-0000-000000000001' }; // 25000

let db;

before(async () => {
  db = await createDb();
  // 035: aynı müşteriyle çok sayıda tamamlanmamış sipariş açılıyor, kapıda ödeme sınırı bu dosyanın konusu değil.
  await allowManyDoorOrders(db);
  // Tohum veri: uid NULL (service role) olduğundan korumalar atlanır.
  await db.exec(`
    INSERT INTO auth.users (id) VALUES
      ('${U.buyer}'),('${U.buyer2}'),('${U.sellerA}'),('${U.sellerB}'),('${U.admin}'),('${U.stranger}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES
      ('${U.buyer}','Alıcı 1','buyer',true),
      ('${U.buyer2}','Alıcı 2','buyer',true),
      ('${U.sellerA}','Satıcı A','seller',true),
      ('${U.sellerB}','Satıcı B','seller',true),
      ('${U.admin}','Yönetici','admin',true),
      ('${U.stranger}','Yabancı','buyer',true);
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES
      ('${S.A}','${U.sellerA}','Kebapçı A',true),
      ('${S.B}','${U.sellerB}','Kebapçı B',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents, daily_limit) VALUES
      ('${M.kebap}','${S.A}','Adana Kebap',10000,0),
      ('${M.ayran}','${S.A}','Ayran',2000,0),
      ('${M.limited}','${S.A}','Günün Yemeği',5000,3),
      ('${M.other}','${S.B}','Lahmacun',3000,0);
    INSERT INTO public.menu_item_variants (id, menu_item_id, label, price_diff_cents) VALUES
      ('${V.buyuk}','${M.kebap}','Büyük',3000);
    INSERT INTO public.menu_item_extras (id, menu_item_id, label, price_cents, is_available) VALUES
      ('${X.sos}','${M.kebap}','Acı Sos',500,true),
      ('${X.peynir}','${M.kebap}','Peynir',700,true),
      ('${X.kapali}','${M.kebap}','Tükendi',100,false);
    INSERT INTO public.menu_item_portions (id, menu_item_id, label, price_cents) VALUES
      ('${P.aile}','${M.kebap}','Aile Boyu',25000);
    INSERT INTO public.coupons (code, discount_type, discount_value, min_order_cents, max_uses) VALUES
      ('YUZDE10','percent',10,5000,100),
      ('ILK50','fixed',5000,10000,100),
      ('KARGOBEDAVA','free_delivery',0,0,100);
    INSERT INTO public.coupons (code, discount_type, discount_value, expires_at) VALUES
      ('ESKI','percent',50, now() - interval '1 day');
  `);
});

const items = (...l) => JSON.stringify(l);
const order = (uid, seller, itemsJson, extra = {}) =>
  as(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,$4,$5,$6)', [
    seller,
    itemsJson,
    extra.address ?? 'Çekmeköy Mah. Test Sok. No:1',
    extra.notes ?? null,
    extra.payment ?? 'cash',
    extra.coupon ?? null,
  ]);

describe('Sipariş fiyatlandırma (place_order)', () => {
  test('doğrudan orders INSERT reddedilir (fiyat manipülasyonu)', async () => {
    const err = await failure(
      db, U.buyer,
      `INSERT INTO public.orders (customer_id, seller_id, subtotal_cents, total_cents)
       VALUES ('${U.buyer}','${S.A}', 1, 1)`,
    );
    assert.ok(err, 'insert başarılı olmamalıydı');
    assert.equal(err.code, '42501');
  });

  test('doğrudan order_items INSERT reddedilir', async () => {
    const o = await order(U.buyer, S.A, items({ menu_item_id: M.ayran, quantity: 1 }));
    const err = await failure(
      db, U.buyer,
      `INSERT INTO public.order_items (order_id, title_snapshot, unit_price_cents, quantity, line_total_cents)
       VALUES ('${o.rows[0].id}','Sahte',1,1,1)`,
    );
    assert.equal(err?.code, '42501');
  });

  test('fiyat sunucuda hesaplanır: 2×kebap = 20000, ücretsiz teslimat, komisyon %8', async () => {
    const r = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 2 }))).rows[0];
    assert.equal(r.subtotal_cents, 20000);
    assert.equal(r.delivery_fee_cents, 0);
    assert.equal(r.total_cents, 20000);
    assert.equal(Number(r.commission_rate), 8);
    assert.equal(r.commission_cents, 1600);
    assert.equal(r.status, 'pending');
    assert.equal(r.payment_status, 'pending');
  });

  test('eşik altında teslimat ücreti eklenir', async () => {
    const r = (await order(U.buyer, S.A, items({ menu_item_id: M.ayran, quantity: 1 }))).rows[0];
    assert.equal(r.subtotal_cents, 2000);
    assert.equal(r.delivery_fee_cents, 1500);
    assert.equal(r.total_cents, 3500);
    assert.equal(r.commission_cents, 160); // komisyon teslimat ücretinden alınmaz
  });

  test('varyant + ekstra + kalem satırları doğru yazılır', async () => {
    const r = (await order(U.buyer, S.A, items({
      menu_item_id: M.kebap, quantity: 2, variant_id: V.buyuk, extra_ids: [X.sos, X.peynir],
    }))).rows[0];
    // (10000 + 3000 + 500 + 700) × 2 = 28400
    assert.equal(r.subtotal_cents, 28400);
    const lines = await as(db, U.buyer, 'SELECT * FROM public.order_items WHERE order_id = $1', [r.id]);
    assert.equal(lines.rows.length, 1);
    assert.equal(lines.rows[0].unit_price_cents, 14200);
    assert.equal(lines.rows[0].line_total_cents, 28400);
    assert.match(lines.rows[0].title_snapshot, /Büyük/);
    assert.match(lines.rows[0].title_snapshot, /Acı Sos/);
  });

  test('porsiyon fiyatı menü fiyatının yerine geçer', async () => {
    const r = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1, portion_id: P.aile }))).rows[0];
    assert.equal(r.subtotal_cents, 25000);
  });

  test('geçersiz girdiler reddedilir', async () => {
    const cases = [
      ['başka satıcının ürünü', S.A, items({ menu_item_id: M.other, quantity: 1 })],
      ['adet 0', S.A, items({ menu_item_id: M.ayran, quantity: 0 })],
      ['adet 51', S.A, items({ menu_item_id: M.ayran, quantity: 51 })],
      ['negatif adet', S.A, items({ menu_item_id: M.ayran, quantity: -2 })],
      ['kapalı ekstra', S.A, items({ menu_item_id: M.kebap, quantity: 1, extra_ids: [X.kapali] })],
      ['başka ürünün varyantı', S.A, items({ menu_item_id: M.ayran, quantity: 1, variant_id: V.buyuk })],
      ['boş sepet', S.A, '[]'],
      ['sepet dizi değil', S.A, '{"a":1}'],
    ];
    for (const [ad, seller, json] of cases) {
      const err = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)', [
        seller, json, 'Çekmeköy Mah. Test Sok. No:1',
      ]);
      assert.ok(err, `${ad}: reddedilmeliydi`);
    }
  });

  test('geçersiz ödeme yöntemi ve adres reddedilir', async () => {
    const online = await failure(db, U.buyer,
      'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4)',
      [S.A, items({ menu_item_id: M.ayran, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1', 'online']);
    assert.ok(online);
    const adres = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
      [S.A, items({ menu_item_id: M.ayran, quantity: 1 }), 'x']);
    assert.ok(adres);
  });

  test('giriş yapmamış kullanıcı sipariş veremez, satıcı kendi mağazasından alamaz', async () => {
    const anon = await failure(db, null, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
      [S.A, items({ menu_item_id: M.ayran, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1']);
    assert.ok(anon);
    const kendi = await failure(db, U.sellerA, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
      [S.A, items({ menu_item_id: M.ayran, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1']);
    assert.ok(kendi);
  });

  test('pasif satıcıdan sipariş verilemez', async () => {
    await db.exec(`UPDATE public.sellers SET is_active = false WHERE id = '${S.B}'`);
    const err = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
      [S.B, items({ menu_item_id: M.other, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1']);
    await db.exec(`UPDATE public.sellers SET is_active = true WHERE id = '${S.B}'`);
    assert.ok(err);
  });

  test('günlük stok sınırı uygulanır ve iptalde geri verilir', async () => {
    const a = (await order(U.buyer, S.A, items({ menu_item_id: M.limited, quantity: 2 }))).rows[0];
    const fazla = await failure(db, U.buyer2, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
      [S.A, items({ menu_item_id: M.limited, quantity: 2 }), 'Çekmeköy Mah. Test Sok. No:1']);
    assert.ok(fazla, 'limit aşıldığında reddedilmeli');
    assert.match(fazla.message, /Stok/);

    await as(db, U.buyer, `UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [a.id]);
    const tekrar = await order(U.buyer2, S.A, items({ menu_item_id: M.limited, quantity: 2 }));
    assert.equal(tekrar.rows.length, 1, 'iptalden sonra stok geri gelmeli');
  });

  test('kupon: yüzde, sabit, kargo bedava; süresi dolan ve minimum altı reddedilir', async () => {
    const yuzde = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1 }), { coupon: 'yuzde10' })).rows[0];
    assert.equal(yuzde.discount_cents, 1000);
    assert.equal(yuzde.total_cents, 10000 + 1500 - 1000);

    const sabit = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1 }), { coupon: 'ILK50' })).rows[0];
    assert.equal(sabit.discount_cents, 5000);

    const kargo = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1 }), { coupon: 'KARGOBEDAVA' })).rows[0];
    assert.equal(kargo.delivery_fee_cents, 0);
    assert.equal(kargo.total_cents, 10000);

    const eski = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [S.A, items({ menu_item_id: M.kebap, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1', 'cash', 'ESKI']);
    assert.ok(eski);
    const altinda = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [S.A, items({ menu_item_id: M.ayran, quantity: 1 }), 'Çekmeköy Mah. Test Sok. No:1', 'cash', 'YUZDE10']);
    assert.ok(altinda);

    const kullanim = await db.query(`SELECT used_count FROM public.coupons WHERE code = 'YUZDE10'`);
    assert.equal(kullanim.rows[0].used_count, 1);
  });

  test('yüzde kuponunun tavanı uygulanır (EVINDEN20: %20, en çok ₺50)', async () => {
    const r = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 10 }), { coupon: 'EVINDEN20' })).rows[0];
    assert.equal(r.subtotal_cents, 100000);
    assert.equal(r.discount_cents, 5000);
    assert.equal(r.total_cents, 95000);
  });

  test('komisyon oranı app_config üzerinden değişir', async () => {
    await db.exec(`UPDATE public.app_config SET value = jsonb_set(value, '{commission_rate_percent}', '3') WHERE key = 'order_pricing'`);
    const r = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 2 }))).rows[0];
    await db.exec(`UPDATE public.app_config SET value = jsonb_set(value, '{commission_rate_percent}', '8') WHERE key = 'order_pricing'`);
    assert.equal(r.commission_cents, 600);
  });
});

describe('Stok iadesi ve kupon hakları', () => {
  const satir = { menu_item_id: M.kebap, quantity: 1 };
  const kupon = (code, kisiBasi, toplam = null) => db.exec(`
    INSERT INTO public.coupons (code, discount_type, discount_value, max_uses, max_uses_per_user)
    VALUES ('${code}','percent',10,${toplam ?? 'NULL'},${kisiBasi ?? 'NULL'})`);
  const sayac = async (code) =>
    (await db.query(`SELECT used_count FROM public.coupons WHERE code = '${code}'`)).rows[0].used_count;
  const iptal = (uid, id) => as(db, uid, `UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]);

  test('aynı ürün farklı varyantlarla iki satırdaysa iptalde tüm adet geri verilir', async () => {
    const urun = '20000000-0000-0000-0000-000000000011';
    const kucuk = '30000000-0000-0000-0000-000000000011';
    const buyuk = '30000000-0000-0000-0000-000000000012';
    await db.exec(`
      INSERT INTO public.menu_items (id, seller_id, title, price_cents, daily_limit) VALUES ('${urun}','${S.A}','Mantı',5000,10);
      INSERT INTO public.menu_item_variants (id, menu_item_id, label, price_diff_cents) VALUES
        ('${kucuk}','${urun}','Küçük',0),('${buyuk}','${urun}','Büyük',1000);
    `);
    const satilan = async () =>
      (await db.query(`SELECT sold_today FROM public.menu_items WHERE id = '${urun}'`)).rows[0].sold_today;

    const o = (await order(U.buyer, S.A, items(
      { menu_item_id: urun, quantity: 2, variant_id: kucuk },
      { menu_item_id: urun, quantity: 3, variant_id: buyuk },
    ))).rows[0];
    assert.equal(await satilan(), 5);

    await iptal(U.buyer, o.id);
    assert.equal(await satilan(), 0);
  });

  test('kişi başı hak dolunca aynı kullanıcı reddedilir, başkası kullanabilir', async () => {
    await kupon('KISI1', 1);
    const ilk = (await order(U.buyer, S.A, items(satir), { coupon: 'KISI1' })).rows[0];
    assert.equal(ilk.discount_cents, 1000);

    const ikinci = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [S.A, items(satir), 'Çekmeköy Mah. Test Sok. No:1', 'cash', 'KISI1']);
    assert.match(ikinci?.message ?? '', /hakkınız doldu/);
    assert.equal(await sayac('KISI1'), 1, 'reddedilen sipariş sayacı artırmamalı');

    const baskasi = (await order(U.buyer2, S.A, items(satir), { coupon: 'KISI1' })).rows[0];
    assert.equal(baskasi.discount_cents, 1000);
  });

  test('kişi başı 2 hakta üçüncü kullanım reddedilir; boş hak sınırsızdır', async () => {
    await kupon('KISI2', 2);
    await order(U.buyer, S.A, items(satir), { coupon: 'KISI2' });
    await order(U.buyer, S.A, items(satir), { coupon: 'KISI2' });
    const ucuncu = await failure(db, U.buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [S.A, items(satir), 'Çekmeköy Mah. Test Sok. No:1', 'cash', 'KISI2']);
    assert.ok(ucuncu);

    await kupon('SINIRSIZ', null);
    for (let i = 0; i < 3; i++) {
      const r = (await order(U.buyer, S.A, items(satir), { coupon: 'SINIRSIZ' })).rows[0];
      assert.equal(r.discount_cents, 1000);
    }
  });

  test('iptal hakkı ve toplam sayacı geri verir; tek kullanımlık kupon yakılamaz', async () => {
    await kupon('TEKSEFER', 1, 1);
    const o = (await order(U.buyer, S.A, items(satir), { coupon: 'TEKSEFER' })).rows[0];
    assert.equal(await sayac('TEKSEFER'), 1);

    const dolu = await failure(db, U.buyer2, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
      [S.A, items(satir), 'Çekmeköy Mah. Test Sok. No:1', 'cash', 'TEKSEFER']);
    assert.ok(dolu, 'hak doluyken başkası kullanamamalı');

    await iptal(U.buyer, o.id);
    assert.equal(await sayac('TEKSEFER'), 0);

    const b = (await order(U.buyer2, S.A, items(satir), { coupon: 'TEKSEFER' })).rows[0];
    assert.equal(b.discount_cents, 1000);
  });

  test('kuponsuz siparişin iptali sayaçlara dokunmaz, satıcı iptali de hakkı geri verir', async () => {
    await kupon('SATICI', 1);
    const kuponsuz = (await order(U.buyer, S.A, items(satir))).rows[0];
    const kuponlu = (await order(U.buyer, S.A, items(satir), { coupon: 'SATICI' })).rows[0];

    await iptal(U.buyer, kuponsuz.id);
    assert.equal(await sayac('SATICI'), 1);

    await as(db, U.sellerA, `UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [kuponlu.id]);
    assert.equal(await sayac('SATICI'), 0);
    const tekrar = (await order(U.buyer, S.A, items(satir), { coupon: 'SATICI' })).rows[0];
    assert.equal(tekrar.discount_cents, 1000);
  });

  test('kullanım kayıtları: yalnızca kendi kayıtların görünür, doğrudan yazılamaz', async () => {
    await kupon('KAYIT', 1);
    const o = (await order(U.buyer, S.A, items(satir), { coupon: 'KAYIT' })).rows[0];
    const id = (await db.query(`SELECT id FROM public.coupons WHERE code = 'KAYIT'`)).rows[0].id;
    const say = `SELECT count(*)::int AS n FROM public.coupon_redemptions WHERE coupon_id = '${id}'`;

    assert.equal((await as(db, U.buyer, say)).rows[0].n, 1);
    assert.equal((await as(db, U.buyer2, say)).rows[0].n, 0);

    const sil = await failure(db, U.buyer, `DELETE FROM public.coupon_redemptions WHERE order_id = '${o.id}'`);
    assert.equal(sil?.code, '42501', 'kullanıcı hakkını kendi geri alamamalı');
    const ekle = await failure(db, U.buyer2, `INSERT INTO public.coupon_redemptions (coupon_id, user_id, order_id)
      VALUES ('${id}','${U.buyer2}','${o.id}')`);
    assert.equal(ekle?.code, '42501');
  });

  test('tohum kuponların kişi başı hakları ayarlıdır', async () => {
    const r = await db.query(`SELECT code, max_uses_per_user AS hak FROM public.coupons
      WHERE code IN ('EVINDEN20','LEZZET10','TATLI15','KAHVALTI25','UCRETSIZ') ORDER BY code`);
    assert.deepEqual(r.rows.map((x) => [x.code, x.hak]), [
      ['EVINDEN20', 1], ['KAHVALTI25', 1], ['LEZZET10', 3], ['TATLI15', 2], ['UCRETSIZ', null],
    ]);
  });
});

describe('Tutar onayı, açıklamalar ve tek yorum', () => {
  const ADRES = 'Çekmeköy Mah. Test Sok. No:1';
  const beklenen = (uid, itemsJson, tutar, coupon = null) =>
    as(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5,$6)', [S.A, itemsJson, ADRES, 'cash', coupon, tutar]);
  const teslimEt = async (uid) => {
    const o = (await order(uid, S.A, items({ menu_item_id: M.kebap, quantity: 1 }))).rows[0];
    for (const st of ['accepted', 'preparing', 'ready', 'delivered']) {
      await as(db, U.sellerA, `UPDATE public.orders SET status = '${st}' WHERE id = $1`, [o.id]);
    }
    return o;
  };

  test('beklenen tutar tutuyorsa sipariş açılır', async () => {
    const o = (await beklenen(U.buyer, items({ menu_item_id: M.kebap, quantity: 1 }), 11500)).rows[0];
    assert.equal(o.total_cents, 11500);
  });

  test('tutar farklıysa sipariş açılmaz, yeni tutar döner, stok ve kupon tüketilmez', async () => {
    const urun = '20000000-0000-0000-0000-000000000021';
    await db.exec(`
      INSERT INTO public.menu_items (id, seller_id, title, price_cents, daily_limit) VALUES ('${urun}','${S.A}','Dolma',10000,5);
      INSERT INTO public.coupons (code, discount_type, discount_value) VALUES ('ONAY','percent',10);
    `);
    const say = () => db.query(`SELECT count(*)::int AS n FROM public.orders WHERE customer_id = '${U.buyer2}'`);
    const once = (await say()).rows[0].n;

    let err;
    try {
      await beklenen(U.buyer2, items({ menu_item_id: urun, quantity: 1 }), 11500, 'ONAY');
    } catch (e) { err = e; }
    assert.equal(err?.code, 'EVN01');
    assert.equal(err?.detail, '10500');

    assert.equal((await say()).rows[0].n, once);
    const m = await db.query(`SELECT sold_today FROM public.menu_items WHERE id = '${urun}'`);
    assert.equal(m.rows[0].sold_today, 0);
    const c = await db.query(`SELECT used_count FROM public.coupons WHERE code = 'ONAY'`);
    assert.equal(c.rows[0].used_count, 0);

    const o = (await beklenen(U.buyer2, items({ menu_item_id: urun, quantity: 1 }), 10500, 'ONAY')).rows[0];
    assert.equal(o.total_cents, 10500);
  });

  test('place_order tek imzayla kalır', async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'place_order'`);
    assert.equal(r.rows[0].n, 1);
  });

  test('satıcı müşterinin iade nedenini değiştiremez, müşteri de sonradan değiştiremez', async () => {
    const o = await teslimEt(U.buyer);
    await as(db, U.buyer, `UPDATE public.orders SET refund_status = 'requested', refund_reason = 'Soğuktu' WHERE id = $1`, [o.id]);

    const satici = await failure(db, U.sellerA, `UPDATE public.orders SET refund_reason = 'Yalan' WHERE id = '${o.id}'`);
    assert.equal(satici?.code, '42501');
    const musteri = await failure(db, U.buyer, `UPDATE public.orders SET refund_reason = 'Başka' WHERE id = '${o.id}'`);
    assert.equal(musteri?.code, '42501');

    const r = await db.query(`SELECT refund_reason FROM public.orders WHERE id = '${o.id}'`);
    assert.equal(r.rows[0].refund_reason, 'Soğuktu');
  });

  test('iptal nedeni iptalle birlikte yazılır, sonradan değiştirilemez', async () => {
    const o = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1 }))).rows[0];
    const once = await failure(db, U.buyer, `UPDATE public.orders SET cancel_reason = 'Erken' WHERE id = '${o.id}'`);
    assert.equal(once?.code, '42501');

    await as(db, U.buyer, `UPDATE public.orders SET status = 'cancelled', cancel_reason = 'Vazgeçtim' WHERE id = $1`, [o.id]);
    const sonra = await failure(db, U.buyer, `UPDATE public.orders SET cancel_reason = 'Başka' WHERE id = '${o.id}'`);
    assert.equal(sonra?.code, '42501');
    const r = await db.query(`SELECT cancel_reason FROM public.orders WHERE id = '${o.id}'`);
    assert.equal(r.rows[0].cancel_reason, 'Vazgeçtim');
  });

  test('korumaları atlayan yazımda bile bir siparişe ikinci yorum eklenemez', async () => {
    const o = await teslimEt(U.buyer);
    const ekle = `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating) VALUES ('${o.id}','${S.A}','${U.buyer}',5)`;
    await as(db, null, ekle);
    const ikinci = await failure(db, null, ekle);
    assert.equal(ikinci?.code, '23505');
    // Sonraki testler satıcı puanını sıfırdan hesaplıyor.
    await as(db, null, `DELETE FROM public.reviews WHERE order_id = '${o.id}'`);
  });
});

describe('Rol ve onay yükseltme', () => {
  test('alıcı kendi rolünü satıcı/admin yapamaz', async () => {
    for (const role of ['seller', 'admin']) {
      const err = await failure(db, U.stranger, `UPDATE public.users SET role = '${role}' WHERE id = '${U.stranger}'`);
      assert.equal(err?.code, '42501', `${role} reddedilmeliydi`);
    }
  });

  test('kullanıcı kendini onaylayamaz (approveSellerDemo açığı)', async () => {
    await db.exec(`UPDATE public.users SET is_approved = false WHERE id = '${U.stranger}'`);
    const err = await failure(db, U.stranger,
      `UPDATE public.users SET role = 'seller', is_approved = true WHERE id = '${U.stranger}'`);
    await db.exec(`UPDATE public.users SET is_approved = true WHERE id = '${U.stranger}'`);
    assert.equal(err?.code, '42501');
  });

  test('ad ve avatar güncellenebilir', async () => {
    const r = await as(db, U.stranger, `UPDATE public.users SET name = 'Yeni Ad' WHERE id = '${U.stranger}' RETURNING name`);
    assert.equal(r.rows[0].name, 'Yeni Ad');
  });

  test('kayıtta admin rolü verilemez; satıcı onaysız başlar', async () => {
    await db.exec(`INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000f1'),('00000000-0000-0000-0000-0000000000f2')`);
    const admin = await failure(db, '00000000-0000-0000-0000-0000000000f1',
      `INSERT INTO public.users (id, name, role, is_approved) VALUES ('00000000-0000-0000-0000-0000000000f1','x','admin',true)`);
    assert.equal(admin?.code, '42501');

    const r = await as(db, '00000000-0000-0000-0000-0000000000f2',
      `INSERT INTO public.users (id, name, role, is_approved) VALUES ('00000000-0000-0000-0000-0000000000f2','y','seller',true) RETURNING is_approved`);
    assert.equal(r.rows[0].is_approved, false);
  });

  test('yönetici rol ve onayı değiştirebilir', async () => {
    const r = await as(db, U.admin,
      `UPDATE public.users SET is_approved = true WHERE id = '00000000-0000-0000-0000-0000000000f2' RETURNING is_approved`);
    assert.equal(r.rows[0].is_approved, true);
  });
});

describe('Satıcı kaydı', () => {
  const NEW = '00000000-0000-0000-0000-0000000000f3';

  test('başvuran satıcı aktif başlamaz, puanını yazamaz', async () => {
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${NEW}'); INSERT INTO public.users (id,name,role,is_approved) VALUES ('${NEW}','Yeni','buyer',true);`);
    const r = await as(db, NEW,
      `INSERT INTO public.sellers (user_id, display_name, is_active, rating_avg, rating_count)
       VALUES ('${NEW}','Sahte Lokanta', true, 5, 999) RETURNING id, is_active, rating_avg, rating_count`);
    assert.equal(r.rows[0].is_active, false);
    assert.equal(Number(r.rows[0].rating_avg), 0);
    assert.equal(r.rows[0].rating_count, 0);

    const self = await failure(db, NEW, `UPDATE public.sellers SET is_active = true WHERE user_id = '${NEW}'`);
    assert.equal(self?.code, '42501');
  });

  test('satıcı kendi puanını değiştiremez', async () => {
    const err = await failure(db, U.sellerA, `UPDATE public.sellers SET rating_avg = 5 WHERE id = '${S.A}'`);
    assert.equal(err?.code, '42501');
  });

  test('satıcı mağaza bilgisini güncelleyebilir; yönetici aktif edebilir', async () => {
    const a = await as(db, U.sellerA, `UPDATE public.sellers SET bio = 'Lezzet' WHERE id = '${S.A}' RETURNING bio`);
    assert.equal(a.rows[0].bio, 'Lezzet');
    const b = await as(db, U.admin, `UPDATE public.sellers SET is_active = true WHERE user_id = '${NEW}' RETURNING is_active`);
    assert.equal(b.rows[0].is_active, true);
  });
});

describe('Sipariş güncelleme kötüye kullanımı', () => {
  let o;
  before(async () => {
    o = (await order(U.buyer, S.A, items({ menu_item_id: M.kebap, quantity: 1 }))).rows[0];
  });
  const upd = (uid, set) => failure(db, uid, `UPDATE public.orders SET ${set} WHERE id = '${o.id}'`);

  test('satıcı tutarı, komisyonu, müşteriyi değiştiremez', async () => {
    for (const set of [
      'total_cents = 1', 'subtotal_cents = 1', 'delivery_fee_cents = 0',
      'commission_cents = 0', 'commission_rate = 0', 'discount_cents = 9999',
      `customer_id = '${U.stranger}'`, `seller_id = '${S.B}'`, `delivery_address = 'Başka yer'`,
    ]) {
      const err = await upd(U.sellerA, set);
      assert.equal(err?.code, '42501', `${set} reddedilmeliydi`);
    }
  });

  test('satıcı durum adımlarını atlayamaz', async () => {
    assert.equal((await upd(U.sellerA, `status = 'delivered'`))?.code, '42501');
    assert.equal((await upd(U.sellerA, `status = 'ready'`))?.code, '42501');
  });

  test('müşteri kendi siparişini kabul edilmiş duruma getiremez veya ödedi işaretleyemez', async () => {
    assert.equal((await upd(U.buyer, `status = 'accepted'`))?.code, '42501');
    assert.equal((await upd(U.buyer, `status = 'delivered'`))?.code, '42501');
    assert.equal((await upd(U.buyer, `payment_status = 'paid'`))?.code, '42501');
    assert.equal((await upd(U.buyer, `refund_status = 'approved'`))?.code, '42501');
  });

  test('teslimden önce iade talebi açılamaz', async () => {
    assert.equal((await upd(U.buyer, `refund_status = 'requested'`))?.code, '42501');
  });

  test('yabancı başkasının siparişini güncelleyemez (RLS: 0 satır)', async () => {
    const r = await as(db, U.stranger, `UPDATE public.orders SET notes = 'hack' WHERE id = $1`, [o.id]);
    assert.equal(r.affectedRows, 0);
    const r2 = await as(db, U.sellerB, `UPDATE public.orders SET status = 'accepted' WHERE id = $1`, [o.id]);
    assert.equal(r2.affectedRows, 0);
  });

  test('normal akış: kabul → hazırlanıyor → hazır → yolda → teslim + ödeme alındı', async () => {
    for (const s of ['accepted', 'preparing', 'ready', 'out_for_delivery']) {
      const r = await as(db, U.sellerA, `UPDATE public.orders SET status = $1 WHERE id = $2`, [s, o.id]);
      assert.equal(r.affectedRows, 1, s);
    }
    const yolda = await upd(U.buyer, `status = 'cancelled'`);
    assert.equal(yolda?.code, '42501', 'yoldaki sipariş müşteri tarafından iptal edilemez');

    const t = await as(db, U.sellerA,
      `UPDATE public.orders SET status = 'delivered', payment_status = 'paid' WHERE id = $1 RETURNING status, payment_status`, [o.id]);
    assert.equal(t.rows[0].status, 'delivered');
    assert.equal(t.rows[0].payment_status, 'paid');
  });

  test('teslim sonrası: müşteri iade talep edebilir ama onaylayamaz; yönetici onaylar', async () => {
    const ok = await as(db, U.buyer,
      `UPDATE public.orders SET refund_status = 'requested', refund_reason = 'Soğuk geldi' WHERE id = $1 RETURNING refund_status`, [o.id]);
    assert.equal(ok.rows[0].refund_status, 'requested');
    assert.equal((await upd(U.buyer, `refund_status = 'approved'`))?.code, '42501');
    assert.equal((await upd(U.sellerA, `refund_status = 'approved'`))?.code, '42501');
    const adm = await as(db, U.admin,
      `UPDATE public.orders SET refund_status = 'approved' WHERE id = $1 RETURNING refund_status`, [o.id]);
    assert.equal(adm.rows[0].refund_status, 'approved');
  });

  test('müşteri bekleyen siparişini iptal edebilir', async () => {
    const n = (await order(U.buyer2, S.A, items({ menu_item_id: M.ayran, quantity: 1 }))).rows[0];
    const r = await as(db, U.buyer2,
      `UPDATE public.orders SET status = 'cancelled', cancel_reason = 'Vazgeçtim' WHERE id = $1 RETURNING status`, [n.id]);
    assert.equal(r.rows[0].status, 'cancelled');
  });
});

describe('Yorumlar', () => {
  let delivered;
  before(async () => {
    delivered = (await order(U.buyer2, S.A, items({ menu_item_id: M.kebap, quantity: 1 }))).rows[0];
    await db.exec(`UPDATE public.orders SET status = 'delivered' WHERE id = '${delivered.id}'`);
  });

  test('siparişsiz veya teslim edilmemiş siparişe yorum yazılamaz', async () => {
    const siparissiz = await failure(db, U.stranger,
      `INSERT INTO public.reviews (seller_id, customer_id, rating) VALUES ('${S.A}','${U.stranger}',5)`);
    assert.equal(siparissiz?.code, '42501');

    const bekleyen = (await order(U.stranger, S.A, items({ menu_item_id: M.ayran, quantity: 1 }))).rows[0];
    const err = await failure(db, U.stranger,
      `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating) VALUES ('${bekleyen.id}','${S.A}','${U.stranger}',5)`);
    assert.equal(err?.code, '42501');
  });

  test('başkasının siparişi için yorum yazılamaz', async () => {
    const err = await failure(db, U.stranger,
      `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating) VALUES ('${delivered.id}','${S.A}','${U.stranger}',5)`);
    assert.equal(err?.code, '42501');
  });

  test('teslim edilmiş siparişe tek yorum; puan sunucuda hesaplanır', async () => {
    const r = await as(db, U.buyer2,
      `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating, comment, helpful_count, seller_reply)
       VALUES ('${delivered.id}','${S.A}','${U.buyer2}',4,'İyiydi', 999, 'sahte yanıt') RETURNING id, helpful_count, seller_reply`);
    assert.equal(r.rows[0].helpful_count, 0);
    assert.equal(r.rows[0].seller_reply, null);

    const s = await db.query(`SELECT rating_avg, rating_count FROM public.sellers WHERE id = '${S.A}'`);
    assert.equal(Number(s.rows[0].rating_avg), 4);
    assert.equal(s.rows[0].rating_count, 1);

    const tekrar = await failure(db, U.buyer2,
      `INSERT INTO public.reviews (order_id, seller_id, customer_id, rating) VALUES ('${delivered.id}','${S.A}','${U.buyer2}',5)`);
    assert.ok(tekrar, 'aynı siparişe ikinci yorum reddedilmeli');
  });

  test('satıcı yalnızca yanıt yazabilir; müşteri yanıtı değiştiremez', async () => {
    const rid = (await db.query(`SELECT id FROM public.reviews WHERE order_id = '${delivered.id}'`)).rows[0].id;
    const puan = await failure(db, U.sellerA, `UPDATE public.reviews SET rating = 5 WHERE id = '${rid}'`);
    assert.equal(puan?.code, '42501');
    const metin = await failure(db, U.sellerA, `UPDATE public.reviews SET comment = 'silindi' WHERE id = '${rid}'`);
    assert.equal(metin?.code, '42501');

    const yanit = await as(db, U.sellerA,
      `UPDATE public.reviews SET seller_reply = 'Teşekkürler' WHERE id = '${rid}' RETURNING seller_reply`);
    assert.equal(yanit.rows[0].seller_reply, 'Teşekkürler');

    const hack = await failure(db, U.buyer2, `UPDATE public.reviews SET seller_reply = 'sahte' WHERE id = '${rid}'`);
    assert.equal(hack?.code, '42501');
    const sayac = await failure(db, U.buyer2, `UPDATE public.reviews SET helpful_count = 50 WHERE id = '${rid}'`);
    assert.equal(sayac?.code, '42501');
  });

  test('müşteri puanını güncelleyince satıcı puanı yeniden hesaplanır', async () => {
    const rid = (await db.query(`SELECT id FROM public.reviews WHERE order_id = '${delivered.id}'`)).rows[0].id;
    await as(db, U.buyer2, `UPDATE public.reviews SET rating = 2 WHERE id = $1`, [rid]);
    const s = await db.query(`SELECT rating_avg FROM public.sellers WHERE id = '${S.A}'`);
    assert.equal(Number(s.rows[0].rating_avg), 2);
  });
});

describe('Yapılandırma', () => {
  test('is_admin() ve security definer fonksiyonlarında search_path sabit', async () => {
    const r = await db.query(`
      SELECT proname, proconfig FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND prosecdef`);
    assert.ok(r.rows.length >= 8);
    for (const row of r.rows) {
      assert.ok(
        (row.proconfig ?? []).some((c) => c.startsWith('search_path=')),
        `${row.proname} için search_path ayarlı değil`,
      );
    }
  });

  test('anon place_order çağıramaz', async () => {
    await db.exec(`RESET ROLE; SET ROLE anon;`);
    let err;
    try {
      await db.query(`SELECT * FROM public.place_order($1,$2::jsonb,$3)`, [S.A, '[]', 'adres adres']);
    } catch (e) { err = e; }
    await db.exec(`RESET ROLE;`);
    assert.equal(err?.code, '42501');
  });
});
