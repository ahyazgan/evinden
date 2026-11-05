/**
 * Seçim grupları: "İçeceğini seç, 1 tane zorunlu" gibi başlıklı ve kurallı seçenekler.
 * Burada ekran için hesap yapılır; kural ve fiyatı sipariş sırasında sunucu yeniden denetler (040).
 */
export type MenuOption = { id: string; label: string; priceCents: number; isAvailable: boolean };

export type OptionGroup = {
  id: string;
  title: string;
  minSelect: number;
  /** null: üst sınır yok */
  maxSelect: number | null;
  options: MenuOption[];
};

type OptionRow = { id: string; label: string; price_cents: number; is_available: boolean; sort_order: number };
export type OptionGroupRow = {
  id: string;
  menu_item_id?: string;
  title: string;
  min_select: number;
  max_select: number | null;
  sort_order: number;
  menu_options?: OptionRow[] | null;
};

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

export function groupsFromRows(rows: readonly OptionGroupRow[] | null | undefined): OptionGroup[] {
  return [...(rows ?? [])].sort(bySort).map(g => ({
    id: g.id,
    title: g.title,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    options: [...(g.menu_options ?? [])].sort(bySort).map(o => ({
      id: o.id,
      label: o.label,
      priceCents: o.price_cents,
      isAvailable: o.is_available,
    })),
  }));
}

/** Müşterinin göreceği hali: biten seçenekler çıkar, seçeneksiz kalan isteğe bağlı grup gizlenir. */
export function customerGroups(groups: readonly OptionGroup[]): OptionGroup[] {
  return groups
    .map(g => ({ ...g, options: g.options.filter(o => o.isAvailable) }))
    .filter(g => g.options.length > 0 || g.minSelect > 0);
}

export function groupRuleLabel(group: Pick<OptionGroup, 'minSelect' | 'maxSelect'>): string {
  const { minSelect: min, maxSelect: max } = group;
  if (min > 0) {
    if (max === min) return `Zorunlu · ${min} seç`;
    if (max === null) return `Zorunlu · en az ${min}`;
    return `Zorunlu · ${min}-${max} seç`;
  }
  if (max === 1) return 'İsteğe bağlı · en fazla 1';
  if (max !== null) return `İsteğe bağlı · en fazla ${max}`;
  return 'İsteğe bağlı';
}

/** Tek seçimli grup radyo gibi çalışır; sınır doluysa yeni seçim yapılmaz. */
export function toggleOption(selected: ReadonlySet<string>, group: OptionGroup, optionId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(optionId)) {
    next.delete(optionId);
    // Zorunlu tek seçimde boş bırakılmaz, başka seçenek seçilerek değiştirilir.
    if (group.maxSelect === 1 && group.minSelect === 1) next.add(optionId);
    return next;
  }
  if (group.maxSelect === 1) {
    for (const o of group.options) next.delete(o.id);
    next.add(optionId);
    return next;
  }
  const count = group.options.filter(o => next.has(o.id)).length;
  if (group.maxSelect !== null && count >= group.maxSelect) return next;
  next.add(optionId);
  return next;
}

/** İlk eksik veya fazla seçim için mesaj; her şey tamamsa null. */
export function selectionError(groups: readonly OptionGroup[], selected: ReadonlySet<string>): string | null {
  for (const g of groups) {
    const count = g.options.filter(o => selected.has(o.id)).length;
    if (count < g.minSelect) {
      if (g.options.length < g.minSelect) return `${g.title}: seçenekler şu an tükendi.`;
      return `${g.title}: en az ${g.minSelect} seçim yap.`;
    }
    if (g.maxSelect !== null && count > g.maxSelect) return `${g.title}: en fazla ${g.maxSelect} seçebilirsin.`;
  }
  return null;
}

export function selectedOptionsTotal(groups: readonly OptionGroup[], selected: ReadonlySet<string>): number {
  let total = 0;
  for (const g of groups) for (const o of g.options) if (selected.has(o.id)) total += o.priceCents;
  return total;
}

