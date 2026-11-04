// 035 ve yanındaki saf yardımcılar: kategoriler, ölçüm kuyruğu, huni, takılı sipariş eşikleri, bahşişsiz gelir.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  categoriesMatchingSearch,
  categoryLabel,
  isUnknownCategory,
  MENU_CATEGORIES,
  menuCategoryKey,
  storedCategoryValues,
} from '../../lib/menu-categories.ts';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_PROP_KEYS,
  cleanProps,
  createEventQueue,
  FUNNEL_EXTRAS,
  FUNNEL_STEPS,
  funnelIsEmpty,
  funnelSteps,
  MAX_BATCH,
  newSessionId,
} from '../../lib/analytics-core.ts';
import { sortLiveOrders, STUCK_LIMITS, stuckInfo } from '../../lib/live-orders.ts';
import { orderSalesCents } from '../../lib/earnings.ts';
import { favouriteCategories, recommend } from '../../lib/recommendations.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const MIGRATION = read('supabase/migrations/035_operations_tools.sql');

describe('menü kategorileri', () => {
  test('satıcı kodu ve eski ad aynı anahtara iner', () => {
    assert.equal(menuCategoryKey('ana'), 'ana');
    assert.equal(menuCategoryKey('Ana Yemekler'), 'ana');
    assert.equal(menuCategoryKey('corba'), 'corba');
    assert.equal(menuCategoryKey('Çorbalar'), 'corba');
    assert.equal(menuCategoryKey('Hamur İşleri'), 'hamur');
    assert.equal(menuCategoryKey('Zeytinyağlılar'), 'zeytinyagli');
  });

  test('büyük-küçük harf, Türkçe karakter ve boşluk fark etmez', () => {
    assert.equal(menuCategoryKey('  ANA   YEMEKLER '), 'ana');
    assert.equal(menuCategoryKey('IZGARALAR'), 'izgara');
    assert.equal(menuCategoryKey('ızgara'), 'izgara');
    assert.equal(menuCategoryKey('İÇECEKLER'), 'icecek');
    assert.equal(menuCategoryKey('kahvaltilar'), 'kahvalti');
  });

  test('boş ve tanınmayan değer Diğer sayılır', () => {
    for (const raw of [null, undefined, '', '   ', 'Kebaplar']) assert.equal(menuCategoryKey(raw), 'diger');
  });

  test('tanınmayan eski kayıt ayırt edilir: yalnızca bunlar formda ayrı gösterilip korunur', () => {
    for (const raw of ['Kebaplar', ' Ev Yemekleri ']) assert.equal(isUnknownCategory(raw), true, raw);
    for (const raw of [null, undefined, '', '   ', 'ana', 'Ana Yemek', 'ÇORBALAR', 'diger', 'Diğer']) assert.equal(isUnknownCategory(raw), false, String(raw));
  });

  test('ekranda hep aynı ad yazılır, tanınmayan eski metin kaybolmaz', () => {
    assert.equal(categoryLabel('ana'), 'Ana Yemekler');
    assert.equal(categoryLabel('Ana Yemekler'), 'Ana Yemekler');
    assert.equal(categoryLabel('tatli'), 'Tatlılar');
    assert.equal(categoryLabel(null), 'Diğer');
    assert.equal(categoryLabel(' Kebaplar '), 'Kebaplar');
  });

  test('satıcı formunun eski kodları geçerli kalır, anahtarlar benzersizdir', () => {
    const ids = MENU_CATEGORIES.map((c) => c.id);
    for (const code of ['corba', 'ana', 'salata', 'tatli', 'icecek', 'diger']) assert.ok(ids.includes(code), code);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(MENU_CATEGORIES.map((c) => c.label)).size, ids.length);
  });

  test('satıcının kodla girdiği yemek kategori filtresinde çıkar', () => {
    const items = [{ category: 'ana' }, { category: 'Ana Yemekler' }, { category: 'tatli' }, { category: null }];
    assert.equal(items.filter((i) => menuCategoryKey(i.category) === menuCategoryKey('Ana Yemekler')).length, 2);
  });

  test('sorgu için kayıtlı bütün yazımlar', () => {
    assert.deepEqual(storedCategoryValues(['ana']), ['ana', 'Ana Yemekler', 'Ana Yemek']);
    assert.deepEqual(storedCategoryValues(['yok']), []);
  });

  test('arama: "çorba" kodla kayıtlıyı da bulur, tek harf aramaz', () => {
    assert.deepEqual(categoriesMatchingSearch('çorba'), ['corba']);
    assert.deepEqual(categoriesMatchingSearch('Ana yemek'), ['ana']);
    assert.deepEqual(categoriesMatchingSearch('a'), []);
    assert.deepEqual(categoriesMatchingSearch('mantı'), []);
  });

  test('ekranlar kendi kategori listesini tutmaz', () => {
    for (const path of ['app/(customer)/food-category.tsx', 'app/(customer)/index.tsx', 'app/(seller)/menu.tsx', 'lib/recommendations.ts']) {
      const src = read(path);
      assert.ok(src.includes('menu-categories'), path);
      assert.ok(!src.includes("'Ana Yemekler'"), path);
    }
    assert.ok(read('app/(customer)/seller/[id].tsx').includes('category: categoryLabel(m.category)'));
  });

  test('öneri: kod ve eski ad aynı kategori sayılır', () => {
    const at = '2026-11-01T10:00:00Z';
    const orders = [
      { sellerId: 'a', createdAt: at, categories: ['ana'] },
      { sellerId: 'a', createdAt: at, categories: ['Ana Yemekler'] },
    ];
    assert.deepEqual(favouriteCategories(orders), [{ category: 'ana', orderCount: 2 }]);
    const r = recommend({
      orders,
      sellers: [{ id: 'yeni', open: true }],
      categoryMatches: [{ sellerId: 'yeni', category: 'Ana Yemekler' }],
      now: new Date('2026-11-04T10:00:00Z'),
    });
    assert.equal(r[0].reason, 'Sık seçtiğin Ana Yemekler burada da var');
  });
});

