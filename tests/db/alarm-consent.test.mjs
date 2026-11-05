// 038: kampanya bildirimi izni ve yeni sipariş alarmının push kanalı.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDb, as, failure } from './harness.mjs';

let db;
let admin;

before(async () => {
  db = await createDb();
  await db.exec(`UPDATE public.app_config SET value='{"enabled": true}' WHERE key='online_payment'`);
  admin = await user('admin');
});

async function user(role = 'buyer', consent = false) {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved, marketing_consent) VALUES ('${id}','Test','${role}',true,${consent});
  `);
  return id;
}

async function seller() {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Lokanta',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',10000);
  `);
  return { uid, id, item };
}

const one = async (sql) => (await db.query(sql)).rows[0];
const consentOf = (uid) => one(`SELECT marketing_consent, marketing_consent_at FROM public.users WHERE id='${uid}'`);
const countFor = async (uid, where) =>
  (await one(`SELECT count(*)::int AS c FROM public.notifications WHERE user_id='${uid}' AND ${where}`)).c;
const place = (uid, s, method = 'cash') =>
  as(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,NULL)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method]).then((r) => r.rows[0]);

test('038 canlıya alma belgesinin iki migration listesinde de var', () => {
  const doc = readFileSync(new URL('../../docs/CANLIYA-ALMA.md', import.meta.url), 'utf8');
  assert.match(doc, /`037`, `038`\. `023` online/);
  assert.match(doc, /sonradan çalıştırılabilir,[^.]*`037`, `038`\./);
});

describe('kampanya izni', () => {
  test('varsayılan kapalı, tarih boş', async () => {
    const uid = randomUUID();
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${uid}')`);
    await as(db, uid, `INSERT INTO public.users (id, name, role) VALUES ('${uid}','Yeni','buyer')`);
    const row = await consentOf(uid);
    assert.equal(row.marketing_consent, false);
    assert.equal(row.marketing_consent_at, null);
  });

  test('kayıtta izin verilirse tarih sunucudan yazılır, istemcinin tarihi geçmez', async () => {
    const uid = randomUUID();
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${uid}')`);
    await as(db, uid, `INSERT INTO public.users (id, name, role, marketing_consent, marketing_consent_at)
                       VALUES ('${uid}','Yeni','buyer',true,'2001-01-01')`);
    const row = await consentOf(uid);
    assert.equal(row.marketing_consent, true);
    assert.ok(row.marketing_consent_at.getFullYear() > 2001);
  });

  test('kullanıcı yalnızca kendi iznini değiştirir', async () => {
    const owner = await user();
    const other = await user();
    await as(db, owner, `UPDATE public.users SET marketing_consent = true WHERE id='${owner}'`);
    assert.equal((await consentOf(owner)).marketing_consent, true);

    const r = await as(db, other, `UPDATE public.users SET marketing_consent = false WHERE id='${owner}'`);
    assert.equal(r.affectedRows, 0);
    assert.equal((await consentOf(owner)).marketing_consent, true);
  });

  test('yönetici başkasının iznini değiştiremez, diğer alanları güncelleyebilir', async () => {
    const owner = await user();
    const err = await failure(db, admin, `UPDATE public.users SET marketing_consent = true WHERE id='${owner}'`);
    assert.equal(err?.code, '42501');
    assert.equal((await consentOf(owner)).marketing_consent, false);
    await as(db, admin, `UPDATE public.users SET name = 'Yeni ad' WHERE id='${owner}'`);
    assert.equal((await one(`SELECT name FROM public.users WHERE id='${owner}'`)).name, 'Yeni ad');
  });

  test('tarih istemciden yazılamaz, yalnızca değer değişince ilerler', async () => {
    const owner = await user();
    await as(db, owner, `UPDATE public.users SET marketing_consent_at = '2001-01-01' WHERE id='${owner}'`);
    assert.equal((await consentOf(owner)).marketing_consent_at, null);

    await as(db, owner, `UPDATE public.users SET marketing_consent = true WHERE id='${owner}'`);
    const given = (await consentOf(owner)).marketing_consent_at;
    assert.ok(given);

    await as(db, owner, `UPDATE public.users SET marketing_consent_at = '2001-01-01', name = 'Ad' WHERE id='${owner}'`);
    assert.equal((await consentOf(owner)).marketing_consent_at.getTime(), given.getTime());

    // İzin geri alındığında da son değişikliğin anı tutulur.
    await db.exec(`UPDATE public.users SET marketing_consent_at = '2020-01-01' WHERE id='${owner}'`);
    await as(db, owner, `UPDATE public.users SET marketing_consent = false WHERE id='${owner}'`);
    const row = await consentOf(owner);
    assert.equal(row.marketing_consent, false);
    assert.ok(row.marketing_consent_at.getFullYear() > 2020);
  });

  test('kendi rolünü değiştirme koruması sürüyor', async () => {
    const owner = await user();
    const err = await failure(db, owner, `UPDATE public.users SET role = 'admin', marketing_consent = true WHERE id='${owner}'`);
    assert.equal(err?.code, '42501');
  });
});

