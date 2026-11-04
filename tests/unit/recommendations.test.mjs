import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { favouriteCategories, recommend, timeSlot } from '../../lib/recommendations.ts';

// 2026-11-04 19:00 İstanbul: akşam
const NOW = new Date('2026-11-04T16:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
/** O gün İstanbul saatiyle `hour`'da verilmiş sipariş. */
const atHour = (daysBack, hour) => {
  const d = new Date(NOW.getTime() - daysBack * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 3)).toISOString();
};
const order = (sellerId, createdAt = ago(1), categories = []) => ({ sellerId, createdAt, categories });
const open = (...ids) => ids.map((id) => ({ id, open: true }));

describe('saf modül', () => {
  test('React Native ve depolama içe aktarmaz, rastgelelik yoktur', () => {
    const src = readFileSync(new URL('../../lib/recommendations.ts', import.meta.url), 'utf8');
    // 035: kategori adları tek kaynaktan geliyor. O dosya da saf, başka içe aktarma yok.
    const imports = [...src.matchAll(/^\s*import\s.*from\s+'([^']+)'/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['./menu-categories.ts']);
    const categories = readFileSync(new URL('../../lib/menu-categories.ts', import.meta.url), 'utf8');
    assert.ok(!/^\s*import\s/m.test(categories));
    assert.ok(!src.includes('Math.random'));
  });
});

describe('zaman dilimi', () => {
  test('İstanbul saatine göre', () => {
    assert.equal(timeSlot(new Date('2026-11-04T05:00:00Z')), 'sabah'); // 08:00
    assert.equal(timeSlot(new Date('2026-11-04T09:30:00Z')), 'öğle'); // 12:30
    assert.equal(timeSlot(NOW), 'akşam'); // 19:00
    assert.equal(timeSlot(new Date('2026-11-04T21:00:00Z')), 'gece'); // 00:00
  });
});

describe('geçmiş', () => {
  test('geçmiş yoksa bölüm boştur, kategori eşleşmesi olsa bile', () => {
    assert.deepEqual(recommend({
      orders: [],
      sellers: open('a'),
      categoryMatches: [{ sellerId: 'a', category: 'ana' }],
      now: NOW,
    }), []);
  });

  test('neden gerçek sipariş sayısıdır', () => {
    const r = recommend({ orders: [order('a', atHour(2, 12)), order('a', atHour(9, 8))], sellers: open('a'), now: NOW });
    assert.equal(r[0].reason, '2 kez sipariş verdin');
  });

  test('bir kez sipariş verilen restoran için "kez" sayılmaz', () => {
    const r = recommend({ orders: [order('a', atHour(2, 12))], sellers: open('a'), now: NOW });
    assert.equal(r[0].reason, 'Daha önce sipariş verdin');
  });

  test('saat ipucu yalnızca siparişlerin çoğu şu anki dilimdeyse yazılır', () => {
    const most = [order('a', atHour(1, 19)), order('a', atHour(2, 20)), order('a', atHour(3, 12))];
    assert.equal(recommend({ orders: most, sellers: open('a'), now: NOW })[0].reason, '3 kez sipariş verdin, genelde akşam');

    const half = [order('b', atHour(1, 19)), order('b', atHour(2, 20)), order('b', atHour(3, 12)), order('b', atHour(4, 13))];
    assert.equal(recommend({ orders: half, sellers: open('b'), now: NOW })[0].reason, '4 kez sipariş verdin');

    assert.equal(recommend({ orders: [order('c', atHour(1, 19))], sellers: open('c'), now: NOW })[0].reason, 'Daha önce akşam sipariş verdin');
  });
});

