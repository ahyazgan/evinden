import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTRICTS, POPULAR_DISTRICTS, findDistrict, foldTr, nearestDistrict, normalizeSavedLocation, searchDistricts,
} from '../../lib/districts.ts';
import { isInDeliveryArea, usableCoords } from '../../lib/geo.ts';

describe('ilçe listesi', () => {
  test('koordinatlar Türkiye sınırları içinde', () => {
    for (const d of DISTRICTS) {
      assert.ok(d.latitude > 35.8 && d.latitude < 42.2, `${d.district} ${d.city}`);
      assert.ok(d.longitude > 25.6 && d.longitude < 44.9, `${d.district} ${d.city}`);
    }
  });
  test('ilçe ve şehir ikilisi tekrar etmez', () => {
    const keys = DISTRICTS.map(d => `${d.district}|${d.city}`);
    assert.equal(new Set(keys).size, keys.length);
  });
  test('81 ilin hepsi var', () => {
    assert.equal(new Set(DISTRICTS.map(d => d.city)).size, 81);
  });
  test('İstanbul\'un 39 ilçesi var', () => {
    assert.equal(DISTRICTS.filter(d => d.city === 'İstanbul').length, 39);
  });
  test('popüler bölgeler listede', () => {
    assert.equal(POPULAR_DISTRICTS.length, 8);
    assert.ok(POPULAR_DISTRICTS.every(Boolean));
  });
});

describe('ilçe arama', () => {
  const names = q => searchDistricts(q).map(d => d.district);
  test('boş aramada popüler bölgeler gelir', () => {
    assert.deepEqual(searchDistricts('  '), POPULAR_DISTRICTS);
  });
  test('Türkçe harfsiz ve büyük harfli yazım bulur', () => {
    assert.equal(names('kadikoy')[0], 'Kadıköy');
    assert.equal(names('KADIKÖY')[0], 'Kadıköy');
    assert.equal(names('uskudar')[0], 'Üsküdar');
    assert.equal(names('ISTANBUL').length, 30);
  });
  test('eskiden bulunamayan ilçeler bulunur', () => {
    for (const q of ['Maltepe', 'Ataşehir', 'Bornova', 'Keçiören']) assert.equal(names(q)[0], q);
  });
  test('şehir adıyla il merkezi bulunur', () => {
    assert.deepEqual(searchDistricts('Sivas')[0], findDistrict('Merkez', 'Sivas'));
  });
  test('adı aramayla başlayan öne gelir', () => {
    assert.equal(names('kar')[0], 'Kartal');
  });
  test('olmayan yer boş döner', () => {
    assert.deepEqual(searchDistricts('zzzz'), []);
  });
  test('İ ve I ayrımı aramayı bozmaz', () => {
    assert.equal(foldTr('İZMİR'), 'izmir');
    assert.equal(foldTr('Iğdır'), 'igdir');
  });
});

describe('en yakın ilçe', () => {
  test('Moda Kadıköy çıkar', () => {
    assert.equal(nearestDistrict(40.99, 29.03).district, 'Kadıköy');
  });
  test('İzmir merkezi Konak çıkar', () => {
    assert.equal(nearestDistrict(38.42, 27.14).district, 'Konak');
  });
});

describe('eski konum kayıtları', () => {
  test('0,0 kaydedilen elle seçim koordinat kazanır', () => {
    const loc = normalizeSavedLocation({ district: 'Konak', city: 'İzmir', latitude: 0, longitude: 0 });
    assert.ok(usableCoords(loc));
    assert.equal(loc.latitude, 38.418);
  });
  test('Bilinmeyen ad en yakın ilçeyle değişir, koordinat korunur', () => {
    const loc = normalizeSavedLocation({ district: 'Bilinmeyen', city: 'Bilinmeyen', latitude: 40.99, longitude: 29.03 });
    assert.equal(loc.district, 'Kadıköy');
    assert.equal(loc.city, 'İstanbul');
    assert.equal(loc.latitude, 40.99);
  });
  test('sağlam kayıt değişmez', () => {
    const loc = { district: 'Moda', city: 'İstanbul', latitude: 40.98, longitude: 29.02 };
    assert.equal(normalizeSavedLocation(loc), loc);
  });
  test('listede olmayan eski seçim olduğu gibi kalır', () => {
    const loc = { district: 'Yok', city: 'Yer', latitude: 0, longitude: 0 };
    assert.deepEqual(normalizeSavedLocation(loc), loc);
    assert.equal(usableCoords(loc), null);
  });
});

describe('seçim teslimat alanını etkiler', () => {
  const moda = { latitude: 40.994, longitude: 29.034, delivery_radius_km: 10 };
  const coords = (d, c) => usableCoords(findDistrict(d, c));
  test('Kadıköy\'deki restoran Kadıköy seçilince görünür', () => {
    assert.equal(isInDeliveryArea(moda, coords('Kadıköy', 'İstanbul')), true);
  });
  test('İzmir seçilince görünmez', () => {
    assert.equal(isInDeliveryArea(moda, coords('Konak', 'İzmir')), false);
  });
});
