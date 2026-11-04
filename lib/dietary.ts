/**
 * Yemek etiketleri ve filtreleri. Satıcının seçtiği anahtarlar veritabanı kısıtıyla aynıdır (034).
 */
export const DIETARY = [
  { key: 'vegetarian', label: 'Vejetaryen' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'spicy', label: 'Acılı' },
] as const;

export type DietaryKey = (typeof DIETARY)[number]['key'];

/** Müşterinin gördüğü filtreler. Glutensiz ve sütsüz satıcının seçimi değil, alerjenlerden türer. */
export const FOOD_FILTERS = [
  { key: 'vegetarian', label: 'Vejetaryen' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten_free', label: 'Glutensiz' },
  { key: 'milk_free', label: 'Sütsüz' },
  { key: 'spicy', label: 'Acılı' },
] as const;

export type FoodFilterKey = (typeof FOOD_FILTERS)[number]['key'];

export type FoodTraits = {
  dietary?: readonly string[] | null;
  allergens?: readonly string[] | null;
};

/**
 * Alerjen listesi biliniyor ve bu alerjeni içermiyor mu?
 * `null` satıcının bilgi girmediği anlamına gelir, "içermiyor" demek değildir. Alerjisi olan biri
 * "Glutensiz" filtresine güvenir: bilinmeyen ürünü ona göstermek sağlık riskidir, bu yüzden eşleşmez.
 */
export function lacksAllergen(allergens: readonly string[] | null | undefined, key: string): boolean {
  return allergens != null && !allergens.includes(key);
}

export function matchesFoodFilter(item: FoodTraits, filter: FoodFilterKey): boolean {
  const dietary = item.dietary ?? [];
  switch (filter) {
    // Vegan yemek vejetaryendir: satıcı yalnızca "Vegan" seçtiyse de çıkar.
    case 'vegetarian': return dietary.includes('vegetarian') || dietary.includes('vegan');
    case 'vegan': return dietary.includes('vegan');
    case 'spicy': return dietary.includes('spicy');
    case 'gluten_free': return lacksAllergen(item.allergens, 'gluten');
    case 'milk_free': return lacksAllergen(item.allergens, 'milk');
  }
}

/** Birden çok filtre seçildiyse hepsine uyması gerekir: vegan ve glutensiz. */
export function matchesFoodFilters(item: FoodTraits, filters: readonly FoodFilterKey[]): boolean {
  return filters.every(filter => matchesFoodFilter(item, filter));
}

/** Listede en az bir yemeğe uyan filtreler: restoran sayfasında boşa çıkan çip gösterilmez. */
export function availableFoodFilters(items: readonly FoodTraits[]): (typeof FOOD_FILTERS)[number][] {
  return FOOD_FILTERS.filter(filter => items.some(item => matchesFoodFilter(item, filter.key)));
}

/** Çipi açıp kapatır. */
export function toggleKey<T extends string>(current: readonly T[], key: T): T[] {
  return current.includes(key) ? current.filter(k => k !== key) : [...current, key];
}

/**
 * Yemek satırındaki etiketler: yalnızca satıcının seçtikleri. Vegan varsa vejetaryen yazılmaz.
 * Glutensiz ve sütsüz burada yok: alerjen listesi girilmiş her yemekte çıkıp satırı doldururdu.
 */
export function dietaryLabels(item: FoodTraits): string[] {
  const dietary = item.dietary ?? [];
  return DIETARY
    .filter(d => dietary.includes(d.key) && !(d.key === 'vegetarian' && dietary.includes('vegan')))
    .map(d => d.label);
}

/** Ürün sayfasındaki etiketler: satıcının seçtikleri ve alerjenlerden türeyenler. */
export function foodDetailLabels(item: FoodTraits): string[] {
  return [
    ...dietaryLabels(item),
    ...(matchesFoodFilter(item, 'gluten_free') ? ['Glutensiz'] : []),
    ...(matchesFoodFilter(item, 'milk_free') ? ['Sütsüz'] : []),
  ];
}
