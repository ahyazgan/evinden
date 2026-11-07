import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Restoranın mutfakları. Anahtarlar veritabanı kısıtıyla aynıdır (043). Menü kategorisi değildir: restoranı anlatır. */
export const CUISINES: readonly { id: string; label: string; icon: IconName }[] = [
  { id: 'doner', label: 'Döner', icon: 'flame-outline' },
  { id: 'burger', label: 'Burger', icon: 'fast-food-outline' },
  { id: 'pizza', label: 'Pizza', icon: 'pizza-outline' },
  { id: 'pide', label: 'Pide & Lahmacun', icon: 'restaurant-outline' },
  { id: 'kebap', label: 'Kebap & Izgara', icon: 'flame-outline' },
  { id: 'tavuk', label: 'Tavuk', icon: 'restaurant-outline' },
  { id: 'kofte', label: 'Köfte', icon: 'restaurant-outline' },
  { id: 'esnaf', label: 'Ev Yemekleri', icon: 'restaurant-outline' },
  { id: 'sandvic', label: 'Tost & Sandviç', icon: 'fast-food-outline' },
  { id: 'cigkofte', label: 'Çiğ Köfte', icon: 'leaf-outline' },
  { id: 'kahvalti', label: 'Kahvaltı', icon: 'sunny-outline' },
  { id: 'corba', label: 'Çorba', icon: 'restaurant-outline' },
  { id: 'manti', label: 'Mantı & Hamur İşi', icon: 'restaurant-outline' },
  { id: 'deniz', label: 'Deniz Ürünleri', icon: 'fish-outline' },
  { id: 'salata', label: 'Salata & Sağlıklı', icon: 'leaf-outline' },
  { id: 'dunya', label: 'Dünya Mutfağı', icon: 'globe-outline' },
  { id: 'tatli', label: 'Tatlı', icon: 'ice-cream-outline' },
  { id: 'pastane', label: 'Pastane & Fırın', icon: 'cafe-outline' },
  { id: 'dondurma', label: 'Dondurma', icon: 'ice-cream-outline' },
  { id: 'kahve', label: 'Kahve', icon: 'cafe-outline' },
];

/** Kartta okunur kalsın, restoran her şeyi seçip listeyi anlamsızlaştırmasın. */
export const MAX_SELLER_CUISINES = 3;

const BY_ID = new Map(CUISINES.map(c => [c.id, c]));

export function cuisineLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export function cuisineIcon(id: string): IconName {
  return BY_ID.get(id)?.icon ?? 'restaurant-outline';
}

/** "Döner, Burger" gibi okunur liste. Bilinmeyen anahtarlar atlanır. */
export function cuisineLabels(ids: readonly string[] | null | undefined): string {
  return (ids ?? []).flatMap(id => (BY_ID.has(id) ? [BY_ID.get(id)!.label] : [])).join(', ');
}

/** Seçimi açıp kapatır; sınır doluysa yeni mutfak eklenmez. */
export function toggleCuisine(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return current.filter(c => c !== id);
  return current.length >= MAX_SELLER_CUISINES ? [...current] : [...current, id];
}