/** Sepette ve siparişte görünen özet; sunucudaki başlıkla aynı biçimdedir. */
export function selectionSummary(groups: readonly OptionGroup[], selected: ReadonlySet<string>): string {
  return groups
    .map(g => {
      const labels = g.options.filter(o => selected.has(o.id)).map(o => o.label);
      return labels.length > 0 ? `${g.title}: ${labels.join(', ')}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function selectedOptionIds(groups: readonly OptionGroup[], selected: ReadonlySet<string>): string[] {
  return groups.flatMap(g => g.options.filter(o => selected.has(o.id)).map(o => o.id));
}

/** Zorunlu seçimlerin en ucuz toplamı: listede ürünün gerçek başlangıç fiyatı için. */
export function requiredOptionsMin(groups: readonly OptionGroup[]): number {
  let total = 0;
  for (const g of groups) {
    if (g.minSelect <= 0) continue;
    const prices = g.options.map(o => o.priceCents).sort((a, b) => a - b);
    for (const p of prices.slice(0, g.minSelect)) total += p;
  }
  return total;
}

/** Seçimlere göre fiyat yükselebiliyor mu? Listede "ve üzeri" yazmak için. */
export function optionsCanRaisePrice(groups: readonly OptionGroup[]): boolean {
  return groups.some(g => {
    const prices = g.options.map(o => o.priceCents);
    if (g.minSelect <= 0) return prices.some(p => p > 0);
    if (g.maxSelect === g.minSelect && g.minSelect >= g.options.length) return false;
    return new Set(prices).size > 1 || (g.maxSelect !== g.minSelect && prices.some(p => p > 0));
  });
}

export function hasRequiredGroup(rows: readonly OptionGroupRow[] | null | undefined): boolean {
  return (rows ?? []).some(g => g.min_select > 0);
}

// ─── Satıcı formu ───────────────────────────────────────────────────────────

export type FormOption = { key: string; id?: string; label: string; priceStr: string; isAvailable: boolean };
export type FormGroup = { key: string; id?: string; title: string; minStr: string; maxStr: string; options: FormOption[] };

export const MAX_GROUPS = 20;
export const MAX_OPTIONS = 50;
export const MAX_NAME_LENGTH = 60;
export const MAX_OPTION_PRICE_CENTS = 10_000_000;

let keySeq = 0;
const newKey = () => `k${Date.now()}-${keySeq++}`;

export function newFormOption(): FormOption {
  return { key: newKey(), label: '', priceStr: '', isAvailable: true };
}

/** Yeni grup en sık kullanılan kuralla başlar: zorunlu, 1 tane. */
export function newFormGroup(): FormGroup {
  return { key: newKey(), title: '', minStr: '1', maxStr: '1', options: [newFormOption()] };
}

function priceToStr(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',').replace(',00', '');
}

export function groupsToForm(groups: readonly OptionGroup[]): FormGroup[] {
  return groups.map(g => ({
    key: g.id,
    id: g.id,
    title: g.title,
    minStr: String(g.minSelect),
    maxStr: g.maxSelect === null ? '' : String(g.maxSelect),
    options: g.options.map(o => ({ key: o.id, id: o.id, label: o.label, priceStr: priceToStr(o.priceCents), isAvailable: o.isAvailable })),
  }));
}

export type OptionGroupPayload = {
  id: string | null;
  title: string;
  min_select: number;
  max_select: number | null;
  options: { id: string | null; label: string; price_cents: number; is_available: boolean }[];
};

const wholeNumber = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s.trim(), 10) : NaN);

/** Formu kayda hazırlar; hatada satıcıya gösterilecek mesajı döner. Hiç adı ve seçeneği girilmemiş boş grup atlanır. */
export function formToPayload(form: readonly FormGroup[]): { groups: OptionGroupPayload[] } | { error: string } {
  const filled = form
    .map(g => ({ ...g, options: g.options.filter(o => o.label.trim() !== '' || o.priceStr.trim() !== '') }))
    .filter(g => g.title.trim() !== '' || g.options.length > 0);
  if (filled.length > MAX_GROUPS) return { error: `En fazla ${MAX_GROUPS} seçim grubu eklenebilir.` };

  const groups: OptionGroupPayload[] = [];
  for (const g of filled) {
    const title = g.title.trim();
    if (!title) return { error: 'Her seçim grubuna bir ad ver (örn: İçeceğini seç).' };
    if (title.length > MAX_NAME_LENGTH) return { error: `${title.slice(0, 20)}...: grup adı en fazla ${MAX_NAME_LENGTH} karakter olabilir.` };
    if (g.options.length === 0) return { error: `${title}: en az bir seçenek ekle.` };
    if (g.options.length > MAX_OPTIONS) return { error: `${title}: en fazla ${MAX_OPTIONS} seçenek eklenebilir.` };

    const min = g.minStr.trim() === '' ? 0 : wholeNumber(g.minStr);
    const max = g.maxStr.trim() === '' ? null : wholeNumber(g.maxStr);
    if (Number.isNaN(min) || (max !== null && Number.isNaN(max))) return { error: `${title}: en az ve en fazla tam sayı olmalı.` };
    if (max !== null && max < 1) return { error: `${title}: en fazla seçim 1'den küçük olamaz. Sınır istemiyorsan boş bırak.` };
    if (max !== null && max < min) return { error: `${title}: en fazla seçim, en az seçimden küçük olamaz.` };
    if (min > g.options.length) return { error: `${title}: ${min} seçim isteniyor ama ${g.options.length} seçenek var.` };

    const options: OptionGroupPayload['options'] = [];
    for (const o of g.options) {
      const label = o.label.trim();
      if (!label) return { error: `${title}: her seçeneğe bir ad ver.` };
      if (label.length > MAX_NAME_LENGTH) return { error: `${title}: seçenek adı en fazla ${MAX_NAME_LENGTH} karakter olabilir.` };
      const raw = o.priceStr.trim().replace(',', '.');
      const price = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(price) || price < 0) return { error: `${label}: geçersiz fiyat.` };
      const cents = Math.round(price * 100);
      if (cents > MAX_OPTION_PRICE_CENTS) return { error: `${label}: fiyat çok yüksek.` };
      options.push({ id: o.id ?? null, label, price_cents: cents, is_available: o.isAvailable });
    }
    groups.push({ id: g.id ?? null, title, min_select: min, max_select: max, options });
  }
  return { groups };
}
