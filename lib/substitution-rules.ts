/** Ürün değiştirme teklifinin saf kuralları; sunucudaki propose_item_substitution ile aynı (060). */

export type SubstitutionStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export type SubstitutionRow = {
  id: string;
  order_id: string;
  order_item_id: string;
  original_title: string;
  replacement_title: string;
  replacement_item_id: string | null;
  reason: string;
  status: SubstitutionStatus;
  customer_note: string | null;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
};

export const SUBSTITUTION_REASONS = ['Ürün tükendi', 'Malzemesi kalmadı', 'Bugün hazırlayamıyoruz'];

export const SUBSTITUTION_STATUS_TEXT: Record<SubstitutionStatus, string> = {
  pending: 'Müşterinin yanıtı bekleniyor',
  accepted: 'Müşteri kabul etti',
  rejected: 'Müşteri kabul etmedi',
  expired: 'Yanıt gelmedi, süre doldu',
};

type CandidateItem = {
  id: string;
  title: string;
  price_cents: number;
  is_available: boolean;
  daily_limit?: number | null;
  sold_today?: number | null;
  stock_reset_date?: string | null;
};

/** Önerilebilecek ürünler: satışta, günlük adedi bitmemiş, aynı fiyatlı ve kalemin kendisi olmayan. */
export function substitutionCandidates<T extends CandidateItem>(
  menu: T[], line: { menuItemId: string | null; unitPriceCents: number }, todayIstanbul: string,
): T[] {
  return menu
    .filter(m => m.is_available && m.id !== line.menuItemId && m.price_cents === line.unitPriceCents)
    .filter(m => {
      const limit = m.daily_limit ?? 0;
      if (limit <= 0) return true;
      const sold = m.stock_reset_date === todayIstanbul ? m.sold_today ?? 0 : 0;
      return sold < limit;
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'));
}

/** Yanıt bekleyen ve süresi dolmamış teklif. */
export function substitutionLive(row: Pick<SubstitutionRow, 'status' | 'expires_at'>, now: number = Date.now()): boolean {
  return row.status === 'pending' && new Date(row.expires_at).getTime() > now;
}

/** Her sipariş kalemi için en son teklif; süresi dolan bekleyen teklif "süre doldu" olarak görünür. */
export function latestSubstitutionByItem(rows: SubstitutionRow[], now: number = Date.now()): Map<string, SubstitutionRow> {
  const out = new Map<string, SubstitutionRow>();
  for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (out.has(r.order_item_id)) continue;
    out.set(r.order_item_id, r.status === 'pending' && !substitutionLive(r, now) ? { ...r, status: 'expired' } : r);
  }
  return out;
}
