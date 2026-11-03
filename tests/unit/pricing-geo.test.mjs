import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { centsToTLInput, DEFAULT_ORDER_PRICING as P, deliveryFeeFor, parseTLToCents, sellerPricing } from '../../lib/pricing.ts';
import { haversineKm, isInDeliveryArea, sellerHasLocation, usableCoords } from '../../lib/geo.ts';

describe('Satıcı fiyatlandırması: sunucuyla aynı kurallar', () => {
  test('ayar yoksa platform varsayılanı', () => {
    assert.deepEqual(sellerPricing({}, P), P);
    assert.deepEqual(sellerPricing(null, P), P);
  });

  test('satıcı ayarı geçerli; sıfır boş sayılmaz', () => {
    const s = sellerPricing({ delivery_fee_cents: 0, free_delivery_threshold_cents: 30000, min_order_cents: 5000 }, P);
    assert.deepEqual(s, { deliveryFeeCents: 0, freeDeliveryThresholdCents: 30000, minOrderCents: 5000 });
  });

  test('minimum siparişte platform ve satıcıdan büyük olan geçerli', () => {
    assert.equal(sellerPricing({ min_order_cents: 1000 }, { ...P, minOrderCents: 2000 }).minOrderCents, 2000);
  });

  test('teslimat ücreti: limit dahil ücretsiz, kupon ücretsiz', () => {
    assert.equal(deliveryFeeFor(14999, P, false), 1500);
    assert.equal(deliveryFeeFor(15000, P, false), 0);
    assert.equal(deliveryFeeFor(100, P, true), 0);
  });
});

describe('Tutar girişi', () => {
  test('geçerli biçimler', () => {
    assert.equal(parseTLToCents('15'), 1500);
    assert.equal(parseTLToCents('15,5'), 1550);
    assert.equal(parseTLToCents(' 15.50 '), 1550);
    assert.equal(parseTLToCents('0'), 0);
    assert.equal(parseTLToCents('19,99'), 1999);
  });

  test('boş null, geçersiz undefined', () => {
    assert.equal(parseTLToCents(''), null);
    assert.equal(parseTLToCents('   '), null);
    for (const bad of ['abc', '-5', '1,234', '1.2.3', '12,345']) assert.equal(parseTLToCents(bad), undefined, bad);
  });

  test('kuruştan metne ve geri', () => {
    assert.equal(centsToTLInput(null), '');
    assert.equal(centsToTLInput(1500), '15');
    assert.equal(centsToTLInput(1550), '15,50');
    for (const c of [0, 1, 99, 1500, 1999]) assert.equal(parseTLToCents(centsToTLInput(c)), c);
  });
});

describe('Konum', () => {
  test('sunucudaki hesapla aynı büyüklük: İstanbul-Ankara', () => {
    assert.ok(Math.abs(haversineKm(41.0082, 28.9784, 39.9334, 32.8597) - 351) < 5);
    assert.equal(haversineKm(41, 29, 41, 29), 0);
  });

  test('alan denetimi; veritabanından metin gelen sayılar', () => {
    const s = { latitude: '40.9906', longitude: '29.0239', delivery_radius_km: '5.0' };
    assert.equal(sellerHasLocation(s), true);
    assert.equal(isInDeliveryArea(s, { latitude: 41.0, longitude: 29.03 }), true);
    assert.equal(isInDeliveryArea(s, { latitude: 41.1, longitude: 29.03 }), false);
  });

  test('konum bilinmiyorsa engellenmez', () => {
    assert.equal(isInDeliveryArea({ latitude: null, longitude: null }, { latitude: 41, longitude: 29 }), true);
    assert.equal(isInDeliveryArea({ latitude: 41, longitude: 29 }, null), true);
  });

  test('yarıçap yoksa varsayılan kullanılır', () => {
    assert.equal(isInDeliveryArea({ latitude: 41, longitude: 29 }, { latitude: 41.05, longitude: 29 }), true);
    assert.equal(isInDeliveryArea({ latitude: 41, longitude: 29 }, { latitude: 41.2, longitude: 29 }), false);
  });

  test('elle seçilmiş 0,0 konum gerçek sayılmaz', () => {
    assert.equal(usableCoords({ latitude: 0, longitude: 0 }), null);
    assert.equal(usableCoords(null), null);
    assert.deepEqual(usableCoords({ latitude: 41, longitude: 29 }), { latitude: 41, longitude: 29 });
  });
});
