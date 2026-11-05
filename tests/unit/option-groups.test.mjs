import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  customerGroups,
  formToPayload,
  groupRuleLabel,
  groupsFromRows,
  groupsToForm,
  hasRequiredGroup,
  optionsCanRaisePrice,
  requiredOptionsMin,
  selectedOptionIds,
  selectedOptionsTotal,
  selectionError,
  selectionSummary,
  toggleOption,
} from '../../lib/option-groups.ts';

const opt = (id, priceCents = 0, isAvailable = true) => ({ id, label: id, priceCents, isAvailable });
const drink = { id: 'd', title: 'İçecek', minSelect: 1, maxSelect: 1, options: [opt('kola'), opt('ayran', 1000)] };
const sauce = { id: 's', title: 'Sos', minSelect: 0, maxSelect: 2, options: [opt('ketcap'), opt('mayo', 500), opt('aci', 500)] };
const free = { id: 'f', title: 'Çıkar', minSelect: 0, maxSelect: null, options: [opt('sogan'), opt('tursu')] };

describe('seçim', () => {
  test('tek seçimli grup yenisini alır', () => {
    assert.deepEqual([...toggleOption(new Set(['kola']), drink, 'ayran')], ['ayran']);
  });
  test('zorunlu tek seçim boşaltılamaz, isteğe bağlı boşaltılır', () => {
    assert.deepEqual([...toggleOption(new Set(['kola']), drink, 'kola')], ['kola']);
    const opt1 = { ...drink, minSelect: 0 };
    assert.deepEqual([...toggleOption(new Set(['kola']), opt1, 'kola')], []);
  });
  test('sınır doluysa eklenmez, başka grup etkilenmez', () => {
    const s = toggleOption(new Set(['kola', 'ketcap', 'mayo']), sauce, 'aci');
    assert.deepEqual([...s].sort(), ['ketcap', 'kola', 'mayo']);
  });
  test('sınırsız grup hepsini alır', () => {
    assert.equal(toggleOption(new Set(['sogan']), free, 'tursu').size, 2);
  });
});

describe('denetim ve fiyat', () => {
  test('eksik zorunlu grup söylenir', () => {
    assert.match(selectionError([drink, sauce], new Set()), /İçecek/);
    assert.equal(selectionError([drink, sauce], new Set(['kola'])), null);
  });
  test('fazla seçim reddedilir', () => {
    assert.match(selectionError([sauce], new Set(['ketcap', 'mayo', 'aci'])), /en fazla 2/);
  });
  test('tükenen zorunlu grup engel olur', () => {
    const empty = customerGroups([{ ...drink, options: [opt('kola', 0, false)] }]);
    assert.equal(empty.length, 1);
    assert.match(selectionError(empty, new Set()), /tükendi/);
  });
  test('tükenen isteğe bağlı grup gizlenir', () => {
    assert.equal(customerGroups([{ ...sauce, options: [opt('x', 0, false)] }]).length, 0);
  });
  test('toplam ve özet', () => {
    const sel = new Set(['ayran', 'mayo', 'ketcap']);
    assert.equal(selectedOptionsTotal([drink, sauce], sel), 1500);
    assert.equal(selectionSummary([drink, sauce], sel), 'İçecek: ayran · Sos: ketcap, mayo');
    assert.deepEqual(selectedOptionIds([drink, sauce], sel), ['ayran', 'ketcap', 'mayo']);
  });
  test('listedeki başlangıç fiyatı zorunlu seçimin en ucuzunu sayar', () => {
    assert.equal(requiredOptionsMin([drink, sauce]), 0);
    assert.equal(requiredOptionsMin([{ ...drink, options: [opt('a', 300), opt('b', 100)] }]), 100);
  });
  test('fiyat yükselebilir mi', () => {
    assert.equal(optionsCanRaisePrice([drink]), true);
    assert.equal(optionsCanRaisePrice([free]), false);
    assert.equal(optionsCanRaisePrice([{ ...drink, options: [opt('a', 200), opt('b', 200)] }]), false);
    assert.equal(optionsCanRaisePrice([sauce]), true);
  });
  test('zorunlu grup tanınır', () => {
    assert.equal(hasRequiredGroup([{ id: 'x', title: 't', min_select: 1, max_select: 1, sort_order: 0 }]), true);
    assert.equal(hasRequiredGroup([{ id: 'x', title: 't', min_select: 0, max_select: 1, sort_order: 0 }]), false);
    assert.equal(hasRequiredGroup(null), false);
  });
  test('kural yazısı', () => {
    assert.equal(groupRuleLabel(drink), 'Zorunlu · 1 seç');
    assert.equal(groupRuleLabel(sauce), 'İsteğe bağlı · en fazla 2');
    assert.equal(groupRuleLabel(free), 'İsteğe bağlı');
    assert.equal(groupRuleLabel({ minSelect: 2, maxSelect: null }), 'Zorunlu · en az 2');
    assert.equal(groupRuleLabel({ minSelect: 1, maxSelect: 3 }), 'Zorunlu · 1-3 seç');
  });
});

