import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cuisineOrder, istanbulMonthHour, neighbourhoodStars, newlyOpened, sortByCuisineOrder } from '../../lib/cuisine-order.ts';
import { CUISINES } from '../../lib/cuisines.ts';

// İstanbul saati UTC+3: 2026-04-15 13:00 İstanbul = 10:00 UTC
const at = (iso) => new Date(iso);

describe('Ne yesek? sırası', () => {
  test('öğlen ve ilkbaharda en çok satanlar önde', () => {
    assert.deepEqual(cuisineOrder(at('2026-04-15T10:00:00Z')).slice(0, 7), ['burger', 'doner', 'pizza', 'kebap', 'pide', 'tavuk', 'cigkofte']);
  });
  test('kışın çorba ve ev yemekleri, yazın dondurma ve kahve dördüncü sıraya çıkar', () => {
    assert.deepEqual(cuisineOrder(at('2026-01-10T10:00:00Z')).slice(0, 5), ['burger', 'doner', 'pizza', 'corba', 'esnaf']);
    assert.deepEqual(cuisineOrder(at('2026-07-10T10:00:00Z')).slice(0, 5), ['burger', 'doner', 'pizza', 'dondurma', 'kahve']);
  });
  test('gece yarısından sonra döner, sabah kahvaltı başta', () => {
    assert.equal(cuisineOrder(at('2026-04-15T22:30:00Z'))[0], 'doner'); // 01:30 İstanbul
    assert.equal(cuisineOrder(at('2026-04-15T05:00:00Z'))[0], 'kahvalti'); // 08:00 İstanbul
    assert.equal(cuisineOrder(at('2026-04-15T15:00:00Z'))[0], 'burger'); // 18:00 İstanbul
  });
  test('İstanbul saati UTC+3', () => {
    assert.deepEqual(istanbulMonthHour(at('2026-12-31T22:00:00Z')), { month: 1, hour: 1 });
  });
  test('her mutfak listede, sıra tekrarsız; bilinmeyen sona gider', () => {
    const order = cuisineOrder(at('2026-04-15T10:00:00Z'));
    assert.equal(new Set(order).size, order.length);
    for (const c of CUISINES) assert.ok(order.includes(c.id), c.id);
    const sorted = sortByCuisineOrder([{ id: 'bilinmeyen' }, { id: 'tatli' }, { id: 'pizza' }], at('2026-04-15T10:00:00Z'));
    assert.deepEqual(sorted.map(x => x.id), ['pizza', 'tatli', 'bilinmeyen']);
  });
});

describe('vitrin satırları', () => {
  const now = at('2026-11-07T12:00:00Z');
  const rows = [
    { id: 'a', ratingAvg: 4.9, ratingCount: 12, createdAt: '2025-01-01' },
    { id: 'b', ratingAvg: 4.9, ratingCount: 300, createdAt: '2026-11-01' },
    { id: 'c', ratingAvg: 4.95, ratingCount: 5, createdAt: '2026-10-20' },
    { id: 'd', ratingAvg: 4.2, ratingCount: 900, createdAt: null },
    { id: 'e', ratingAvg: 4.6, ratingCount: 40, createdAt: '2026-09-01' },
  ];
  test('semtin yıldızları: en az 10 puan ve 4,3 üstü; puan, sonra puanlayan sayısı', () => {
    assert.deepEqual(neighbourhoodStars(rows).map(r => r.id), ['b', 'a', 'e']);
  });
  test('yeni açılanlar: son 30 gün, en yenisi önce', () => {
    assert.deepEqual(newlyOpened(rows, now).map(r => r.id), ['b', 'c']);
  });
});