describe('takipçi duyurusu', () => {
  test('yalnızca izin veren takipçiye gider, saatlik sınır sürüyor', async () => {
    const s = await seller();
    const izinli = await user('buyer', true);
    const izinsiz = await user('buyer', false);
    await db.exec(`INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${izinli}','${s.id}'),('${izinsiz}','${s.id}')`);

    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Mantı')`);
    assert.equal(await countFor(izinli, `type='seller_update'`), 1);
    assert.equal(await countFor(izinsiz, `type='seller_update'`), 0);

    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Börek')`);
    assert.equal(await countFor(izinli, `type='seller_update'`), 1);
  });

  test('izin veren takipçi yoksa bir sonraki duyuru engellenmez', async () => {
    const s = await seller();
    const takipci = await user('buyer', false);
    await db.exec(`INSERT INTO public.seller_follows (user_id, seller_id) VALUES ('${takipci}','${s.id}')`);
    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Mantı')`);
    assert.equal(await countFor(takipci, `type='seller_update'`), 0);

    await as(db, takipci, `UPDATE public.users SET marketing_consent = true WHERE id='${takipci}'`);
    await as(db, s.uid, `SELECT public.notify_my_followers('Yeni','Börek')`);
    assert.equal(await countFor(takipci, `type='seller_update'`), 1);
  });
});

describe('toplu duyuru', () => {
  test('kampanya yalnızca izin verene gider, sayı gerçek gönderimdir', async () => {
    const izinli = await user('buyer', true);
    const izinsiz = await user('buyer', false);
    const title = `Kampanya ${randomUUID().slice(0, 8)}`;
    const expected = (await one(`SELECT count(*)::int AS c FROM public.users WHERE marketing_consent AND NOT is_suspended AND role='buyer'`)).c;
    const r = await as(db, admin, 'SELECT public.admin_broadcast($1,$2,$3) AS n', [title, 'İndirim', 'buyer']);
    assert.equal(r.rows[0].n, expected);
    assert.equal(await countFor(izinli, `title='${title}' AND type='promo'`), 1);
    assert.equal(await countFor(izinsiz, `title='${title}'`), 0);
  });

  test('p_commercial belirtilmezse kampanya sayılır', async () => {
    const izinsiz = await user('buyer', false);
    const title = `Varsayilan ${randomUUID().slice(0, 8)}`;
    await as(db, admin, 'SELECT public.admin_broadcast($1,$2)', [title, 'Metin']);
    assert.equal(await countFor(izinsiz, `title='${title}'`), 0);
    const nullTitle = `Bos ${randomUUID().slice(0, 8)}`;
    await as(db, admin, 'SELECT public.admin_broadcast($1,$2,$3,NULL)', [nullTitle, 'Metin', 'all']);
    assert.equal(await countFor(izinsiz, `title='${nullTitle}'`), 0);
  });

  test('hizmet duyurusu herkese gider, türü promo değildir; askıdaki ve yönetici hariç', async () => {
    const izinli = await user('buyer', true);
    const izinsiz = await user('buyer', false);
    const satici = await user('seller', false);
    const askida = await user('buyer', true);
    await db.exec(`UPDATE public.users SET is_suspended = true WHERE id='${askida}'`);
    const title = `Kesinti ${randomUUID().slice(0, 8)}`;
    const expected = (await one(`SELECT count(*)::int AS c FROM public.users WHERE NOT is_suspended AND role<>'admin'`)).c;
    const r = await as(db, admin, 'SELECT public.admin_broadcast($1,$2,$3,$4) AS n', [title, 'Bakım', 'all', false]);
    assert.equal(r.rows[0].n, expected);
    for (const uid of [izinli, izinsiz, satici]) assert.equal(await countFor(uid, `title='${title}' AND type='system'`), 1);
    assert.equal(await countFor(askida, `title='${title}'`), 0);
    assert.equal(await countFor(admin, `title='${title}'`), 0);
    assert.equal((await one(`SELECT count(*)::int AS c FROM public.notifications WHERE title='${title}' AND type='promo'`)).c, 0);
  });

  test('yetki: yalnızca yönetici, eski imza kalmadı, anon çalıştıramaz', async () => {
    const buyer = await user();
    const err = await failure(db, buyer, 'SELECT public.admin_broadcast($1,$2,$3,$4)', ['B', 'M', 'all', false]);
    assert.equal(err?.code, '42501');
    const sigs = (await db.query(`SELECT pg_get_function_identity_arguments(oid) AS a FROM pg_proc WHERE proname='admin_broadcast'`)).rows;
    assert.equal(sigs.length, 1);
    assert.match(sigs[0].a, /p_commercial boolean/);
    const anon = await one(`SELECT has_function_privilege('anon','public.admin_broadcast(text,text,text,boolean)','EXECUTE') AS can`);
    assert.equal(anon.can, false);
  });
});