function fakeTimer() {
  const pending = new Set();
  return {
    set: (fn) => { const h = { fn }; pending.add(h); return h; },
    clear: (h) => pending.delete(h),
    fire: () => { for (const h of [...pending]) { pending.delete(h); h.fn(); } },
    get count() { return pending.size; },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ölçüm kuyruğu', () => {
  const SESSION = 'abcdefghijklmnopqrstuvwxyz012345';

  test('olay ve alan listesi veritabanıyla aynı', () => {
    const names = MIGRATION.match(/name\s+text NOT NULL CHECK \(name IN \(([\s\S]*?)\)\)/)[1];
    assert.deepEqual([...names.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...ANALYTICS_EVENTS]);
    const keys = MIGRATION.match(/e\.key <> ALL \(ARRAY\[([^\]]+)\]\)/)[1];
    assert.deepEqual([...keys.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...ANALYTICS_PROP_KEYS]);
  });

  test('huni ve yan sayılar bütün olayları kapsar', () => {
    assert.deepEqual([...FUNNEL_STEPS, ...FUNNEL_EXTRAS].map((s) => s.name).sort(), [...ANALYTICS_EVENTS].sort());
  });

  test('oturum kimliği sunucunun biçimine uyar ve her seferinde farklıdır', () => {
    const pattern = new RegExp(MIGRATION.match(/session_id ~ '([^']+)'/)[1]);
    const a = newSessionId();
    assert.match(a, pattern);
    assert.notEqual(a, newSessionId());
  });

  test('bilinmeyen alan ve metin içeren değer gönderilmez', () => {
    const props = cleanProps({
      seller_id: 'a1b2-c3', method: 'cash', scheduled: false, length: 7,
      reason: 'Atatürk Cad. No:1', address: 'Moda', phone: '5551112233', mode: 'x'.repeat(65), fulfillment: Number.NaN,
    });
    assert.deepEqual(props, { seller_id: 'a1b2-c3', method: 'cash', scheduled: false, length: 7 });
    assert.deepEqual(cleanProps(null), {});
    assert.deepEqual(cleanProps(undefined), {});
  });

  test('olaylar bekletilir, süre dolunca tek partide gider', async () => {
    const timer = fakeTimer();
    const sent = [];
    const q = createEventQueue({ sessionId: SESSION, timer, send: async (b) => { sent.push(b); } });
    q.track('app_open');
    q.track('view_home');
    assert.equal(sent.length, 0);
    assert.equal(timer.count, 1);
    timer.fire();
    await settle();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].map((e) => e.name), ['app_open', 'view_home']);
    assert.equal(sent[0][0].session_id, SESSION);
    assert.equal(q.pending(), 0);
  });

  test('parti 20 olayı aşmaz, kalanı sırayla gider', async () => {
    const timer = fakeTimer();
    const sent = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const q = createEventQueue({ sessionId: SESSION, timer, send: async (b) => { sent.push(b.length); await gate; } });
    for (let i = 0; i < MAX_BATCH + 5; i++) q.track('search');
    await settle();
    assert.deepEqual(sent, [MAX_BATCH]);
    release();
    await settle();
    assert.deepEqual(sent, [MAX_BATCH, 5]);
    assert.equal(q.pending(), 0);
  });

  test('gönderim hatası fırlatılmaz, olay kaybolmaz ve yeniden denenir', async () => {
    const timer = fakeTimer();
    let fail = true;
    const sent = [];
    const q = createEventQueue({
      sessionId: SESSION,
      timer,
      send: async (b) => { if (fail) throw new Error('ağ yok'); sent.push(...b.map((e) => e.name)); },
    });
    q.track('add_to_cart');
    await q.flush();
    assert.equal(q.pending(), 1);
    fail = false;
    q.track('view_cart');
    timer.fire();
    await settle();
    assert.deepEqual(sent, ['add_to_cart', 'view_cart']);
  });

  test('sipariş adımları beklemeden gider, sayfa yenilense de kaybolmaz', async () => {
    for (const name of ['start_checkout', 'order_placed', 'order_failed']) {
      const timer = fakeTimer();
      const sent = [];
      const q = createEventQueue({ sessionId: SESSION, timer, send: async (b) => { sent.push(...b.map((e) => e.name)); } });
      q.track('view_cart');
      q.track(name);
      await settle();
      assert.deepEqual(sent, ['view_cart', name], name);
      assert.equal(q.pending(), 0);
      assert.equal(timer.count, 0, 'bekleyen süre iptal edildi');
    }
  });

  test('gönderim sürerken gelen sipariş adımı hemen ardından gider', async () => {
    const timer = fakeTimer();
    const sent = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const q = createEventQueue({ sessionId: SESSION, timer, send: async (b) => { sent.push(b.map((e) => e.name)); await gate; } });
    q.track('start_checkout');
    await settle();
    q.track('order_placed');
    release();
    await settle();
    assert.deepEqual(sent, [['start_checkout'], ['order_placed']]);
    assert.equal(q.pending(), 0);
  });

  test('diğer olaylar yine bekler', async () => {
    const timer = fakeTimer();
    const sent = [];
    const q = createEventQueue({ sessionId: SESSION, timer, send: async (b) => { sent.push(b); } });
    q.track('view_home');
    q.track('payment_online_started');
    await settle();
    assert.equal(sent.length, 0);
    assert.equal(q.pending(), 2);
  });

  test('send anında hata atsa da uygulamayı etkilemez, kuyruk sınırsız büyümez', async () => {
    const timer = fakeTimer();
    const q = createEventQueue({ sessionId: SESSION, timer, send: () => { throw new Error('bozuk'); } });
    assert.doesNotThrow(() => { for (let i = 0; i < 500; i++) q.track('search'); });
    await settle();
    assert.ok(q.pending() <= 100);
  });
});

