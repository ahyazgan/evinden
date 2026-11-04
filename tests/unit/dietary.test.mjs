import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  availableFoodFilters,
  DIETARY,
  dietaryLabels,
  foodDetailLabels,
  FOOD_FILTERS,
  lacksAllergen,
  matchesFoodFilter,
  matchesFoodFilters,
  toggleKey,
} from '../../lib/dietary.ts';
import { ALLERGENS } from '../../lib/allergens.ts';

describe('yemek etiketleri', () => {
  test('liste veritabanı kısıtıyla aynı, helal yok', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/034_discovery.sql', import.meta.url), 'utf8');
    const check = sql.match(/dietary <@ ARRAY\[([^\]]+)\]/)[1];
    assert.deepEqual(check.split(',').map((k) => k.replace(/'/g, '').trim()), DIETARY.map((d) => d.key));
    assert.ok(!DIETARY.some((d) => /hal/i.test(d.key)));
  });

  test('arayüz sırası ve adları', () => {
    assert.deepEqual(FOOD_FILTERS.map((f) => f.label), ['Vejetaryen', 'Vegan', 'Glutensiz', 'Sütsüz', 'Acılı']);
  });

  test('türetilen filtrelerin dayandığı alerjenler listede var', () => {
    const keys = ALLERGENS.map((a) => a.key);
    assert.ok(keys.includes('gluten') && keys.includes('milk'));
  });
});

describe('glutensiz ve sütsüz alerjenlerden türer', () => {
  test('bilinmeyen alerjen hiçbir zaman eşleşmez', () => {
    for (const allergens of [null, undefined]) {
      assert.equal(lacksAllergen(allergens, 'gluten'), false);
      assert.equal(matchesFoodFilter({ allergens }, 'gluten_free'), false);
      assert.equal(matchesFoodFilter({ allergens }, 'milk_free'), false);
    }
  });

  test('boş liste "içermiyor" demektir, eşleşir', () => {
    assert.equal(matchesFoodFilter({ allergens: [] }, 'gluten_free'), true);
    assert.equal(matchesFoodFilter({ allergens: [] }, 'milk_free'), true);
  });

  test('listede olan alerjen eşleşmez, olmayan eşleşir', () => {
    const item = { allergens: ['gluten', 'egg'] };
    assert.equal(matchesFoodFilter(item, 'gluten_free'), false);
    assert.equal(matchesFoodFilter(item, 'milk_free'), true);
  });
});

describe('satıcının seçtiği filtreler', () => {
  test('vegan yemek vejetaryen filtresinde de çıkar, tersi olmaz', () => {
    assert.equal(matchesFoodFilter({ dietary: ['vegan'] }, 'vegetarian'), true);
    assert.equal(matchesFoodFilter({ dietary: ['vegetarian'] }, 'vegan'), false);
  });

  test('etiketi olmayan yemek eşleşmez', () => {
    for (const dietary of [[], null, undefined]) {
      assert.equal(matchesFoodFilter({ dietary }, 'spicy'), false);
      assert.equal(matchesFoodFilter({ dietary }, 'vegetarian'), false);
    }
  });

  test('birden çok filtrenin hepsine uymalı; filtre yoksa hepsi geçer', () => {
    const item = { dietary: ['vegan'], allergens: ['gluten'] };
    assert.equal(matchesFoodFilters(item, []), true);
    assert.equal(matchesFoodFilters(item, ['vegan']), true);
    assert.equal(matchesFoodFilters(item, ['vegan', 'gluten_free']), false);
    assert.equal(matchesFoodFilters(item, ['vegan', 'milk_free']), true);
  });

  test('restoran sayfasında yalnızca sonuç verecek filtreler listelenir', () => {
    assert.deepEqual(availableFoodFilters([]), []);
    assert.deepEqual(availableFoodFilters([{ dietary: [], allergens: null }]), []);
    assert.deepEqual(
      availableFoodFilters([{ dietary: ['spicy'], allergens: ['gluten'] }]).map((f) => f.key),
      ['milk_free', 'spicy'],
    );
  });

  test('çip açılır ve kapanır, liste değiştirilmez', () => {
    const start = ['vegan'];
    assert.deepEqual(toggleKey(start, 'spicy'), ['vegan', 'spicy']);
    assert.deepEqual(toggleKey(start, 'vegan'), []);
    assert.deepEqual(start, ['vegan']);
  });
});

describe('etiketler', () => {
  test('satırda satıcının seçtikleri yazılır; vegan varsa vejetaryen yazılmaz', () => {
    assert.deepEqual(dietaryLabels({ dietary: ['spicy', 'vegetarian'] }), ['Vejetaryen', 'Acılı']);
    assert.deepEqual(dietaryLabels({ dietary: ['vegetarian', 'vegan'] }), ['Vegan']);
    assert.deepEqual(dietaryLabels({ dietary: ['bilinmeyen'], allergens: [] }), []);
    assert.deepEqual(dietaryLabels({}), []);
  });

  test('ürün sayfasında alerjenden türeyenler de yazılır; bilinmeyen alerjende yazılmaz', () => {
    assert.deepEqual(foodDetailLabels({ dietary: ['vegan'], allergens: ['gluten'] }), ['Vegan', 'Sütsüz']);
    assert.deepEqual(foodDetailLabels({ dietary: [], allergens: [] }), ['Glutensiz', 'Sütsüz']);
    assert.deepEqual(foodDetailLabels({ dietary: ['spicy'], allergens: null }), ['Acılı']);
  });
});
