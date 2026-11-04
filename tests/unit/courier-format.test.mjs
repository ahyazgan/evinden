import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageSeconds,
  COURIER_STALE_MS,
  courierStatusLine,
  formatAge,
  formatDistance,
  isLocationStale,
  openStreetMapUrl,
  parseCourierLocation,
} from '../../lib/courier-format.ts';
import { coordsDistanceKm, nearbyPoint } from '../../lib/geo.ts';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const at = (seconds) => ({ updatedAt: ago(seconds) });

describe('mesafe metni', () => {
  test('bir kilometrenin altı metre, onluğa yuvarlı', () => {
    assert.equal(formatDistance(0.85), '850 m');
    assert.equal(formatDistance(0.123), '120 m');
    assert.equal(formatDistance(0.001), '10 m');
  });
  test('sınırda 1000 m yazılmaz', () => {
    assert.equal(formatDistance(0.999), '1,0 km');
  });
  test('virgüllü kilometre, ondan sonra tam sayı', () => {
    assert.equal(formatDistance(1.2), '1,2 km');
    assert.equal(formatDistance(9.97), '10 km');
    assert.equal(formatDistance(12.4), '12 km');
  });
});

describe('süre metni', () => {
  test('saniye, dakika, saat', () => {
    assert.equal(formatAge(0), 'az önce');
    assert.equal(formatAge(20), '20 sn önce');
    assert.equal(formatAge(60), '1 dk önce');
    assert.equal(formatAge(3700), '1 saat önce');
  });
  test('saat farkında eksi çıkmaz', () => {
    assert.equal(ageSeconds(ago(-30), NOW), 0);
  });
});

describe('bayat konum', () => {
  test('tam iki dakika bayat değil, sonrası bayat', () => {
    assert.equal(COURIER_STALE_MS, 120000);
    assert.equal(isLocationStale(ago(120), NOW), false);
    assert.equal(isLocationStale(ago(121), NOW), true);
  });
  test('okunamayan tarih bayat sayılır', () => {
    assert.equal(isLocationStale('bozuk', NOW), true);
  });
});

describe('teslimat noktası', () => {
  const courier = { latitude: 40.99, longitude: 29.03 };
  test('yakın nokta kullanılır', () => {
    const near = { latitude: 41.0, longitude: 29.03 };
    assert.deepEqual(nearbyPoint(courier, near), near);
    assert.equal(formatDistance(coordsDistanceKm(courier, near)), '1,1 km');
  });
  test('adres yanlış şehre düştüyse gösterilmez', () => {
    assert.equal(nearbyPoint(courier, { latitude: 39.92, longitude: 32.85 }), null);
  });
  test('nokta yoksa boş', () => {
    assert.equal(nearbyPoint(courier, null), null);
  });
});

describe('müşterinin okuduğu satır', () => {
  test('konum yoksa açıkça söylenir', () => {
    assert.equal(courierStatusLine(null, null, NOW), 'Kurye konumu henüz gelmedi');
  });
  test('mesafe ve süre', () => {
    assert.equal(courierStatusLine(at(20), 1.2, NOW), 'Kurye 1,2 km uzakta · 20 sn önce');
  });
  test('teslimat noktası bilinmiyorsa mesafe uydurulmaz', () => {
    assert.equal(courierStatusLine(at(20), null, NOW), 'Kurye yolda · 20 sn önce');
  });
  test('bayat konumda mesafe yazılmaz', () => {
    assert.equal(courierStatusLine(at(300), 1.2, NOW), 'Kurye konumu güncel değil · 5 dk önce');
  });
});

describe('veritabanı satırı', () => {
  const row = { order_id: 'o1', lat: '40.990000', lng: 29.03, heading: null, updated_at: ago(1) };
  test('metin gelen sayılar çevrilir', () => {
    const parsed = parseCourierLocation(row);
    assert.equal(parsed.latitude, 40.99);
    assert.equal(parsed.longitude, 29.03);
    assert.equal(parsed.heading, null);
  });
  test('eksik ya da bozuk satır boş döner', () => {
    assert.equal(parseCourierLocation(null), null);
    assert.equal(parseCourierLocation({}), null);
    assert.equal(parseCourierLocation({ ...row, lat: 'x' }), null);
  });
});

test('harita bağlantısı', () => {
  assert.equal(openStreetMapUrl(40.99, 29.03), 'https://www.openstreetmap.org/?mlat=40.99&mlon=29.03');
});