describe('sıralama', () => {
  test('çok sipariş verilen önce gelir', () => {
    const orders = [order('az', ago(1)), order('cok', ago(5)), order('cok', ago(6)), order('cok', ago(7))];
    assert.deepEqual(recommend({ orders, sellers: open('az', 'cok'), now: NOW }).map((r) => r.sellerId), ['cok', 'az']);
  });

  test('eşit sayıda yakın zamanda sipariş verilen önce gelir', () => {
    const orders = [order('eski', ago(50)), order('yeni', ago(1))];
    assert.deepEqual(recommend({ orders, sellers: open('eski', 'yeni'), now: NOW }).map((r) => r.sellerId), ['yeni', 'eski']);
  });

  test('şu anki saatte sipariş verilen önce gelir', () => {
    const orders = [order('ogle', atHour(3, 12)), order('aksam', atHour(3, 19))];
    assert.deepEqual(recommend({ orders, sellers: open('ogle', 'aksam'), now: NOW }).map((r) => r.sellerId), ['aksam', 'ogle']);
  });

  test('kapalılar puanı yüksek olsa da en sona gider', () => {
    const orders = [order('kapali', ago(1)), order('kapali', ago(2)), order('kapali', ago(3)), order('acik', ago(40))];
    const r = recommend({ orders, sellers: [{ id: 'kapali', open: false }, { id: 'acik', open: true }], now: NOW });
    assert.deepEqual(r.map((x) => x.sellerId), ['acik', 'kapali']);
    assert.equal(r[1].open, false);
  });

  test('sınır uygulanır, aynı girdi aynı sonucu verir', () => {
    const orders = ['a', 'b', 'c', 'd'].map((id) => order(id, ago(2)));
    const input = { orders, sellers: open('a', 'b', 'c', 'd'), now: NOW, limit: 2 };
    assert.equal(recommend(input).length, 2);
    assert.deepEqual(recommend(input), recommend(input));
  });
});

describe('teslimat alanı', () => {
  test('listede olmayan restoran önerilmez, en çok gidilen olsa da', () => {
    const orders = [order('uzak', ago(1)), order('uzak', ago(2)), order('yakin', ago(3))];
    const r = recommend({ orders, sellers: open('yakin'), now: NOW });
    assert.deepEqual(r.map((x) => x.sellerId), ['yakin']);
  });

  test('geçmişin tamamı alan dışındaysa boş döner', () => {
    assert.deepEqual(recommend({ orders: [order('uzak')], sellers: open('yakin'), now: NOW }), []);
  });
});

describe('kategoriler', () => {
  const orders = [
    order('a', ago(1), ['ana', 'ana', 'corba']),
    order('a', ago(2), ['ana']),
    order('b', ago(3), ['corba', null]),
    order('b', ago(4), ['diger']),
    order('b', ago(5), ['diger', 'tatli']),
  ];

  test('siparişte iki kez geçen bir sayılır; bir kez seçilen ve "Diğer" sayılmaz', () => {
    assert.deepEqual(favouriteCategories(orders), [
      { category: 'ana', orderCount: 2 },
      { category: 'corba', orderCount: 2 },
    ]);
    assert.deepEqual(favouriteCategories([order('a', ago(1), ['ana'])]), []);
  });

  test('gidilmemiş restoran, menüsünde en sevilen kategori varsa gidilenlerin altında çıkar', () => {
    const r = recommend({
      orders,
      sellers: open('a', 'b', 'yeni'),
      categoryMatches: [{ sellerId: 'yeni', category: 'ana' }],
      now: NOW,
    });
    assert.equal(r[r.length - 1].sellerId, 'yeni');
    assert.equal(r[r.length - 1].reason, 'Sık seçtiğin Ana Yemekler burada da var');
  });

  test('sevilmeyen kategori veya menü eşleşmesi yoksa yeni restoran önerilmez', () => {
    const none = recommend({ orders, sellers: open('yeni'), now: NOW });
    assert.deepEqual(none, []);
    const other = recommend({ orders, sellers: open('yeni'), categoryMatches: [{ sellerId: 'yeni', category: 'salata' }], now: NOW });
    assert.deepEqual(other, []);
  });

  test('zaten gidilen restoranın nedeni kategori değil sipariş sayısıdır', () => {
    const r = recommend({ orders, sellers: open('a'), categoryMatches: [{ sellerId: 'a', category: 'ana' }], now: NOW });
    assert.match(r[0].reason, /2 kez sipariş verdin/);
  });

  test('kategori kodu değilse olduğu gibi yazılır', () => {
    const named = [order('a', ago(1), ['Izgaralar']), order('a', ago(2), ['Izgaralar'])];
    const r = recommend({ orders: named, sellers: open('yeni'), categoryMatches: [{ sellerId: 'yeni', category: 'Izgaralar' }], now: NOW });
    assert.equal(r[0].reason, 'Sık seçtiğin Izgaralar burada da var');
  });
});
