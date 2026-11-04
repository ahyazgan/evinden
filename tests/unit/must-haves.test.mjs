import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLERGENS, allergenLabels, allergenSummary, toggleAllergen } from '../../lib/allergens.ts';
import { normalizeTrPhone } from '../../lib/phone.ts';
import { notificationRoute } from '../../lib/notification-route.ts';

describe('alerjen', () => {
  test('listesi veritabanı kısıtıyla aynı', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/031_must_haves.sql', import.meta.url), 'utf8');
    for (const a of ALLERGENS) assert.ok(sql.includes(`'${a.key}'`), a.key);
    assert.equal(ALLERGENS.length, 14);
  });
  test('belirtilmedi ile içermiyor ayrı söylenir', () => {
    assert.match(allergenSummary(null), /girilmedi/);
    assert.match(allergenSummary(undefined), /girilmedi/);
    assert.match(allergenSummary([]), /içermiyor/);
    assert.equal(allergenSummary(['gluten', 'milk']), 'İçerir: Gluten, Süt');
  });
  test('bilinmeyen anahtar atlanır', () => {
    assert.equal(allergenLabels(['gluten', 'yok']), 'Gluten');
  });
  test('seçim açılıp kapanır', () => {
    assert.deepEqual(toggleAllergen(null, 'egg'), ['egg']);
    assert.deepEqual(toggleAllergen(['egg'], 'egg'), []);
    assert.deepEqual(toggleAllergen(['egg'], 'milk'), ['egg', 'milk']);
  });
});

describe('telefon biçimi', () => {
  test('yaygın yazımlar kabul edilir', () => {
    for (const v of ['05321234567', '5321234567', '905321234567', '+90 532 123 45 67', '0532 123 45 67']) {
      assert.equal(normalizeTrPhone(v), '+905321234567', v);
    }
  });
  test('geçersizler reddedilir', () => {
    for (const v of ['', '12345', '02161234567', '+15551234567', '053212345678']) {
      assert.equal(normalizeTrPhone(v), null, v);
    }
  });
});

describe('destek bildirimi', () => {
  test('role göre doğru ekrana gider', () => {
    assert.equal(notificationRoute('support', { ticketId: 'x' }, 'admin'), '/(admin)/support');
    assert.equal(notificationRoute('support', { ticketId: 'x' }, 'customer'), '/(customer)/help');
    assert.equal(notificationRoute('support', { ticketId: 'x' }, 'seller'), '/(customer)/help');
  });
});
