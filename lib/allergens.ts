/**
 * Etiketleme mevzuatındaki 14 alerjen. Anahtarlar veritabanı kısıtıyla aynıdır (031).
 * `null` belirtilmedi, boş liste "alerjen içermiyor" demektir: ikisi aynı şey değildir.
 */
export const ALLERGENS = [
  { key: 'gluten', label: 'Gluten' },
  { key: 'milk', label: 'Süt' },
  { key: 'egg', label: 'Yumurta' },
  { key: 'peanut', label: 'Yer fıstığı' },
  { key: 'tree_nut', label: 'Sert kabuklu yemiş' },
  { key: 'sesame', label: 'Susam' },
  { key: 'soy', label: 'Soya' },
  { key: 'fish', label: 'Balık' },
  { key: 'crustacean', label: 'Kabuklu deniz ürünü' },
  { key: 'mollusc', label: 'Yumuşakça' },
  { key: 'celery', label: 'Kereviz' },
  { key: 'mustard', label: 'Hardal' },
  { key: 'sulphite', label: 'Sülfit' },
  { key: 'lupin', label: 'Acı bakla' },
] as const;

export type AllergenKey = (typeof ALLERGENS)[number]['key'];

const LABELS = new Map<string, string>(ALLERGENS.map(a => [a.key, a.label]));

/** "Gluten, Süt" gibi okunur liste. Bilinmeyen anahtarlar atlanır. */
export function allergenLabels(keys: readonly string[]): string {
  return keys.map(k => LABELS.get(k)).filter(Boolean).join(', ');
}

/** Müşteriye gösterilecek cümle. */
export function allergenSummary(keys: readonly string[] | null | undefined): string {
  if (keys == null) return 'Alerjen bilgisi girilmedi. Alerjin varsa siparişten önce satıcıya sor.';
  if (keys.length === 0) return 'Satıcıya göre alerjen içermiyor.';
  return `İçerir: ${allergenLabels(keys)}`;
}

/** Seçimi açıp kapatır; "içermiyor" seçiliyken alerjen seçmek onu kaldırır. */
export function toggleAllergen(current: readonly string[] | null, key: string): string[] {
  const list = current ?? [];
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}
