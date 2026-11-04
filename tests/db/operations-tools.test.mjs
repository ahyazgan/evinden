// 035: kullanım ölçümü, canlı sipariş izleme, sahtecilik ve kupon kuralları.
import { test, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';
import { ANALYTICS_EVENTS, cleanProps, funnelIsEmpty, funnelSteps, newSessionId } from '../../lib/analytics-core.ts';
import { stuckInfo } from '../../lib/live-orders.ts';

let db;
let admin;
let buyer;

before(async () => {
  db = await createDb();
  admin = await user('admin');
  buyer = await user('buyer');
});

async function user(role = 'buyer', phone = null) {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  if (phone) await verifyPhone(id, phone);
  return id;
}
const verifyPhone = (uid, phone) => db.exec(`UPDATE auth.users SET phone='${phone}', phone_confirmed_at=now() WHERE id='${uid}'`);

async function seller(price = 10000) {
  const uid = await user('seller');
  const id = randomUUID();
  const item = randomUUID();
  await db.exec(`
    INSERT INTO public.sellers (id, user_id, display_name, is_active) VALUES ('${id}','${uid}','Lezzet Restoran',true);
    INSERT INTO public.menu_items (id, seller_id, title, price_cents) VALUES ('${item}','${id}','Yemek',${price});
  `);
  return { uid, id, item };
}

const SESSION = 'oturum-0123456789abcdef';
const event = (name, extra = {}) => ({ session_id: SESSION, name, props: {}, ...extra });
const trackSql = 'SELECT public.track_events($1::jsonb) AS n';
const trackAs = async (uid, events) => (await as(db, uid, trackSql, [JSON.stringify(events)])).rows[0].n;

/** Giriş yapmamış istemci */
async function asAnon(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}
async function anonFailure(sql, params = []) {
  try {
    await asAnon(sql, params);
    return null;
  } catch (e) {
    return { message: e.message, code: e.code };
  }
}

const place = (uid, s, { method = 'cash', coupon = null } = {}) =>
  as(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method, coupon]).then((r) => r.rows[0]);
const placeFails = (uid, s, { method = 'cash', coupon = null } = {}) =>
  failure(db, uid, 'SELECT * FROM public.place_order($1,$2::jsonb,$3,NULL,$4,$5)',
    [s.id, JSON.stringify([{ menu_item_id: s.item, quantity: 1 }]), 'Test Mah. Test Sok. No:1', method, coupon]);

const setStatus = (uid, id, status) => as(db, uid, `UPDATE public.orders SET status='${status}' WHERE id='${id}'`);
const deliver = async (s, id) => {
  for (const st of ['accepted', 'preparing', 'ready', 'delivered']) await setStatus(s.uid, id, st);
};
const order = async (id) => (await db.query(`SELECT * FROM public.orders WHERE id='${id}'`)).rows[0];
const setRules = (patch) => db.exec(`UPDATE public.app_config SET value = public.fraud_rule_defaults() || '${JSON.stringify(patch)}'::jsonb WHERE key='fraud_rules'`);
const resetRules = () => setRules({});
const enableOnline = (on) => db.exec(`UPDATE public.app_config SET value='{"enabled": ${on}}' WHERE key='online_payment'`);