describe('huni', () => {
  const rows = [
    { step: 'app_open', sessions: 100 },
    { step: 'view_home', sessions: 80 },
    { step: 'view_restaurant', sessions: 40 },
    { step: 'add_to_cart', sessions: 10 },
    { step: 'view_cart', sessions: 12 },
    { step: 'start_checkout', sessions: 0 },
    { step: 'order_placed', sessions: 0 },
    { step: 'search', sessions: 55 },
  ];

  test('adım sırası, genişlik ve kayıp yüzdesi', () => {
    const steps = funnelSteps(rows);
    assert.deepEqual(steps.map((s) => s.name), FUNNEL_STEPS.map((s) => s.name));
    assert.equal(steps[0].dropOffPercent, null);
    assert.equal(steps[0].widthPercent, 100);
    assert.equal(steps[1].dropOffPercent, 20);
    assert.equal(steps[2].dropOffPercent, 50);
    assert.equal(steps[2].widthPercent, 40);
  });

  test('sonraki adım büyükse kayıp sıfırdır, önceki adım boşsa yüzde yazılmaz', () => {
    const steps = funnelSteps(rows);
    assert.equal(steps[4].dropOffPercent, 0);
    assert.equal(steps[5].dropOffPercent, 100);
    assert.equal(steps[6].dropOffPercent, null);
  });

  test('metin ve eksik sayı güvenle okunur', () => {
    const steps = funnelSteps([{ step: 'app_open', sessions: '3' }]);
    assert.equal(steps[0].sessions, 3);
    assert.equal(steps[1].sessions, 0);
  });

  test('hiç oturum yoksa boş sayılır: sıfırlı huni gösterilmez', () => {
    assert.equal(funnelIsEmpty([{ step: 'app_open', sessions: 0 }, { step: 'search', sessions: '0' }]), true);
    assert.equal(funnelIsEmpty([]), true);
    assert.equal(funnelIsEmpty(rows), false);
  });
});

