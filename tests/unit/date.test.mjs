import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt, istanbulClock, istanbulToday } from '../../lib/date.ts';

const row = (day_of_week, open_time, close_time, is_open = true) => ({ day_of_week, open_time, close_time, is_open });
const at = (dayOfWeek, hh, mm = 0) => ({ dayOfWeek, minutes: hh * 60 + mm });

describe('isOpenAt: sunucudaki seller_open_at ile aynı kurallar', () => {
  test('saat girilmemişse açık', () => {
    assert.equal(isOpenAt([], at(0, 3)), true);
  });

  test('aralık; kapanış dahil değil; saniyeli saat biçimi', () => {
    const hours = [row(0, '09:00:00', '20:00:00')];
    assert.equal(isOpenAt(hours, at(0, 8, 59)), false);
    assert.equal(isOpenAt(hours, at(0, 9)), true);
    assert.equal(isOpenAt(hours, at(0, 19, 59)), true);
    assert.equal(isOpenAt(hours, at(0, 20)), false);
  });

  test('kapalı gün ve kaydı olmayan gün', () => {
    const hours = [row(6, '09:00', '20:00', false)];
    assert.equal(isOpenAt(hours, at(6, 12)), false);
    assert.equal(isOpenAt(hours, at(0, 12)), true);
  });

  test('gece yarısını aşan saatler; Pazar gecesi Pazartesiye taşar', () => {
    const hours = [row(4, '18:00', '02:00'), row(5, '12:00', '15:00'), row(6, '20:00', '01:00')];
    assert.equal(isOpenAt(hours, at(4, 23)), true);
    assert.equal(isOpenAt(hours, at(5, 1, 30)), true);
    assert.equal(isOpenAt(hours, at(5, 2)), false);
    assert.equal(isOpenAt(hours, at(5, 13)), true);
    assert.equal(isOpenAt(hours, at(0, 0, 30)), true);
  });
});

describe('İstanbul saati', () => {
  test('UTC gece yarısından önce İstanbul ertesi gündedir', () => {
    const now = new Date('2026-11-01T22:30:00Z'); // İstanbul: 2 Kasım Pazartesi 01:30
    assert.equal(istanbulToday(now), '2026-11-02');
    assert.deepEqual(istanbulClock(now), { dayOfWeek: 0, minutes: 90 });
  });

  test('Pazar 6 numaradır', () => {
    assert.equal(istanbulClock(new Date('2026-11-08T09:00:00Z')).dayOfWeek, 6);
  });
});
