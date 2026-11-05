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

const one = async (sql) => (await db.query(sql)).rows[0];

// Tohum veri: uid NULL (service role) olduğundan korumalar atlanır.
async function user(role = 'buyer') {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

async function seller(type, active = true) {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, seller_type, is_active)
      VALUES ('${id}','${uid}','Mağaza','${type}',${active});
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

const placeOrder = async (buyer, s) =>
  (await as(db, buyer, 'SELECT * FROM public.place_order($1,$2::jsonb,$3)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1'])).rows[0];

const setRates = (uid, home, restaurant) => as(db, uid, `
  UPDATE public.app_config
     SET value = value || jsonb_build_object('commission_rate_percent', ${home}::numeric, 'restaurant_commission_rate_percent', ${restaurant}::numeric)
   WHERE key = 'order_pricing'`);

const addDoc = (uid, sellerId, type, path = `${uid}/${type}-1.jpg`) => as(db, uid,
  'INSERT INTO public.seller_documents (seller_id, doc_type, storage_path) VALUES ($1,$2,$3)', [sellerId, type, path]);

describe('Satıcı türü', () => {
  test('başvuruda tür seçilemez: restoran olur (041)', async () => {
    const uid = await user();
    const r = await as(db, uid, `INSERT INTO public.sellers (user_id, display_name, seller_type) VALUES ('${uid}','Ev','home') RETURNING seller_type, is_active`);
    assert.equal(r.rows[0].seller_type, 'restaurant');
    assert.equal(r.rows[0].is_active, false);
  });

  test('restoran olarak başvurulabilir, başvuru pasif başlar; geçersiz tür reddedilir', async () => {
    const uid = await user();
    const r = await as(db, uid, `INSERT INTO public.sellers (user_id, display_name, seller_type, is_active)
      VALUES ('${uid}','Lokanta','restaurant',true) RETURNING seller_type, is_active`);
    assert.equal(r.rows[0].seller_type, 'restaurant');
    assert.equal(r.rows[0].is_active, false);

    const other = await user();
    const err = await failure(db, null, `INSERT INTO public.sellers (user_id, display_name, seller_type) VALUES ('${other}','X','fabrika')`);
    assert.equal(err?.code, '23514');
  });

  test('satıcı kendi türünü değiştiremez, yönetici değiştirebilir', async () => {
    const s = await seller('home');
    const err = await failure(db, s.uid, `UPDATE public.sellers SET seller_type='restaurant' WHERE id='${s.id}'`);
    assert.equal(err?.code, '42501');

    await as(db, admin, `UPDATE public.sellers SET seller_type='restaurant' WHERE id='${s.id}'`);
    assert.equal((await one(`SELECT seller_type FROM public.sellers WHERE id='${s.id}'`)).seller_type, 'restaurant');
  });

  test('satıcı türü korunurken mağaza bilgisini güncelleyebilir', async () => {
    const s = await seller('restaurant');
    await as(db, s.uid, `UPDATE public.sellers SET bio='Yeni' WHERE id='${s.id}'`);
    assert.equal((await one(`SELECT bio FROM public.sellers WHERE id='${s.id}'`)).bio, 'Yeni');
  });
});

describe('Türe göre komisyon', () => {
  test('varsayılan: restoran %7 (lansman, 044), ev aşçısı %8', async () => {
    const buyer = await user();
    const ev = await placeOrder(buyer, await seller('home'));
    assert.equal(Number(ev.commission_rate), 8);
    assert.equal(ev.commission_cents, 800);

    const restoran = await placeOrder(buyer, await seller('restaurant'));
    assert.equal(Number(restoran.commission_rate), 7);
    assert.equal(restoran.commission_cents, 700);
    assert.equal(restoran.total_cents, ev.total_cents, 'müşterinin ödediği tutar türe göre değişmez');
  });

  test('yönetici oranı değiştirir: yeni sipariş etkilenir, eski sipariş etkilenmez', async () => {
    const buyer = await user();
    const s = await seller('restaurant');
    const eski = await placeOrder(buyer, s);

    await setRates(admin, 8, 3);
    const yeni = await placeOrder(buyer, s);
    await setRates(admin, 8, 7);

    assert.equal(Number(yeni.commission_rate), 3);
    assert.equal(yeni.commission_cents, 300);
    const tekrar = await one(`SELECT commission_rate, commission_cents FROM public.orders WHERE id='${eski.id}'`);
    assert.equal(Number(tekrar.commission_rate), 7);
    assert.equal(tekrar.commission_cents, 700);
  });

  test('yönetici olmayan oranı değiştiremez', async () => {
    const s = await seller('restaurant');
    const r = await setRates(s.uid, 0, 0);
    assert.equal(r.affectedRows, 0);
    const cfg = await one(`SELECT value FROM public.app_config WHERE key='order_pricing'`);
    assert.equal(cfg.value.restaurant_commission_rate_percent, 7);
  });
});