/** Tetikleyici sınırlarına takılmadan doğrudan satır: uid boş, service role gibi. */
async function directOrder(s, { status = 'pending', scheduledFor = null, statusMinutes = 0, createdHours = 0, customer = buyer } = {}) {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO public.orders (id, customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
                               delivery_address, payment_method, payment_status, scheduled_for, created_at, status_changed_at)
    VALUES ('${id}','${customer}','${s.id}','${status}',10000,0,10000,'TRY','Test Mah. No:1','cash','pending',
            ${scheduledFor ?? 'NULL'}, now() - make_interval(hours => ${createdHours}), now() - make_interval(mins => ${statusMinutes}));
  `);
  return id;
}

describe('track_events', () => {
  beforeEach(() => db.exec('DELETE FROM public.analytics_events'));
  const rows = async () => (await db.query('SELECT * FROM public.analytics_events ORDER BY id')).rows;

  test('giriş yapmamış istemci yazabilir, hesap boş kalır', async () => {
    const r = await asAnon(trackSql, [JSON.stringify([event('app_open')])]);
    assert.equal(r.rows[0].n, 1);
    const [row] = await rows();
    assert.equal(row.name, 'app_open');
    assert.equal(row.user_id, null);
    assert.equal(row.session_id, SESSION);
  });

  test('hesap auth.uid()\'den gelir, istemcinin yolladığı user_id ve zaman yok sayılır', async () => {
    const other = await user();
    await trackAs(buyer, [event('view_home', { user_id: other, created_at: '2001-01-01T00:00:00Z' })]);
    const [row] = await rows();
    assert.equal(row.user_id, buyer);
    assert.ok(new Date(row.created_at).getFullYear() > 2020);
  });

  test('profil satırı olmayan oturum anonim sayılır, hata vermez', async () => {
    const ghost = randomUUID();
    assert.equal(await trackAs(ghost, [event('app_open')]), 1);
    assert.equal((await rows())[0].user_id, null);
  });

  test('bütün olay adları ve uygulamanın ürettiği değerler kabul edilir', async () => {
    assert.equal(await trackAs(buyer, ANALYTICS_EVENTS.map((name) => event(name))), ANALYTICS_EVENTS.length);
    const props = cleanProps({ seller_id: randomUUID(), method: 'meal_card_door', fulfillment: 'delivery', scheduled: true, mode: 'foods', length: 12, reason: '55000' });
    assert.equal(Object.keys(props).length, 7);
    assert.equal(await trackAs(buyer, [event('order_failed', { props, session_id: newSessionId() })]), 1);
  });

  test('parti sınırı 20: 20 geçer, 21 ve dizi olmayan reddedilir', async () => {
    assert.equal(await trackAs(buyer, Array.from({ length: 20 }, () => event('search'))), 20);
    const over = await failure(db, buyer, trackSql, [JSON.stringify(Array.from({ length: 21 }, () => event('search')))]);
    assert.equal(over?.code, '22023');
    for (const bad of ['{"name":"search"}', '"x"', 'null']) {
      assert.equal((await failure(db, buyer, trackSql, [bad]))?.code, '22023', bad);
    }
    assert.equal((await rows()).length, 20);
  });

  test('geçersiz olay atlanır, partinin kalanı yazılır', async () => {
    const bad = [
      event('uydurma_olay'),
      event('search', { session_id: 'kisa' }),
      event('search', { session_id: "x'; DROP TABLE y;--xxxxxxxx" }),
      { name: 'search' },
      { session_id: SESSION },
      'metin',
      7,
      event('search', { props: 'metin' }),
      event('search', { props: [1] }),
      event('search', { props: { reason: 'a'.repeat(65) } }),
      event('search', { props: { mode: 'x', length: 1, reason: 'y', method: 'z', fulfillment: 'w', scheduled: true, seller_id: 'a'.repeat(64), extra: 1 } }),
      event('search', { props: { nested: { a: 1 } } }),
      event('search', { props: { method: ['cash'] } }),
    ];
    assert.equal(await trackAs(buyer, [...bad, event('search', { props: { mode: 'foods', length: 3 } })]), 1);
    const all = await rows();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0].props, { mode: 'foods', length: 3 });
  });

  test('adres, telefon ve mesaj metni kaydedilemez', async () => {
    for (const props of [
      { address: 'Moda Cad. No:1' }, { phone: '5551112233' }, { message: 'merhaba' }, { query: 'lahmacun' },
      { latitude: 41.01 }, { longitude: 29.02 }, { reason: 'Moda Cad. No:1' },
    ]) {
      assert.equal(await trackAs(buyer, [event('search', { props })]), 0, JSON.stringify(props));
    }
    assert.equal((await rows()).length, 0);
  });

  test('tablo okunamaz ve doğrudan yazılamaz: yönetici de RPC kullanır', async () => {
    await trackAs(buyer, [event('app_open')]);
    for (const uid of [buyer, admin]) {
      assert.equal((await failure(db, uid, 'SELECT * FROM public.analytics_events'))?.code, '42501');
      assert.equal((await failure(db, uid, `INSERT INTO public.analytics_events (session_id, name) VALUES ('${SESSION}','search')`))?.code, '42501');
      assert.equal((await failure(db, uid, 'DELETE FROM public.analytics_events'))?.code, '42501');
      assert.equal((await failure(db, uid, `UPDATE public.analytics_events SET name='search'`))?.code, '42501');
    }
    assert.equal((await anonFailure('SELECT * FROM public.analytics_events'))?.code, '42501');
    assert.equal((await anonFailure(`INSERT INTO public.analytics_events (session_id, name) VALUES ('${SESSION}','search')`))?.code, '42501');
  });

  test('180 günden eski olaylar zamanlanmış görevde silinir, yenisi kalır', async () => {
    await trackAs(buyer, [event('app_open'), event('view_home')]);
    await db.exec(`UPDATE public.analytics_events SET created_at = now() - interval '181 days' WHERE name='app_open'`);
    await db.exec(`UPDATE public.analytics_events SET created_at = now() - interval '179 days' WHERE name='view_home'`);
    await db.query('SELECT public.expire_pending_orders()');
    assert.deepEqual((await rows()).map((r) => r.name), ['view_home']);
  });

  test('hesap silinince olay kalır, hesap bağı kopar', async () => {
    const leaving = await user();
    await trackAs(leaving, [event('app_open')]);
    await as(db, leaving, 'SELECT public.delete_my_account()');
    const [row] = await rows();
    assert.equal(row.user_id, null);
    assert.equal(row.name, 'app_open');
  });
});

describe('admin_funnel', () => {
  beforeEach(() => db.exec('DELETE FROM public.analytics_events'));
  const funnel = async (days = 7) => (await as(db, admin, 'SELECT * FROM public.admin_funnel($1)', [days])).rows;
  const sessions = (rows, step) => Number(rows.find((r) => r.step === step).sessions);

  test('yalnızca yönetici', async () => {
    assert.equal((await failure(db, buyer, 'SELECT * FROM public.admin_funnel(7)'))?.code, '42501');
    assert.equal((await anonFailure('SELECT * FROM public.admin_funnel(7)'))?.code, '42501');
  });

  test('geçersiz dönem reddedilir', async () => {
    for (const days of [0, -1, 181]) {
      assert.equal((await failure(db, admin, 'SELECT * FROM public.admin_funnel($1)', [days]))?.code, '22023', String(days));
    }
  });

  test('olay yoksa bütün adımlar sıfır: ekran boş durum gösterir', async () => {
    const rows = await funnel();
    assert.deepEqual(rows.map((r) => r.step), [...ANALYTICS_EVENTS]);
    assert.equal(funnelIsEmpty(rows), true);
  });

  test('her adımda tekil oturum sayılır, dönem dışı girmez', async () => {
    const a = newSessionId();
    const b = newSessionId();
    const c = newSessionId();
    await trackAs(buyer, [
      event('app_open', { session_id: a }), event('app_open', { session_id: a }), event('view_home', { session_id: a }),
      event('view_restaurant', { session_id: a }), event('view_restaurant', { session_id: a }),
      event('app_open', { session_id: b }), event('view_home', { session_id: b }),
    ]);
    await asAnon(trackSql, [JSON.stringify([event('app_open', { session_id: c })])]);

    const old = newSessionId();
    await trackAs(buyer, [event('app_open', { session_id: old }), event('order_placed', { session_id: old })]);
    await db.exec(`UPDATE public.analytics_events SET created_at = now() - interval '10 days' WHERE session_id='${old}'`);

    const week = await funnel(7);
    assert.equal(sessions(week, 'app_open'), 3);
    assert.equal(sessions(week, 'view_home'), 2);
    assert.equal(sessions(week, 'view_restaurant'), 1);
    assert.equal(sessions(week, 'order_placed'), 0);

    const month = await funnel(30);
    assert.equal(sessions(month, 'app_open'), 4);
    assert.equal(sessions(month, 'order_placed'), 1);

    const steps = funnelSteps(week);
    assert.equal(funnelIsEmpty(week), false);
    assert.equal(steps[0].sessions, 3);
    assert.equal(steps[1].dropOffPercent, 33);
    assert.equal(steps[2].dropOffPercent, 50);
  });

  test('satıcı ve yönetici oturumları müşteri hunisine girmez', async () => {
    const s = await seller();
    await trackAs(s.uid, [event('app_open', { session_id: newSessionId() })]);
    await trackAs(admin, [event('app_open', { session_id: newSessionId() })]);
    await trackAs(buyer, [event('app_open', { session_id: newSessionId() })]);
    assert.equal(sessions(await funnel(), 'app_open'), 1);
  });
});

describe('yetkiler', () => {
  test('giriş yapmamış istemci 035\'te yalnızca track_events çağırabilir', async () => {
    const { rows } = await db.query(`
      SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)`,
    [[
      'analytics_props_valid', 'track_events', 'admin_funnel', 'orders_track_status', 'admin_live_orders',
      'fraud_rule_defaults', 'fraud_rule', 'verified_phone', 'orders_fraud_guard', 'coupon_redemptions_phone_guard',
      'referrals_phone_guard', 'orders_flag_unusual', 'admin_list_fraud_flags', 'admin_review_fraud_flag',
    ]]);
    assert.equal(rows.length, 14);
    assert.deepEqual(rows.filter((r) => r.anon).map((r) => r.proname), ['track_events']);
    assert.deepEqual(
      rows.filter((r) => r.auth).map((r) => r.proname).sort(),
      ['admin_funnel', 'admin_list_fraud_flags', 'admin_live_orders', 'admin_review_fraud_flag', 'track_events'],
    );
  });
});

describe('durum zamanı', () => {
  test('durum değişince güncellenir, başka alan değişince kalır', async () => {
    const s = await seller();
    const id = await directOrder(s, { statusMinutes: 100 });
    const before = (await order(id)).status_changed_at;
    await as(db, s.uid, `UPDATE public.orders SET updated_at = now() WHERE id='${id}'`);
    assert.deepEqual((await order(id)).status_changed_at, before);
    await setStatus(s.uid, id, 'accepted');
    assert.ok((await order(id)).status_changed_at > before);
  });

  test('yeni sipariş dolu başlar', async () => {
    const s = await seller();
    const o = await place(await user(), s);
    assert.ok(o.status_changed_at);
  });

  test('istemci süreyi ve iptal kaydını değiştiremez', async () => {
    const s = await seller();
    const id = await directOrder(s, { statusMinutes: 100 });
    const before = await order(id);
    for (const uid of [s.uid, admin]) {
      await as(db, uid, `UPDATE public.orders SET status_changed_at = now(), cancelled_by='customer', cancelled_from_status='ready' WHERE id='${id}'`);
    }
    const after = await order(id);
    assert.deepEqual(after.status_changed_at, before.status_changed_at);
    assert.equal(after.cancelled_by, null);
    assert.equal(after.cancelled_from_status, null);
  });

  test('iptali kimin yaptığı kaydedilir', async () => {
    const s = await seller();
    const cases = [
      [s.uid, 'pending', 'seller'],
      [s.uid, 'accepted', 'seller'],
      [buyer, 'pending', 'customer'],
      [admin, 'preparing', 'admin'],
    ];
    for (const [uid, from, by] of cases) {
      const id = await directOrder(s, { status: from });
      await setStatus(uid, id, 'cancelled');
      const o = await order(id);
      assert.equal(o.cancelled_by, by);
      assert.equal(o.cancelled_from_status, from);
    }
    // Süresi dolan sipariş: zamanlanmış görev.
    const late = await directOrder(s);
    await db.exec(`UPDATE public.orders SET pending_since = now() - interval '45 minutes' WHERE id='${late}'`);
    await db.query('SELECT public.expire_pending_orders()');
    assert.equal((await order(late)).cancelled_by, 'system');
  });
});

describe('admin_live_orders', () => {
  const live = async () => (await as(db, admin, 'SELECT * FROM public.admin_live_orders()')).rows;
  const liveOne = async (id) => (await live()).find((r) => r.order_id === id);

  test('yalnızca yönetici', async () => {
    assert.equal((await failure(db, buyer, 'SELECT * FROM public.admin_live_orders()'))?.code, '42501');
    const s = await seller();
    assert.equal((await failure(db, s.uid, 'SELECT * FROM public.admin_live_orders()'))?.code, '42501');
    assert.equal((await anonFailure('SELECT * FROM public.admin_live_orders()'))?.code, '42501');
  });

  test('aktif siparişleri gösterir, biten ve bir günden eski ödeme bekleyeni göstermez', async () => {
    const s = await seller();
    const active = await directOrder(s, { status: 'preparing', statusMinutes: 7 });
    const delivered = await directOrder(s, { status: 'delivered' });
    const cancelled = await directOrder(s, { status: 'cancelled' });
    const freshPay = await directOrder(s, { status: 'awaiting_payment', createdHours: 2 });
    const oldPay = await directOrder(s, { status: 'awaiting_payment', createdHours: 25 });
    const ids = (await live()).map((r) => r.order_id);
    assert.ok(ids.includes(active));
    assert.ok(ids.includes(freshPay));
    for (const hidden of [delivered, cancelled, oldPay]) assert.ok(!ids.includes(hidden));

    const row = await liveOne(active);
    assert.equal(row.restaurant_name, 'Lezzet Restoran');
    assert.equal(row.status, 'preparing');
    assert.equal(row.minutes_in_status, 7);
    assert.equal(row.minutes_past_schedule, null);
    assert.equal(row.total_cents, 10000);
    assert.equal(row.payment_method, 'cash');
    assert.equal(row.fulfillment, 'delivery');
    assert.equal(row.scheduled_for, null);
  });

  test('eski satırda süre bilgisi yoksa updated_at kullanılır', async () => {
    const s = await seller();
    const id = await directOrder(s);
    await db.exec(`UPDATE public.orders SET status_changed_at = NULL, updated_at = now() - interval '20 minutes' WHERE id='${id}'`);
    assert.equal((await order(id)).status_changed_at, null);
    const row = await liveOne(id);
    assert.equal(row.minutes_in_status, 20);
    assert.ok(row.status_changed_at);
  });

  test('eşikler sunucunun süreleriyle doğru çalışır', async () => {
    const s = await seller();
    for (const [status, limit] of [['pending', 15], ['accepted', 45], ['preparing', 45], ['ready', 30], ['out_for_delivery', 60]]) {
      const ok = await liveOne(await directOrder(s, { status, statusMinutes: limit - 1 }));
      const late = await liveOne(await directOrder(s, { status, statusMinutes: limit + 1 }));
      assert.equal(stuckInfo(ok), null, status);
      assert.equal(stuckInfo(late)?.limit, limit, status);
    }
    const paying = await liveOne(await directOrder(s, { status: 'awaiting_payment', statusMinutes: 600 }));
    assert.equal(stuckInfo(paying), null);
  });

  test('planlı sipariş seçilen saatten ölçülür', async () => {
    const s = await seller();
    const future = await liveOne(await directOrder(s, { status: 'accepted', statusMinutes: 500, scheduledFor: `now() + interval '3 hours'` }));
    assert.ok(future.minutes_past_schedule < 0);
    assert.equal(stuckInfo(future), null);

    const soon = await liveOne(await directOrder(s, { status: 'accepted', scheduledFor: `now() - interval '40 minutes'` }));
    assert.equal(soon.minutes_past_schedule, 40);
    assert.equal(stuckInfo(soon), null);

    const late = await liveOne(await directOrder(s, { status: 'accepted', scheduledFor: `now() - interval '50 minutes'` }));
    assert.equal(stuckInfo(late)?.minutes, 50);
    assert.match(stuckInfo(late).reason, /Planlı saati 50 dakika geçti/);
  });
});

describe('kapıda ödeme sınırı', () => {
  beforeEach(async () => {
    await resetRules();
    await enableOnline(false);
  });

  test('iki aktif sipariş serbest, üçüncüsü açıklayıcı mesajla reddedilir', async () => {
    const s = await seller();
    const uid = await user();
    await place(uid, s);
    await place(uid, s, { method: 'card_door' });
    const f = await placeFails(uid, s, { method: 'cash' });
    assert.equal(f?.code, '55000');
    assert.match(f.message, /en çok 2 kapıda ödemeli/);
    assert.ok(!/Online/.test(f.message), 'online kapalıyken önerilmez');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.orders WHERE customer_id='${uid}'`)).rows[0].n, 2);
  });

  test('yemek kartı da sayılır', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.sellers SET meal_cards='{multinet}' WHERE id='${s.id}'`);
    const uid = await user();
    await place(uid, s, { method: 'meal_card_door' });
    await place(uid, s, { method: 'meal_card_door' });
    assert.equal((await placeFails(uid, s, { method: 'meal_card_door' }))?.code, '55000');
  });

  test('sipariş tamamlanınca ya da iptal edilince yer açılır', async () => {
    const s = await seller();
    const uid = await user();
    const a = await place(uid, s);
    const b = await place(uid, s);
    assert.ok(await placeFails(uid, s));
    await deliver(s, a.id);
    const c = await place(uid, s);
    assert.ok(await placeFails(uid, s));
    await setStatus(uid, b.id, 'cancelled');
    assert.ok(await place(uid, s));
    assert.ok(c.id);
  });

  test('online ödeme sınırdan etkilenmez, aktif online sipariş sınıra girmez', async () => {
    await enableOnline(true);
    const s = await seller();
    const uid = await user();
    await place(uid, s);
    await place(uid, s);
    const f = await placeFails(uid, s);
    assert.match(f.message, /Online ödeyebilir/);
    const online = await place(uid, s, { method: 'online' });
    assert.equal(online.status, 'awaiting_payment');
    const other = await user();
    await place(other, s, { method: 'online' });
    await place(other, s);
    await place(other, s);
  });

  test('sınır müşteri başınadır, başka müşteriyi etkilemez', async () => {
    const s = await seller();
    const uid = await user();
    await place(uid, s);
    await place(uid, s);
    assert.ok(await place(await user(), s));
  });

  test('reddedilen sipariş stok düşmez', async () => {
    const s = await seller();
    await db.exec(`UPDATE public.menu_items SET daily_limit=10 WHERE id='${s.item}'`);
    const uid = await user();
    await place(uid, s);
    await place(uid, s);
    assert.ok(await placeFails(uid, s));
    assert.equal((await db.query(`SELECT sold_today FROM public.menu_items WHERE id='${s.item}'`)).rows[0].sold_today, 2);
  });

  test('sınır fraud_rules ile değişir, bozuk ayar varsayılana döner', async () => {
    const s = await seller();
    const uid = await user();
    await setRules({ door_active_limit: 1 });
    await place(uid, s);
    assert.ok(await placeFails(uid, s));
    await setRules({ door_active_limit: 'bozuk' });
    await place(uid, s);
    assert.ok(await placeFails(uid, s));
    await db.exec(`DELETE FROM public.app_config WHERE key='fraud_rules'`);
    assert.ok(await placeFails(uid, s));
    await db.exec(`INSERT INTO public.app_config (key, value) VALUES ('fraud_rules', public.fraud_rule_defaults())`);
  });
});

describe('tekrarlayan iptaller', () => {
  beforeEach(async () => {
    await resetRules();
    await enableOnline(false);
  });

  /** Satıcının kabul edip iptal ettiği kapıda ödemeli sipariş */
  const sellerCancelsAccepted = async (uid, s, method = 'cash') => {
    const o = await place(uid, s, { method });
    await setStatus(s.uid, o.id, 'accepted');
    await setStatus(s.uid, o.id, 'cancelled');
    return o.id;
  };

  test('üç iptal kapıda ödemeyi kapatır, online açık kalır', async () => {
    await enableOnline(true);
    const s = await seller();
    const uid = await user();
    await sellerCancelsAccepted(uid, s);
    await sellerCancelsAccepted(uid, s);
    assert.ok(await place(uid, s), 'iki iptal engel olmaz');
    await db.exec(`UPDATE public.orders SET status='cancelled' WHERE customer_id='${uid}' AND status='pending'`);
    await sellerCancelsAccepted(uid, s, 'card_door');
    const f = await placeFails(uid, s);
    assert.equal(f?.code, '55000');
    assert.match(f.message, /kapıda ödeme şu an kapalı\. Online ödeyebilirsin/);
    assert.equal((await place(uid, s, { method: 'online' })).status, 'awaiting_payment');
  });

  test('online kapalıysa destek yönlendirilir', async () => {
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 3; i++) await sellerCancelsAccepted(uid, s);
    assert.match((await placeFails(uid, s)).message, /Destek ekibimize/);
  });

  test('sayılmayanlar: bekleyeni reddetme, müşterinin ve yöneticinin iptali, zamanlanmış görev', async () => {
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 3; i++) {
      const rejected = await place(uid, s);
      await setStatus(s.uid, rejected.id, 'cancelled');
    }
    for (let i = 0; i < 3; i++) {
      const mine = await place(uid, s);
      await setStatus(s.uid, mine.id, 'accepted');
      await setStatus(uid, mine.id, 'cancelled');
    }
    for (let i = 0; i < 3; i++) {
      const byAdmin = await place(uid, s);
      await setStatus(s.uid, byAdmin.id, 'accepted');
      await setStatus(admin, byAdmin.id, 'cancelled');
    }
    const late = await place(uid, s);
    await db.exec(`UPDATE public.orders SET pending_since = now() - interval '45 minutes' WHERE id='${late.id}'`);
    await db.query('SELECT public.expire_pending_orders()');
    assert.ok(await place(uid, s));
  });

  test('30 günden eski iptal sayılmaz', async () => {
    const s = await seller();
    const uid = await user();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await sellerCancelsAccepted(uid, s));
    await db.exec(`UPDATE public.orders SET status_changed_at = now() - interval '31 days' WHERE id='${ids[0]}'`);
    assert.ok(await place(uid, s));
  });

  test('online siparişin iptali sayılmaz', async () => {
    await enableOnline(true);
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 3; i++) {
      const id = await directOrder(s, { status: 'accepted', customer: uid });
      await db.exec(`UPDATE public.orders SET payment_method='online' WHERE id='${id}'`);
      await setStatus(s.uid, id, 'cancelled');
    }
    assert.ok(await place(uid, s));
  });

  test('035 öncesi iptaller kimin yaptığı bilinmediği için sayılmaz', async () => {
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 4; i++) {
      const id = await directOrder(s, { status: 'accepted', customer: uid });
      await setStatus(s.uid, id, 'cancelled');
      await db.exec(`UPDATE public.orders SET cancelled_by = NULL, cancelled_from_status = NULL WHERE id='${id}'`);
    }
    assert.ok(await place(uid, s));
  });

  test('başka müşterinin iptalleri etkilemez', async () => {
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 3; i++) await sellerCancelsAccepted(uid, s);
    assert.ok(await place(await user(), s));
  });
});

describe('kupon: telefon başına hak', () => {
  beforeEach(resetRules);
  const code = () => `K${randomUUID().slice(0, 8)}`.toUpperCase();
  const coupon = async (perUser = 1) => {
    const c = code();
    await db.exec(`INSERT INTO public.coupons (code, discount_type, discount_value, max_uses_per_user) VALUES ('${c}','fixed',500,${perUser ?? 'NULL'})`);
    return c;
  };
  const used = async (c) => (await db.query(`SELECT used_count FROM public.coupons WHERE code='${c}'`)).rows[0].used_count;
  const phone = () => `90555${Math.floor(1000000 + Math.random() * 8999999)}`;

  test('aynı doğrulanmış telefondaki ikinci hesap kullanamaz', async () => {
    const s = await seller();
    const c = await coupon();
    const p = phone();
    const a = await user('buyer', p);
    const b = await user('buyer', p);
    assert.equal((await place(a, s, { coupon: c })).discount_cents, 500);
    const f = await placeFails(b, s, { coupon: c });
    assert.equal(f?.code, '55000');
    assert.match(f.message, /telefon numaran/);
    assert.equal(await used(c), 1, 'sayaç geri alınır');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.orders WHERE customer_id='${b}'`)).rows[0].n, 0, 'sipariş açılmaz');
    assert.ok(await place(b, s), 'kuponsuz sipariş serbest');
  });

  test('farklı telefon ve doğrulanmamış telefon etkilenmez', async () => {
    const s = await seller();
    const c = await coupon();
    const p = phone();
    await place(await user('buyer', p), s, { coupon: c });
    assert.ok(await place(await user('buyer', phone()), s, { coupon: c }));
    assert.ok(await place(await user(), s, { coupon: c }), 'telefonu olmayan');
    const unconfirmed = await user();
    await db.exec(`UPDATE auth.users SET phone='${p}', phone_confirmed_at=NULL WHERE id='${unconfirmed}'`);
    assert.ok(await place(unconfirmed, s, { coupon: c }), 'doğrulanmamış');
  });

  test('hesap başına hak telefon geneline yayılır', async () => {
    const s = await seller();
    const c = await coupon(2);
    const p = phone();
    const a = await user('buyer', p);
    const b = await user('buyer', p);
    await place(a, s, { coupon: c });
    await place(b, s, { coupon: c });
    const third = await user('buyer', p);
    assert.equal((await placeFails(third, s, { coupon: c }))?.code, '55000');
  });

  test('sınırsız kuponda telefon denetimi yok', async () => {
    const s = await seller();
    const c = await coupon(null);
    const p = phone();
    await place(await user('buyer', p), s, { coupon: c });
    assert.ok(await place(await user('buyer', p), s, { coupon: c }));
  });

  test('iptal edilen sipariş hakkı geri verir', async () => {
    const s = await seller();
    const c = await coupon();
    const p = phone();
    const a = await user('buyer', p);
    const b = await user('buyer', p);
    const o = await place(a, s, { coupon: c });
    await setStatus(a, o.id, 'cancelled');
    assert.ok(await place(b, s, { coupon: c }));
  });

  test('numara hesaptan hesaba taşınınca da yakalanır', async () => {
    const s = await seller();
    const c = await coupon();
    const p = phone();
    const a = await user('buyer', p);
    await place(a, s, { coupon: c });
    await verifyPhone(a, phone());
    const b = await user('buyer', p);
    assert.equal((await placeFails(b, s, { coupon: c }))?.code, '55000');
  });

  test('telefon sonradan doğrulansa da eski hesabın güncel numarası sayılır', async () => {
    const s = await seller();
    const c = await coupon();
    const a = await user();
    await place(a, s, { coupon: c });
    const p = phone();
    await verifyPhone(a, p);
    const b = await user('buyer', p);
    assert.equal((await placeFails(b, s, { coupon: c }))?.code, '55000');
  });

  test('kişiye özel ödül kuponu etkilenmez', async () => {
    const s = await seller();
    const p = phone();
    const a = await user('buyer', p);
    await user('buyer', p);
    const { rows } = await as(db, null, `SELECT public.issue_personal_coupon('${a}', 'fixed', 500, 'Ödül') AS c`);
    assert.ok(await place(a, s, { coupon: rows[0].c }));
  });
});