describe('takılı sipariş', () => {
  test('eşikler', () => {
    assert.deepEqual(STUCK_LIMITS, { pending: 15, accepted: 45, preparing: 45, ready: 30, out_for_delivery: 60 });
  });

  for (const [status, limit] of Object.entries(STUCK_LIMITS)) {
    test(`${status}: tam ${limit} dakikada takılı değil, ${limit + 1} dakikada takılı`, () => {
      assert.equal(stuckInfo({ status, minutes_in_status: limit }), null);
      const stuck = stuckInfo({ status, minutes_in_status: limit + 1 });
      assert.equal(stuck.limit, limit);
      assert.equal(stuck.minutes, limit + 1);
      assert.ok(stuck.reason.includes(`sınır ${limit} dk`));
    });
  }

  test('planlı sipariş seçilen saatten ölçülür', () => {
    assert.equal(stuckInfo({ status: 'pending', minutes_in_status: 600, minutes_past_schedule: -120 }), null);
    assert.equal(stuckInfo({ status: 'accepted', minutes_in_status: 600, minutes_past_schedule: 45 }), null);
    const stuck = stuckInfo({ status: 'accepted', minutes_in_status: 5, minutes_past_schedule: 46 });
    assert.equal(stuck.minutes, 46);
    assert.match(stuck.reason, /Planlı saati 46 dakika geçti/);
  });

  test('ödeme bekleyen, bilinmeyen durum ve süresi bilinmeyen sipariş takılı sayılmaz', () => {
    assert.equal(stuckInfo({ status: 'awaiting_payment', minutes_in_status: 9999 }), null);
    assert.equal(stuckInfo({ status: 'toString', minutes_in_status: 9999 }), null);
    assert.equal(stuckInfo({ status: 'pending', minutes_in_status: null }), null);
  });

  test('takılanlar başa gelir, en çok aşan önce; girdi değişmez', () => {
    const orders = [
      { id: 'taze', status: 'pending', minutes_in_status: 2 },
      { id: 'biraz', status: 'ready', minutes_in_status: 35 },
      { id: 'cok', status: 'pending', minutes_in_status: 60 },
      { id: 'odeme', status: 'awaiting_payment', minutes_in_status: 20 },
    ];
    assert.deepEqual(sortLiveOrders(orders).map((o) => o.id), ['cok', 'biraz', 'odeme', 'taze']);
    assert.equal(orders[0].id, 'taze');
  });
});

describe('küçük düzeltmeler', () => {
  test('gelir bahşişi içermez', () => {
    assert.equal(orderSalesCents({ total_cents: 13500, tip_cents: 2000 }), 11500);
    assert.equal(orderSalesCents({ total_cents: 13500 }), 13500);
    assert.equal(orderSalesCents({ total_cents: 13500, tip_cents: null }), 13500);
    for (const path of ['app/(seller)/analytics.tsx', 'app/(seller)/dashboard.tsx']) {
      assert.ok(!read(path).includes('s + o.total_cents'), path);
    }
    assert.ok(read('app/(seller)/dashboard.tsx').includes('revenue += orderSalesCents(o)'));
  });

  test('satış sözleşmesi planlı siparişi de doğru anlatır', () => {
    const terms = read('app/(customer)/sales-terms.tsx');
    assert.match(terms, /İleri tarihli siparişte restoran kapalıysa siparişini açılınca yanıtlar/);
  });

  test('gizlilik metni ölçümü anlatır, "kimliğinizi belirleyemez" demez', () => {
    const privacy = read('app/(customer)/privacy.tsx');
    assert.match(privacy, /Kullanım Ölçümü/);
    assert.ok(!privacy.includes('kimliğinizi belirlemek için kullanılamaz'));
  });

  test('yeni ekranlar gizli ve panelden açılır', () => {
    const layout = read('app/(admin)/_layout.tsx');
    const dashboard = read('app/(admin)/dashboard.tsx');
    for (const route of ['funnel', 'live', 'fraud']) {
      assert.ok(layout.includes(`name="${route}" options={{ href: null }}`), route);
      assert.ok(dashboard.includes(`'/(admin)/${route}'`), route);
    }
  });

  test('canlıya alma listesinde 035 var', () => {
    assert.match(read('docs/CANLIYA-ALMA.md'), /`034`, `035`[,.]/);
  });
});
