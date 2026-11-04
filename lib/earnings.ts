// Sipariş başına satıcı hesabı. Sunucuda order_net_cents (033) ve order_balance_cents (024) ile aynıdır.

export type EarningOrder = {
  subtotal_cents: number;
  delivery_fee_cents: number;
  platform_delivery_cents?: number | null;
  seller_discount_cents?: number | null;
  commission_cents?: number | null;
  /** Tamamı satıcının: komisyon alınmaz, platform payı yoktur (033). */
  tip_cents?: number | null;
  total_cents: number;
  payment_method?: string | null;
};

/** Satıcının hakkı: satış + teslimat + platformun karşıladığı teslimat + bahşiş - kendi indirimi - komisyon. */
export function orderNetCents(o: EarningOrder): number {
  return o.subtotal_cents + o.delivery_fee_cents + (o.platform_delivery_cents ?? 0) + (o.tip_cents ?? 0)
    - (o.seller_discount_cents ?? 0) - (o.commission_cents ?? 0);
}

/** Artı: platform satıcıya öder. Eksi: satıcı platforma öder. Nakit, kapıda kart ve yemek kartında para satıcıdadır. */
export function orderBalanceCents(o: EarningOrder): number {
  return orderNetCents(o) - (o.payment_method === 'online' ? 0 : o.total_cents);
}

export type EarningsPeriod = 'week' | 'month' | 'last_month';

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** İstanbul takvimine göre dönem sınırları (Türkiye yıl boyu UTC+3). Hafta pazartesi başlar. */
export function periodRange(period: EarningsPeriod, now: Date = new Date()): { from: string; to: string } {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const toIso = (utcMs: number) => new Date(utcMs - ISTANBUL_OFFSET_MS).toISOString();

  if (period === 'week') {
    const sinceMonday = (local.getUTCDay() + 6) % 7;
    const start = Date.UTC(y, m, d - sinceMonday);
    return { from: toIso(start), to: toIso(start + 7 * 86400000) };
  }
  if (period === 'month') {
    return { from: toIso(Date.UTC(y, m, 1)), to: toIso(Date.UTC(y, m + 1, 1)) };
  }
  return { from: toIso(Date.UTC(y, m - 1, 1)), to: toIso(Date.UTC(y, m, 1)) };
}

/** Boşlukları atar, büyütür; geçerliyse temiz IBAN'ı, değilse null döndürür. */
export function normalizeTurkishIban(input: string): string | null {
  const iban = input.replace(/\s+/g, '').toUpperCase();
  if (!/^TR[0-9]{24}$/.test(iban)) return null;
  // ISO 13616: ilk dört karakter sona alınır, harfler sayıya çevrilir, mod 97 sonucu 1 olmalı.
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1 ? iban : null;
}

export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}