describe('davet: aynı telefon', () => {
  const myCode = async (uid) => (await as(db, uid, 'SELECT public.get_my_referral_code() AS c')).rows[0].c;
  const APPLY = 'SELECT public.apply_referral_code($1) AS c';

  test('aynı doğrulanmış telefon reddedilir, mesaj gösterilir', async () => {
    const p = '905551112201';
    const referrer = await user('buyer', p);
    const fresh = await user('buyer', p);
    const f = await failure(db, fresh, APPLY, [await myCode(referrer)]);
    assert.equal(f?.code, '55000');
    assert.match(f.message, /Aynı telefon/);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.referrals WHERE referred_id='${fresh}'`)).rows[0].n, 0);
  });

  test('farklı veya doğrulanmamış telefonda çalışır', async () => {
    const referrer = await user('buyer', '905551112202');
    const code = await myCode(referrer);
    const other = await user('buyer', '905551112203');
    assert.match((await as(db, other, APPLY, [code])).rows[0].c, /./);
    const unverified = await user();
    assert.match((await as(db, unverified, APPLY, [code])).rows[0].c, /./);
    const noPhoneReferrer = await user();
    const third = await user('buyer', '905551112204');
    assert.match((await as(db, third, APPLY, [await myCode(noPhoneReferrer)])).rows[0].c, /./);
  });

  test('kendi kodu zaten reddedilir', async () => {
    const uid = await user();
    const f = await failure(db, uid, APPLY, [await myCode(uid)]);
    assert.match(f?.message ?? '', /Kendi davet kodunuzu/);
  });
});

describe('kendi mağazasından sipariş', () => {
  test('reddedilir', async () => {
    const s = await seller();
    const f = await placeFails(s.uid, s);
    assert.equal(f?.code, '22023');
    assert.match(f.message, /Kendi mağazanızdan/);
  });
});

describe('fraud_rules görünürlüğü', () => {
  test('eşikler müşteriye görünmez, diğer ayarlar görünür', async () => {
    await resetRules();
    const hidden = `SELECT * FROM public.app_config WHERE key='fraud_rules'`;
    const open = `SELECT * FROM public.app_config WHERE key='order_pricing'`;
    assert.equal((await as(db, buyer, hidden)).rows.length, 0);
    assert.equal((await asAnon(hidden)).rows.length, 0);
    assert.equal((await as(db, buyer, open)).rows.length, 1);
    assert.equal((await asAnon(open)).rows.length, 1);
    assert.equal((await as(db, admin, hidden)).rows.length, 1);
  });

  test('varsayılanlar', async () => {
    await resetRules();
    const { rows } = await db.query(`SELECT value FROM public.app_config WHERE key='fraud_rules'`);
    assert.deepEqual(rows[0].value, {
      door_active_limit: 2,
      door_active_horizon_hours: 2,
      door_active_stale_hours: 12,
      door_cancel_limit: 3,
      door_cancel_days: 30,
      flag_new_account_hours: 24,
      flag_new_account_total_cents: 200000,
      flag_burst_orders: 3,
      flag_burst_minutes: 10,
    });
  });
});

describe('işaretleme', () => {
  beforeEach(async () => {
    await resetRules();
    await db.exec('DELETE FROM public.fraud_flags');
  });
  const flags = async (orderId) => (await db.query(`SELECT * FROM public.fraud_flags WHERE order_id='${orderId}'`)).rows;
  const makeOld = (uid) => db.exec(`UPDATE public.users SET created_at = now() - interval '25 hours' WHERE id='${uid}'`);

  test('yeni hesaptan yüksek tutar işaretlenir, sipariş açılır', async () => {
    const s = await seller(200001);
    const uid = await user();
    const o = await place(uid, s);
    assert.equal(o.status, 'pending');
    const [flag] = await flags(o.id);
    assert.equal(flag.reason, 'new_account_large_total');
    assert.equal(flag.user_id, uid);
    assert.equal(flag.reviewed_at, null);
  });

  test('normal sipariş ve eski hesap işaretlenmez', async () => {
    const small = await place(await user(), await seller(10000));
    assert.equal((await flags(small.id)).length, 0);
    const uid = await user();
    await makeOld(uid);
    const big = await place(uid, await seller(300000));
    assert.equal((await flags(big.id)).length, 0);
  });

  test('tutar sınırın tam üstünde işaretlenir, sınırda işaretlenmez', async () => {
    await setRules({ flag_new_account_total_cents: 11000 });
    const s = await seller(9500);
    const atLimit = await place(await user(), s);
    assert.equal(atLimit.total_cents, 11000);
    assert.equal((await flags(atLimit.id)).length, 0);
    const above = await place(await user(), await seller(9501));
    assert.equal((await flags(above.id)).length, 1);
  });

  test('10 dakikada dördüncü sipariş işaretlenir, üçü işaretlenmez, hiçbiri engellenmez', async () => {
    const s = await seller();
    const uid = await user();
    await makeOld(uid);
    const placed = [];
    for (let i = 0; i < 3; i++) {
      const o = await place(uid, s);
      await deliver(s, o.id);
      placed.push(o);
      assert.equal((await flags(o.id)).length, 0);
    }
    const fourth = await place(uid, s);
    assert.deepEqual((await flags(fourth.id)).map((f) => f.reason), ['order_burst']);
  });

  test('10 dakikadan eski sipariş sayılmaz', async () => {
    const s = await seller();
    const uid = await user();
    for (let i = 0; i < 3; i++) {
      const o = await place(uid, s);
      await deliver(s, o.id);
      await db.exec(`UPDATE public.orders SET created_at = now() - interval '11 minutes' WHERE id='${o.id}'`);
    }
    const next = await place(uid, s);
    assert.equal((await flags(next.id)).length, 0);
  });

  test('bozuk ayar siparişi durdurmaz', async () => {
    await setRules({ flag_new_account_total_cents: 'bozuk', flag_burst_orders: null });
    const o = await place(await user(), await seller(200001));
    assert.equal((await flags(o.id)).length, 1, 'varsayılana düşer');
  });

  test('yalnızca yönetici okur, kimse doğrudan yazamaz', async () => {
    const uid = await user();
    const o = await place(uid, await seller(200001));
    assert.equal((await as(db, uid, 'SELECT * FROM public.fraud_flags')).rows.length, 0);
    assert.equal((await as(db, buyer, 'SELECT * FROM public.fraud_flags')).rows.length, 0);
    assert.equal((await as(db, admin, 'SELECT * FROM public.fraud_flags')).rows.length, 1);
    assert.equal((await anonFailure('SELECT * FROM public.fraud_flags'))?.code, '42501');
    for (const who of [uid, admin]) {
      assert.equal((await failure(db, who, `INSERT INTO public.fraud_flags (order_id, reason) VALUES ('${o.id}','order_burst')`))?.code, '42501');
      assert.equal((await failure(db, who, 'UPDATE public.fraud_flags SET reviewed_at = now()'))?.code, '42501');
      assert.equal((await failure(db, who, 'DELETE FROM public.fraud_flags'))?.code, '42501');
    }
  });

  test('liste ve İncelendi yalnızca yöneticide', async () => {
    const uid = await user();
    await place(uid, await seller(200001));
    const { rows: [flag] } = await as(db, admin, 'SELECT * FROM public.admin_list_fraud_flags(FALSE)');
    assert.equal(flag.restaurant_name, 'Lezzet Restoran');
    assert.equal(flag.user_id, uid);
    assert.equal(flag.user_name, 'Test');
    assert.equal(flag.reason, 'new_account_large_total');
    assert.ok(flag.total_cents > 200000);

    for (const sql of ['SELECT * FROM public.admin_list_fraud_flags(FALSE)', `SELECT public.admin_review_fraud_flag('${flag.id}')`]) {
      assert.equal((await failure(db, uid, sql))?.code, '42501');
      assert.equal((await anonFailure(sql))?.code, '42501');
    }

    await as(db, admin, 'SELECT public.admin_review_fraud_flag($1)', [flag.id]);
    assert.equal((await as(db, admin, 'SELECT * FROM public.admin_list_fraud_flags(FALSE)')).rows.length, 0);
    const reviewed = (await as(db, admin, 'SELECT * FROM public.admin_list_fraud_flags(TRUE)')).rows;
    assert.equal(reviewed.length, 1);
    assert.ok(reviewed[0].reviewed_at);

    const first = reviewed[0].reviewed_at;
    await as(db, admin, 'SELECT public.admin_review_fraud_flag($1)', [flag.id]);
    assert.deepEqual((await as(db, admin, 'SELECT * FROM public.admin_list_fraud_flags(TRUE)')).rows[0].reviewed_at, first);

    assert.equal((await failure(db, admin, 'SELECT public.admin_review_fraud_flag($1)', [randomUUID()]))?.code, 'P0002');
  });

  test('hesap silinince işaret kalır, kişi bağı kopar', async () => {
    const s = await seller(200001);
    const uid = await user();
    const o = await place(uid, s);
    await deliver(s, o.id);
    await as(db, uid, 'SELECT public.delete_my_account()');
    const [flag] = await flags(o.id);
    assert.equal(flag.user_id, null);
    assert.equal((await as(db, admin, 'SELECT * FROM public.admin_list_fraud_flags(FALSE)')).rows[0].user_name, null);
  });
});
