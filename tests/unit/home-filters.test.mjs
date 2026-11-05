import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CUISINES, MAX_SELLER_CUISINES, cuisineLabels, toggleCuisine } from '../../lib/cuisines.ts';
import {
  EMPTY_FILTERS, activeFilterCount, campaignCountdown, cuisineCounts, formatKm, formatRatingCount,
  isLocalFavorite, matchesFilters, sortSellers,
} from '../../lib/home-filters.ts';

const seller = (over = {}) => ({
  id: 'a', name: 'Ali', cuisines: [], open: true, hasCampaign: false, ratingAvg: 0, ratingCount: 0,
  timeMax: 40, minOrderCents: 0, deliveryFeeCents: 2000, mealCards: false, pickup: false, km: null, ...over,
});
const passes = (s, f) => matchesFilters(s, { ...EMPTY_FILTERS, ...f });

describe('mutfaklar', () => {
  test('liste veritabanı kısıtıyla aynı', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/043_cuisines.sql', import.meta.url), 'utf8');
    for (const c of CUISINES) assert.ok(sql.includes(`'${c.id}'`), c.id);
    assert.equal((sql.match(/'[a-z]+'/g) ?? []).length, CUISINES.length);
  });
  test('sınır dolunca yenisi eklenmez, çıkarmak serbest', () => {
    const full = ['doner', 'burger', 'pizza'];
    assert.equal(full.length, MAX_SELLER_CUISINES);
    assert.deepEqual(toggleCuisine(full, 'kebap'), full);
    assert.deepEqual(toggleCuisine(full, 'burger'), ['doner', 'pizza']);
  });
  test('bilinmeyen anahtar atlanır, boş liste boş yazı verir', () => {
    assert.equal(cuisineLabels(['doner', 'yok', 'pide']), 'Döner, Pide & Lahmacun');
    assert.equal(cuisineLabels(null), '');
  });
  test('sayım yalnızca var olanları, çok olan önce verir', () => {
    assert.deepEqual(cuisineCounts([{ cuisines: ['pizza'] }, { cuisines: ['doner', 'pizza'] }]), [
      { id: 'pizza', count: 2 }, { id: 'doner', count: 1 },
    ]);
  });
});

describe('filtreler', () => {
  test('mutfaklardan biri tutması yeter', () => {
    assert.equal(passes(seller({ cuisines: ['doner'] }), { cuisines: ['doner', 'pizza'] }), true);
    assert.equal(passes(seller({ cuisines: ['kebap'] }), { cuisines: ['doner'] }), false);
  });
  test('puanı olmayan restoran puan filtresinden geçmez', () => {
    assert.equal(passes(seller(), { minRating: 4 }), false);
    assert.equal(passes(seller({ ratingAvg: 4.2, ratingCount: 3 }), { minRating: 4 }), true);
    assert.equal(passes(seller({ ratingAvg: 4.2, ratingCount: 3 }), { minRating: 4.5 }), false);
  });
  test('uzaklığı bilinmeyen restoran uzaklık filtresinden geçmez', () => {
    assert.equal(passes(seller(), { maxKm: 2 }), false);
    assert.equal(passes(seller({ km: 1.5 }), { maxKm: 2 }), true);
  });
  test('ücretsiz teslimat, ücreti belirtilmemiş olanı kapsamaz', () => {
    assert.equal(passes(seller({ deliveryFeeCents: null }), { freeDelivery: true }), false);
    assert.equal(passes(seller({ deliveryFeeCents: 0 }), { freeDelivery: true }), true);
  });
  test('sınır değerler dahildir', () => {
    assert.equal(passes(seller({ minOrderCents: 20000 }), { maxMinOrderCents: 20000 }), true);
    assert.equal(passes(seller({ timeMax: 30 }), { maxMinutes: 30 }), true);
    assert.equal(passes(seller({ timeMax: 31 }), { maxMinutes: 30 }), false);
  });
  test('sıralama filtre sayılmaz', () => {
    assert.equal(activeFilterCount({ ...EMPTY_FILTERS, sort: 'rating' }), 0);
    assert.equal(activeFilterCount({ ...EMPTY_FILTERS, open: true, cuisines: ['doner', 'pizza'], maxKm: 2 }), 4);
  });
  test('favori rozeti az puanla verilmez', () => {
    assert.equal(isLocalFavorite(5, 3), false);
    assert.equal(isLocalFavorite(4.5, 50), true);
    assert.equal(isLocalFavorite(4.4, 500), false);
  });
});

describe('sıralama', () => {
  const ids = (list, sort) => sortSellers(list, sort).map(s => s.id);
  test('alfabetik Türkçe sırayla gider', () => {
    assert.deepEqual(ids([seller({ id: 'z', name: 'Zeki' }), seller({ id: 'c', name: 'Çiğköfteci' }), seller({ id: 'd', name: 'Dürüm' })], 'alphabetical'), ['c', 'd', 'z']);
  });
  test('yakınlıkta uzaklığı bilinmeyen sona düşer', () => {
    assert.deepEqual(ids([seller({ id: 'x' }), seller({ id: 'y', km: 3 }), seller({ id: 'z', km: 1 })], 'nearest'), ['z', 'y', 'x']);
  });
  test('önerilende kapalı restoran açık olanın önüne geçmez', () => {
    assert.deepEqual(ids([seller({ id: 'k', open: false, km: 0.1 }), seller({ id: 'a', open: true, km: 5 })], 'recommended'), ['a', 'k']);
  });
  test('puan eşitse çok değerlendirilen öne geçer', () => {
    assert.deepEqual(ids([seller({ id: 'a', ratingAvg: 4.5, ratingCount: 2 }), seller({ id: 'b', ratingAvg: 4.5, ratingCount: 90 })], 'rating'), ['b', 'a']);
  });
  test('özgün liste değişmez', () => {
    const list = [seller({ id: 'b', name: 'B' }), seller({ id: 'a', name: 'A' })];
    sortSellers(list, 'alphabetical');
    assert.equal(list[0].id, 'b');
  });
});

describe('biçimler', () => {
  test('uzaklık', () => {
    assert.equal(formatKm(0.76), '800 m');
    assert.equal(formatKm(0.01), '100 m');
    assert.equal(formatKm(2.74), '2,7 km');
  });
  test('değerlendirme sayısı', () => {
    assert.equal(formatRatingCount(12), '12');
    assert.equal(formatRatingCount(126), '100+');
    assert.equal(formatRatingCount(3712), '3700+');
  });
  test('geri sayım yalnızca son 24 saatte ve gerçek tarihle çıkar', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    assert.equal(campaignCountdown('2026-11-05T15:12:45Z', now), '03:12:45');
    assert.equal(campaignCountdown('2026-11-07T12:00:00Z', now), null);
    assert.equal(campaignCountdown('2026-11-05T11:00:00Z', now), null);
    assert.equal(campaignCountdown(null, now), null);
    assert.equal(campaignCountdown('tarih değil', now), null);
  });
});