describe('yeni sipariş bildirimi', () => {
  const lastFlag = async (uid, title) =>
    (await one(`SELECT data FROM public.notifications WHERE user_id='${uid}' AND title='${title}' ORDER BY created_at DESC LIMIT 1`))?.data;

  test('kapıda ödemeli yeni sipariş satıcıya bayrakla gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    const data = await lastFlag(s.uid, 'Yeni sipariş');
    assert.equal(data.new_order, true);
    assert.equal(data.orderId, o.id);
  });

  test('online siparişte bildirim ödeme alınınca ve bayrakla gider', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s, 'online');
    assert.equal(await lastFlag(s.uid, 'Yeni sipariş'), undefined);
    await db.exec(`UPDATE public.orders SET status='pending', payment_status='paid' WHERE id='${o.id}'`);
    assert.equal((await lastFlag(s.uid, 'Yeni sipariş')).new_order, true);
  });

  test('diğer sipariş bildirimleri bayrak taşımaz', async () => {
    const s = await seller();
    const buyer = await user();
    const o = await place(buyer, s);
    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    const data = await lastFlag(buyer, 'Siparişin kabul edildi');
    assert.equal(data.orderId, o.id);
    assert.equal('new_order' in data, false);
  });
});

// 019 pg_net gerektirdiği için harness'te atlanır, tetikleyici de yoktur. Burada net.http_post'un yerine gönderilen
// gövdeyi kaydeden bir taklit konur ve tetikleyici kurulur: 038'deki fonksiyonun kendisi çalışır.
describe('push kanalı', () => {
  before(async () => {
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS net;
      CREATE TABLE net.sent (body jsonb);
      CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
        LANGUAGE sql AS $$ INSERT INTO net.sent VALUES (body); SELECT 1::bigint; $$;
      CREATE TRIGGER notifications_send_push_trg AFTER INSERT ON public.notifications
        FOR EACH ROW EXECUTE FUNCTION public.notifications_send_push();
    `);
  });

  const sentTo = async (token) =>
    (await db.query(`SELECT body FROM net.sent WHERE body->>'to' = '${token}'`)).rows.map((r) => r.body);

  test('yeni sipariş özel kanal ve sesle, öbürleri eskisi gibi gider', async () => {
    const s = await seller();
    const sellerToken = `ExponentPushToken[${randomUUID()}]`;
    const buyerToken = `ExponentPushToken[${randomUUID()}]`;
    const buyer = await user();
    await db.exec(`
      UPDATE public.users SET push_token='${sellerToken}' WHERE id='${s.uid}';
      UPDATE public.users SET push_token='${buyerToken}' WHERE id='${buyer}';
    `);
    const o = await place(buyer, s);

    const [newOrder] = await sentTo(sellerToken);
    assert.equal(newOrder.channelId, 'new-orders');
    assert.equal(newOrder.sound, 'new_order.wav');
    assert.equal(newOrder.priority, 'high');
    assert.equal(newOrder.data.new_order, true);
    assert.equal(newOrder.data.type, 'order_status');

    await as(db, s.uid, `UPDATE public.orders SET status='accepted' WHERE id='${o.id}'`);
    const [accepted] = await sentTo(buyerToken);
    assert.equal(accepted.channelId, 'orders');
    assert.equal(accepted.sound, 'default');
  });

  test('hizmet duyurusu system kanalına gider', async () => {
    const buyer = await user();
    const token = `ExponentPushToken[${randomUUID()}]`;
    await db.exec(`UPDATE public.users SET push_token='${token}' WHERE id='${buyer}'`);
    await as(db, admin, 'SELECT public.admin_broadcast($1,$2,$3,$4)', ['Kesinti', 'Bakım', 'buyer', false]);
    const [body] = await sentTo(token);
    assert.equal(body.channelId, 'system');
    assert.equal(body.sound, 'default');
  });
});
