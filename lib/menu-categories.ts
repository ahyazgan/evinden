// Menü kategorilerinin tek kaynağı. Satıcı formu kısa kodu kaydeder; eski kayıtlarda okunur ad da olabilir.
// Okurken ikisi de aynı anahtara iner, ekranda her zaman buradaki ad yazılır. Veri taşınmaz.

export const MENU_CATEGORIES = [
  { id: 'corba', label: 'Çorbalar', aliases: ['Çorba'] },
  { id: 'ana', label: 'Ana Yemekler', aliases: ['Ana Yemek'] },
  { id: 'izgara', label: 'Izgaralar', aliases: ['Izgara'] },
  { id: 'kahvalti', label: 'Kahvaltılar', aliases: ['Kahvaltı'] },
  { id: 'salata', label: 'Salatalar', aliases: ['Salata'] },
  { id: 'tatli', label: 'Tatlılar', aliases: ['Tatlı'] },
  { id: 'pasta', label: 'Pastalar', aliases: ['Pasta'] },
  { id: 'borek', label: 'Börekler', aliases: ['Börek'] },
  { id: 'zeytinyagli', label: 'Zeytinyağlılar', aliases: ['Zeytinyağlı'] },
  { id: 'hamur', label: 'Hamur İşleri', aliases: ['Hamur İşi'] },
  { id: 'icecek', label: 'İçecekler', aliases: ['İçecek'] },
  { id: 'diger', label: 'Diğer', aliases: [] },
] as const satisfies readonly { id: string; label: string; aliases: readonly string[] }[];

export type MenuCategoryKey = (typeof MENU_CATEGORIES)[number]['id'];

const OTHER: MenuCategoryKey = 'diger';

/** Büyük-küçük harf ve Türkçe karakter farkını siler. Dil ayarına bağlı değildir (İ, I, ı, i aynı olur). */
function fold(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[İI]/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

const BY_FOLDED = new Map<string, MenuCategoryKey>(
  MENU_CATEGORIES.flatMap(c => [c.id, c.label, ...c.aliases].map(v => [fold(v), c.id] as [string, MenuCategoryKey])),
);

/** Kod veya eski ad fark etmeksizin anahtar. Boş ve tanınmayan değer "Diğer" sayılır. */
export function menuCategoryKey(raw: string | null | undefined): MenuCategoryKey {
  return (raw && BY_FOLDED.get(fold(raw))) || OTHER;
}

/** Ekranda yazılacak ad. Tanınmayan eski metin kaybolmasın diye olduğu gibi yazılır. */
export function categoryLabel(raw: string | null | undefined): string {
  const known = raw ? BY_FOLDED.get(fold(raw)) : undefined;
  if (known) return MENU_CATEGORIES.find(c => c.id === known)!.label;
  return raw?.trim() || 'Diğer';
}

/** Bu anahtarların veritabanında görünebileceği bütün yazımlar: `.in('category', ...)` için. */
export function storedCategoryValues(keys: readonly string[]): string[] {
  return MENU_CATEGORIES.filter(c => keys.includes(c.id)).flatMap(c => [c.id, c.label, ...c.aliases]);
}

/** Aramada "çorba" yazan, kodla kayıtlı ("corba") yemeği de bulsun. En az iki harf. */
export function categoriesMatchingSearch(query: string): MenuCategoryKey[] {
  const q = fold(query);
  if (q.length < 2) return [];
  return MENU_CATEGORIES
    .filter(c => [c.label, ...c.aliases].some(v => fold(v).includes(q)))
    .map(c => c.id);
}
