/**
 * Ekstra, porsiyon ve çeşit düzenleyicisinin form satırları ve sunucuya giden biçimi (057).
 * Satır kimliği korunur: mevcut seçenek yerinde güncellenir, sepetteki seçim bozulmaz.
 */

export type ChoiceKind = 'extra' | 'portion' | 'variant';

export type ChoiceDraft = {
  /** Kayıtlı satırın kimliği; yeni satırda boş */
  id: string | null;
  /** Listede anahtar olarak kullanılır */
  key: string;
  label: string;
  /** Form alanındaki metin: "45", "12,50" */
  priceStr: string;
  isAvailable: boolean;
};

export type ChoicePayloadRow = { id?: string; label: string; price_cents: number; is_available: boolean };

export const CHOICE_LIMIT = 30;

let keySeq = 0;
export function newChoiceKey(): string {
  keySeq += 1;
  return `new-${Date.now()}-${keySeq}`;
}

/** Kuruş tutarını formdaki metne çevirir: 1250 → "12,50", 4500 → "45" */
export function centsToPriceStr(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',');
}

/** "12,50" → 1250. Geçersizse null. */
export function parsePriceStr(value: string): number | null {
  const text = value.trim().replace(/\s/g, '').replace(',', '.');
  if (text === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export function choiceFromRow(row: { id: string; label: string; price_cents?: number; price_diff_cents?: number; is_available?: boolean }): ChoiceDraft {
  const cents = row.price_cents ?? row.price_diff_cents ?? 0;
  return { id: row.id, key: row.id, label: row.label, priceStr: centsToPriceStr(cents), isAvailable: row.is_available !== false };
}

export const CHOICE_TEXT: Record<ChoiceKind, { title: string; hint: string; labelPlaceholder: string; pricePrefix: string; empty: string }> = {
  extra: {
    title: 'Ekstralar',
    hint: 'Müşterinin isteğe bağlı ekleyebileceği şeyler (ekstra peynir, sos). Fiyat ek ücrettir, 0 olabilir.',
    labelPlaceholder: 'Ör: Ekstra peynir',
    pricePrefix: '+₺',
    empty: 'Ekstra yok.',
  },
  portion: {
    title: 'Porsiyonlar',
    hint: 'Porsiyon eklersen müşteri ürün fiyatını değil, seçtiği porsiyonun fiyatını öder.',
    labelPlaceholder: 'Ör: 1,5 porsiyon',
    pricePrefix: '₺',
    empty: 'Porsiyon yok, ürün fiyatı geçerli.',
  },
  variant: {
    title: 'Çeşitler',
    hint: 'Ürünün türleri (acılı / acısız, tavuk / et). Fiyat, ürün fiyatına eklenen farktır, 0 olabilir.',
    labelPlaceholder: 'Ör: Acılı',
    pricePrefix: '+₺',
    empty: 'Çeşit yok.',
  },
};

/** Form satırlarını doğrular; sunucuya gidecek sıralı listeyi ya da ilk hatayı döner. */
export function choicesToPayload(kind: ChoiceKind, drafts: ChoiceDraft[]): { rows: ChoicePayloadRow[] } | { error: string } {
  const name = CHOICE_TEXT[kind].title;
  if (drafts.length > CHOICE_LIMIT) return { error: `${name}: en fazla ${CHOICE_LIMIT} seçenek eklenebilir.` };
  const seen = new Set<string>();
  const rows: ChoicePayloadRow[] = [];
  for (const d of drafts) {
    const label = d.label.trim();
    if (label.length < 1 || label.length > 60) return { error: `${name}: her seçeneğin 1-60 karakterlik bir adı olmalı.` };
    const lower = label.toLocaleLowerCase('tr-TR');
    if (seen.has(lower)) return { error: `${name}: "${label}" iki kez eklenmiş.` };
    seen.add(lower);
    const cents = d.priceStr.trim() === '' && kind !== 'portion' ? 0 : parsePriceStr(d.priceStr);
    if (cents === null || cents > 10000000) return { error: `${label}: fiyatı geçerli bir tutar olmalı.` };
    if (kind === 'portion' && cents === 0) return { error: `${label}: porsiyon fiyatı 0 olamaz.` };
    rows.push({ ...(d.id ? { id: d.id } : {}), label, price_cents: cents, is_available: d.isAvailable });
  }
  return { rows };
}

/** Sunucudaki hâliyle aynı mı: aynıysa kayıt çağrısı atlanır. */
export function choicesUnchanged(kind: ChoiceKind, before: ChoiceDraft[], after: ChoiceDraft[]): boolean {
  const a = choicesToPayload(kind, before);
  const b = choicesToPayload(kind, after);
  if ('error' in a || 'error' in b) return false;
  return JSON.stringify(a.rows) === JSON.stringify(b.rows);
}

/** Satırı listede bir yukarı (-1) ya da aşağı (+1) taşır. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
