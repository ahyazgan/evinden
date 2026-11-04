import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayoutCsv, formatIban, normalizeTurkishIban, orderBalanceCents, orderNetCents, periodRange } from '../../lib/earnings.ts';

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

describe('Pazaryeri siparişi', () => {
  const base = { subtotal_cents: 10000, delivery_fee_cents: 1500, commission_cents: 800, total_cents: 11500 };

  test('hak değişmez, elle ödenecek bakiye sıfırdır', () => {
    for (const marketplace_status of ['held', 'approved', 'reversed']) {
      const o = { ...base, payment_method: 'online', marketplace_status };
      assert.equal(orderNetCents(o), 10700);
      assert.equal(orderBalanceCents(o), 0);
    }
  });

  test('alan boşsa bugünkü hesap', () => {
    assert.equal(orderBalanceCents({ ...base, payment_method: 'online', marketplace_status: null }), 10700);
    assert.equal(orderBalanceCents({ ...base, payment_method: 'cash', marketplace_status: null }), -800);
  });
});

describe('Ödeme listesi', () => {
  const row = (over = {}) => ({
    display_name: 'Lokanta', account_name: 'Lokanta Gıda Ltd.', iban: 'TR330006100519786457841326', balance_cents: 10700, order_count: 3, ...over,
  });
  const lines = csv => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

  test('yalnızca platformun borçlu olduğu satıcılar girer', () => {
    const r = buildPayoutCsv([row(), row({ display_name: 'Borçlu', balance_cents: -800 }), row({ display_name: 'Sıfır', balance_cents: 0 })]);
    assert.equal(r.count, 1);
    assert.equal(r.totalCents, 10700);
    assert.deepEqual(lines(r.csv), [
      'Restoran;Hesap sahibi;IBAN;Tutar (TL);Sipariş sayısı',
      'Lokanta;Lokanta Gıda Ltd.;TR330006100519786457841326;107,00;3',
    ]);
  });

  test('tutar kuruştan yazılır, kayan nokta hatası olmaz', () => {
    const amount = c => lines(buildPayoutCsv([row({ balance_cents: c })]).csv)[1].split(';')[3];
    assert.equal(amount(1), '0,01');
    assert.equal(amount(1999), '19,99');
    assert.equal(amount(2905), '29,05');
    assert.equal(amount(123456789), '1234567,89');
  });

  test('Excel Türkçe karakteri bozmasın diye BOM ile başlar', () => {
    assert.equal(buildPayoutCsv([row()]).csv.charCodeAt(0), 0xFEFF);
  });

  test('IBAN yoksa boş kalır ve sayılır', () => {
    const r = buildPayoutCsv([row({ iban: null, account_name: null })]);
    assert.equal(r.missingIban, 1);
    assert.equal(lines(r.csv)[1], 'Lokanta;;;107,00;3');
  });

  test('ayraç ve tırnak kaçırılır; ad formül olarak çalışmaz', () => {
    assert.equal(lines(buildPayoutCsv([row({ display_name: 'Ali; "Usta"' })]).csv)[1].split(';Lokanta')[0], '"Ali; ""Usta"""');
    for (const danger of ['=HYPERLINK("x")', '+1', '-1', '@a']) {
      const cell = lines(buildPayoutCsv([row({ display_name: danger })]).csv)[1];
      assert.match(cell, /^"?'/, danger);
    }
  });

  test('boş listede yalnızca başlık vardır', () => {
    const r = buildPayoutCsv([]);
    assert.equal(r.count, 0);
    assert.equal(lines(r.csv).length, 1);
  });
});