describe('satıcı formu', () => {
  const form = (over = {}, options = [{ key: 'o', label: 'Ayran', priceStr: '10,50', isAvailable: true }]) => [
    { key: 'g', title: 'İçecek', minStr: '1', maxStr: '1', options, ...over },
  ];
  test('doğru form kayda hazırlanır', () => {
    assert.deepEqual(formToPayload(form()), {
      groups: [{ id: null, title: 'İçecek', min_select: 1, max_select: 1, options: [{ id: null, label: 'Ayran', price_cents: 1050, is_available: true }] }],
    });
  });
  test('boş grup atlanır, boş fiyat ücretsizdir', () => {
    assert.deepEqual(formToPayload(form({ title: '' }, [{ key: 'o', label: '', priceStr: '', isAvailable: true }])), { groups: [] });
    const r = formToPayload(form({}, [{ key: 'o', label: 'Kola', priceStr: '', isAvailable: true }]));
    assert.equal(r.groups[0].options[0].price_cents, 0);
  });
  test('boş en fazla sınırsızdır', () => {
    assert.equal(formToPayload(form({ maxStr: '', minStr: '' })).groups[0].max_select, null);
    assert.equal(formToPayload(form({ maxStr: '', minStr: '' })).groups[0].min_select, 0);
  });
  test('hatalı formlar mesaj döner', () => {
    assert.match(formToPayload(form({ title: ' ' })).error, /ad ver/);
    assert.match(formToPayload(form({ maxStr: '0' })).error, /1'den küçük/);
    assert.match(formToPayload(form({ minStr: '2', maxStr: '1' })).error, /küçük olamaz/);
    assert.match(formToPayload(form({ minStr: '2', maxStr: '' })).error, /seçenek var/);
    assert.match(formToPayload(form({ minStr: 'x' })).error, /tam sayı/);
    assert.match(formToPayload(form({}, [{ key: 'o', label: 'Kola', priceStr: '-1', isAvailable: true }])).error, /geçersiz fiyat/);
    assert.match(formToPayload(form({}, [{ key: 'o', label: '', priceStr: '5', isAvailable: true }])).error, /ad ver/);
    assert.match(formToPayload(form({}, [])).error, /en az bir seçenek/);
  });
  test('kayıttan forma, formdan kayda kimlikler korunur', () => {
    const groups = groupsFromRows([{
      id: 'g1', title: 'İçecek', min_select: 1, max_select: null, sort_order: 0,
      menu_options: [
        { id: 'b', label: 'Kola', price_cents: 0, is_available: true, sort_order: 1 },
        { id: 'a', label: 'Ayran', price_cents: 1050, is_available: false, sort_order: 0 },
      ],
    }]);
    assert.deepEqual(groups[0].options.map(o => o.id), ['a', 'b']);
    const payload = formToPayload(groupsToForm(groups));
    assert.equal(payload.groups[0].id, 'g1');
    assert.deepEqual(payload.groups[0].options[0], { id: 'a', label: 'Ayran', price_cents: 1050, is_available: false });
    assert.equal(payload.groups[0].max_select, null);
  });
});
