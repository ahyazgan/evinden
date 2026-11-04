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
  /** Dolu ise sipariş iyzico pazaryerinden geçti (036): satıcının hakkını iyzico öder. */
  marketplace_status?: string | null;
};

/** Satıcının hakkı: satış + teslimat + platformun karşıladığı teslimat + bahşiş - kendi indirimi - komisyon. */
export function orderNetCents(o: EarningOrder): number {
  return o.subtotal_cents + o.delivery_fee_cents + (o.platform_delivery_cents ?? 0) + (o.tip_cents ?? 0)
    - (o.seller_discount_cents ?? 0) - (o.commission_cents ?? 0);
}

/** Artı: platform satıcıya öder. Eksi: satıcı platforma öder. Nakit, kapıda kart ve yemek kartında para satıcıdadır. */
export function orderBalanceCents(o: EarningOrder): number {
  if (o.marketplace_status) return 0;
  return orderNetCents(o) - (o.payment_method === 'online' ? 0 : o.total_cents);
}

/** Satış tutarı: müşterinin ödediği tutardan bahşiş çıkar, bahşiş gelir sayılmaz. admin_platform_totals ile aynı ölçü (033). */
export function orderSalesCents(o: Pick<EarningOrder, 'total_cents' | 'tip_cents'>): number {
  return o.total_cents - (o.tip_cents ?? 0);
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

export type PayoutListRow = {
  display_name: string;
  account_name: string | null;
  iban: string | null;
  balance_cents: number;
  order_count: number;
};

/** Excel'in formül sanmaması için başına tek tırnak konur; ayraç, tırnak veya satır sonu varsa tırnak içine alınır. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Elle havale için ödeme listesi: yalnızca platformun borçlu olduğu (bakiyesi artı) satıcılar.
 * Türkçe Excel'in açabilmesi için ayraç noktalı virgül, ondalık virgül ve başta BOM. Tutarlar kuruştan yazılır.
 */
export function buildPayoutCsv(rows: PayoutListRow[]): { csv: string; count: number; totalCents: number; missingIban: number } {
  const due = rows.filter(r => r.balance_cents > 0);
  const lines = [
    'Restoran;Hesap sahibi;IBAN;Tutar (TL);Sipariş sayısı',
    ...due.map(r => [
      csvCell(r.display_name),
      csvCell(r.account_name ?? ''),
      r.iban ?? '',
      `${Math.floor(r.balance_cents / 100)},${String(r.balance_cents % 100).padStart(2, '0')}`,
      String(r.order_count),
    ].join(';')),
  ];
  return {
    csv: `\uFEFF${lines.join('\r\n')}\r\n`,
    count: due.length,
    totalCents: due.reduce((sum, r) => sum + r.balance_cents, 0),
    missingIban: due.filter(r => !r.iban).length,
  };
}
