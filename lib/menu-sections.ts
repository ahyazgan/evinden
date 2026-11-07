/**
 * Müşteri menüsünün bölümlere ayrılması (057). Restoran bölüm açtıysa ürünler onun bölümlerinin
 * altında, bölüm sırasıyla görünür; bölümsüz ürünler sonda "Diğer" altında toplanır. Bölüm açmamış
 * restoranda eski davranış sürer: ürünler kategori adına göre, ilk görüldükleri sırayla gruplanır.
 */

export type MenuSectionRow = { id: string; title: string; sort_order: number };

export type SectionedItem = {
  section_id?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  /** Bölüm yoksa gruplamada kullanılan kategori adı */
  category?: string | null;
};

export const UNSECTIONED_TITLE = 'Diğer';

/** Ürünleri restoranın sırasıyla dizer: sort_order, eşitse eklenme zamanı. */
export function sortMenuItems<T extends SectionedItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (d !== 0) return d;
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  });
}

/** Ürünün hangi başlık altında görüneceği. */
export function sectionTitleOf(item: SectionedItem, sections: readonly MenuSectionRow[]): string {
  if (sections.length > 0) {
    return sections.find(s => s.id === item.section_id)?.title ?? UNSECTIONED_TITLE;
  }
  return item.category || UNSECTIONED_TITLE;
}

/** Başlıkları ve her başlığın ürünlerini görünme sırasıyla döner. Boş bölüm gösterilmez. */
export function groupMenu<T extends SectionedItem>(items: readonly T[], sections: readonly MenuSectionRow[]): { title: string; items: T[] }[] {
  const ordered = sortMenuItems(items);
  const groups = new Map<string, T[]>();
  if (sections.length > 0) {
    for (const s of [...sections].sort((a, b) => a.sort_order - b.sort_order)) groups.set(s.title, []);
  }
  for (const item of ordered) {
    const title = sectionTitleOf(item, sections);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(item);
  }
  // Bölüm açmış restoranda bölümsüz ürünler her zaman sonda.
  if (sections.length > 0 && groups.has(UNSECTIONED_TITLE) && !sections.some(s => s.title === UNSECTIONED_TITLE)) {
    const rest = groups.get(UNSECTIONED_TITLE)!;
    groups.delete(UNSECTIONED_TITLE);
    groups.set(UNSECTIONED_TITLE, rest);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0).map(([title, list]) => ({ title, items: list }));
}
