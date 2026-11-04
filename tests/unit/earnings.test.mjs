import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatIban, normalizeTurkishIban, orderBalanceCents, orderNetCents, periodRange } from '../../lib/earnings.ts';

describe('Sipariş hesabı', () => {
  const base = { subtotal_cents: 10000, delivery_fee_cents: 1500, commission_cents: 800, total_cents: 11500 };

  test('nakitte para satıcıda: bakiye komisyon kadar eksi', () => {
    assert.equal(orderNetCents({ ...base, payment_method: 'cash' }), 10700);
    assert.equal(orderBalanceCents({ ...base, payment_method: 'cash' }), -800);
    assert.equal(orderBalanceCents({ ...base, payment_method: 'card_door' }), -800);
  });

  test('online ödemede para platformda: bakiye satıcının hakkı', () => {
    assert.equal(orderBalanceCents({ ...base, payment_method: 'online' }), 10700);
  });

  test('satıcı indirimi hakkı düşürür, platform teslimatı artırır', () => {
    assert.equal(orderNetCents({ ...base, seller_discount_cents: 2000 }), 8700);
    assert.equal(orderNetCents({ ...base, delivery_fee_cents: 0, platform_delivery_cents: 1500 }), 10700);
  });
});

describe('Dönem sınırları (İstanbul)', () => {
  test('hafta pazartesi başlar', () => {
    // 2026-11-04 Çarşamba 12:00 İstanbul
    const { from, to } = periodRange('week', new Date('2026-11-04T09:00:00Z'));
    assert.equal(from, '2026-11-01T21:00:00.000Z');
    assert.equal(to, '2026-11-08T21:00:00.000Z');
  });

  test('pazar günü önceki pazartesiye gider', () => {
    assert.equal(periodRange('week', new Date('2026-11-08T09:00:00Z')).from, '2026-11-01T21:00:00.000Z');
  });

  test('UTC ile ay sınırı farklıysa İstanbul takvimi geçerli', () => {
    // UTC 30 Kasım 22:00 = İstanbul 1 Aralık 01:00
    const { from, to } = periodRange('month', new Date('2026-11-30T22:00:00Z'));
    assert.equal(from, '2026-11-30T21:00:00.000Z');
    assert.equal(to, '2026-12-31T21:00:00.000Z');
  });

  test('geçen ay ve yıl dönümü', () => {
    const { from, to } = periodRange('last_month', new Date('2026-01-15T09:00:00Z'));
    assert.equal(from, '2025-11-30T21:00:00.000Z');
    assert.equal(to, '2025-12-31T21:00:00.000Z');
  });
});

describe('IBAN', () => {
  test('geçerli IBAN temizlenir', () => {
    assert.equal(normalizeTurkishIban('TR33 0006 1005 1978 6457 8413 26'), 'TR330006100519786457841326');
    assert.equal(normalizeTurkishIban(' tr330006100519786457841326 '), 'TR330006100519786457841326');
  });

  test('hatalı IBAN reddedilir', () => {
    for (const bad of ['', 'TR33', 'TR330006100519786457841327', 'DE89370400440532013000', 'TR33000610051978645784132X']) {
      assert.equal(normalizeTurkishIban(bad), null, bad);
    }
  });

  test('gruplayarak gösterir', () => {
    assert.equal(formatIban('TR330006100519786457841326'), 'TR33 0006 1005 1978 6457 8413 26');
  });
});