describe('Restoran belgeleri', () => {
  test('belgeler eksikse restoran yönetici tarafından bile açılamaz', async () => {
    const s = await seller('restaurant', false);
    const hic = await failure(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${s.id}'`);
    assert.equal(hic?.code, '55000');

    await addDoc(s.uid, s.id, 'tax_certificate');
    const eksik = await failure(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${s.id}'`);
    assert.equal(eksik?.code, '55000');

    await addDoc(s.uid, s.id, 'business_license');
    await as(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${s.id}'`);
    assert.equal((await one(`SELECT is_active FROM public.sellers WHERE id='${s.id}'`)).is_active, true);
  });

  test('ev aşçısı için belge şartı yok; mevcut restoranın düzenlenmesi engellenmez', async () => {
    const ev = await seller('home', false);
    await as(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${ev.id}'`);
    assert.equal((await one(`SELECT is_active FROM public.sellers WHERE id='${ev.id}'`)).is_active, true);

    const acik = await seller('restaurant', true);
    await as(db, acik.uid, `UPDATE public.sellers SET bio='Menü' WHERE id='${acik.id}'`);
    await as(db, admin, `UPDATE public.sellers SET is_active=false WHERE id='${acik.id}'`);
    assert.equal((await one(`SELECT is_active FROM public.sellers WHERE id='${acik.id}'`)).is_active, false);
  });

  test('belgeyi yalnızca başvuran ve yönetici görür', async () => {
    const s = await seller('restaurant', false);
    await addDoc(s.uid, s.id, 'tax_certificate');
    const q = `SELECT count(*)::int AS n FROM public.seller_documents WHERE seller_id='${s.id}'`;

    assert.equal((await as(db, s.uid, q)).rows[0].n, 1);
    assert.equal((await as(db, admin, q)).rows[0].n, 1);
    assert.equal((await as(db, await user(), q)).rows[0].n, 0);
    assert.equal((await as(db, (await seller('home')).uid, q)).rows[0].n, 0);
  });

  test('başkasının mağazasına veya başkasının dosyasına belge bağlanamaz', async () => {
    const s = await seller('restaurant', false);
    const baskasi = await user();
    const yabanci = await failure(db, baskasi, `INSERT INTO public.seller_documents (seller_id, doc_type, storage_path)
      VALUES ('${s.id}','tax_certificate','${baskasi}/x.jpg')`);
    assert.equal(yabanci?.code, '42501');

    const yanlisYol = await failure(db, s.uid, `INSERT INTO public.seller_documents (seller_id, doc_type, storage_path)
      VALUES ('${s.id}','tax_certificate','${baskasi}/x.jpg')`);
    assert.equal(yanlisYol?.code, '42501');
  });

  test('onaydan önce belge değiştirilebilir, onaydan sonra eklenemez ve değiştirilemez', async () => {
    const s = await seller('restaurant', false);
    await addDoc(s.uid, s.id, 'tax_certificate');
    await addDoc(s.uid, s.id, 'business_license');
    await as(db, s.uid, `UPDATE public.seller_documents SET storage_path='${s.uid}/tax_certificate-2.jpg' WHERE seller_id='${s.id}' AND doc_type='tax_certificate'`);
    const once = await one(`SELECT storage_path FROM public.seller_documents WHERE seller_id='${s.id}' AND doc_type='tax_certificate'`);
    assert.equal(once.storage_path, `${s.uid}/tax_certificate-2.jpg`);

    await as(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${s.id}'`);
    const r = await as(db, s.uid, `UPDATE public.seller_documents SET storage_path='${s.uid}/sahte.jpg' WHERE seller_id='${s.id}'`);
    assert.equal(r.affectedRows, 0);
  });

  test('geçersiz belge türü reddedilir', async () => {
    const s = await seller('restaurant', false);
    const err = await failure(db, s.uid, `INSERT INTO public.seller_documents (seller_id, doc_type, storage_path)
      VALUES ('${s.id}','pasaport','${s.uid}/x.jpg')`);
    assert.equal(err?.code, '23514');
  });

  test('hesap silinince belge kaydı kalmaz: satış geçmişi olan ve olmayan restoran', async () => {
    const gecmisli = await seller('restaurant', false);
    await addDoc(gecmisli.uid, gecmisli.id, 'tax_certificate');
    await addDoc(gecmisli.uid, gecmisli.id, 'business_license');
    await as(db, admin, `UPDATE public.sellers SET is_active=true WHERE id='${gecmisli.id}'`);
    const o = await placeOrder(await user(), gecmisli);
    await as(db, null, `UPDATE public.orders SET status='delivered' WHERE id='${o.id}'`);
    const { balance_cents } = (await as(db, admin, `SELECT * FROM public.admin_payout_overview() WHERE seller_id='${gecmisli.id}'`)).rows[0];
    await as(db, admin, `SELECT * FROM public.admin_settle_seller('${gecmisli.id}', ${balance_cents})`);

    await as(db, gecmisli.uid, 'SELECT public.delete_my_account()');
    const kalan = await one(`SELECT user_id, seller_type FROM public.sellers WHERE id='${gecmisli.id}'`);
    assert.equal(kalan.user_id, null);
    assert.equal(kalan.seller_type, 'restaurant');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.seller_documents WHERE seller_id='${gecmisli.id}'`)).n, 0);
    assert.equal(Number((await one(`SELECT commission_rate FROM public.orders WHERE id='${o.id}'`)).commission_rate), 7);

    const yeni = await seller('restaurant', false);
    await addDoc(yeni.uid, yeni.id, 'tax_certificate');
    await as(db, yeni.uid, 'SELECT public.delete_my_account()');
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.seller_documents WHERE seller_id='${yeni.id}'`)).n, 0);
  });
});
