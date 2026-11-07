import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { centsToPriceStr, choicesToPayload, choicesUnchanged, moveItem, parsePriceStr } from '../../lib/menu-choices.ts';
import { groupMenu, sortMenuItems, UNSECTIONED_TITLE } from '../../lib/menu-sections.ts';

const draft = (label, priceStr, extra = {}) => ({ id: null, key: label, label, priceStr, isAvailable: true, ...extra });

describe('fiyat metni', () => {
  test('virgüllü, noktalı ve tam sayı okunur; geçersiz reddedilir', () => {
    assert.equal(parsePriceStr('12,50'), 1250);
    assert.equal(parsePriceStr('12.5'), 1250);
    assert.equal(parsePriceStr(' 45 '), 4500);
    assert.equal(parsePriceStr('0'), 0);
    for (const v of ['', '-1', '12,345', 'abc', '1e3', '12,5,0']) assert.equal(parsePriceStr(v), null, v);
    assert.equal(centsToPriceStr(4500), '45');
    assert.equal(centsToPriceStr(1250), '12,50');
  });
});

describe('seçenek listesi', () => {
  test('sıra korunur, kimlik yalnızca kayıtlı satırda gider', () => {
    const r = choicesToPayload('extra', [draft('Sos', ''), draft('Peynir', '7,5', { id: 'e1', isAvailable: false })]);
    assert.deepEqual(r, { rows: [
      { label: 'Sos', price_cents: 0, is_available: true },
      { id: 'e1', label: 'Peynir', price_cents: 750, is_available: false },
    ] });
  });

  test('porsiyon fiyatı boş veya 0 olamaz; aynı ad iki kez olamaz; boş ad olamaz', () => {
    assert.ok('error' in choicesToPayload('portion', [draft('Tek', '')]));
    assert.ok('error' in choicesToPayload('portion', [draft('Tek', '0')]));
    assert.ok('error' in choicesToPayload('variant', [draft('Acılı', '0'), draft('ACILI', '0')]));
    assert.ok('error' in choicesToPayload('extra', [draft('  ', '1')]));
    assert.ok('error' in choicesToPayload('extra', [draft('Sos', '-2')]));
    assert.deepEqual(choicesToPayload('variant', []), { rows: [] });
  });

  test('değişiklik yoksa kayıt atlanır; sıra değişimi değişiklik sayılır', () => {
    const a = [draft('A', '1', { id: 'a' }), draft('B', '2', { id: 'b' })];
    assert.equal(choicesUnchanged('extra', a, a.map(x => ({ ...x }))), true);
    assert.equal(choicesUnchanged('extra', a, [a[1], a[0]]), false);
    assert.equal(choicesUnchanged('extra', a, [a[0], { ...a[1], isAvailable: false }]), false);
    assert.equal(choicesUnchanged('extra', a, [a[0], { ...a[1], priceStr: '2,00' }]), true, 'aynı tutar');
  });

  test('taşıma sınırda bir şey yapmaz', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  });
});

describe('menü bölümleri', () => {
  const items = [
    { id: 1, section_id: 's2', sort_order: 1, created_at: '2026-01-01', category: 'Ana yemek' },
    { id: 2, section_id: null, sort_order: 0, created_at: '2026-01-02', category: 'Tatlı' },
    { id: 3, section_id: 's1', sort_order: 2, created_at: '2026-01-03', category: 'Ana yemek' },
    { id: 4, section_id: 's2', sort_order: 0, created_at: '2026-01-04', category: 'İçecek' },
  ];

  test('bölüm varsa bölüm sırası, içinde ürün sırası; bölümsüzler sonda', () => {
    const sections = [{ id: 's1', title: 'Kebaplar', sort_order: 1 }, { id: 's2', title: 'Kampanyalar', sort_order: 0 }, { id: 's3', title: 'Boş', sort_order: 2 }];
    const groups = groupMenu(items, sections);
    assert.deepEqual(groups.map(g => [g.title, g.items.map(i => i.id)]), [
      ['Kampanyalar', [4, 1]],
      ['Kebaplar', [3]],
      [UNSECTIONED_TITLE, [2]],
    ]);
  });

  test('bölüm yoksa kategoriye göre, ilk görülme sırasıyla', () => {
    const groups = groupMenu(items, []);
    assert.deepEqual(groups.map(g => [g.title, g.items.map(i => i.id)]), [
      ['Tatlı', [2]],
      ['İçecek', [4]],
      ['Ana yemek', [1, 3]],
    ]);
  });

  test('eşit sırada eklenme zamanı belirler', () => {
    const sorted = sortMenuItems([{ id: 'b', sort_order: 0, created_at: '2026-02' }, { id: 'a', sort_order: 0, created_at: '2026-01' }]);
    assert.deepEqual(sorted.map(i => i.id), ['a', 'b']);
  });
});
