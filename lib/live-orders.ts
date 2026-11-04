// Canlı sipariş izleme: hangi sipariş takılmış? Süreler sunucudan gelir (admin_live_orders, 035).

/** Durum başına izin verilen dakika. Bu süreyi aşan sipariş takılmış sayılır. */
export const STUCK_LIMITS = {
  pending: 15,
  accepted: 45,
  preparing: 45,
  ready: 30,
  out_for_delivery: 60,
} as const;

const PHRASES: Record<keyof typeof STUCK_LIMITS, string> = {
  pending: 'onay bekliyor',
  accepted: 'hazırlığa geçmedi',
  preparing: 'hazırlanıyor',
  ready: 'teslim bekliyor',
  out_for_delivery: 'yolda',
};

export const LIVE_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: 'Ödeme bekleniyor',
  pending: 'Onay bekliyor',
  accepted: 'Kabul edildi',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  out_for_delivery: 'Yolda',
};

export type LiveOrderTiming = {
  status: string;
  minutes_in_status: number | null;
  /** Planlı siparişte seçilen saatten bu yana geçen dakika, saat gelmediyse eksi. Planlı değilse boş. */
  minutes_past_schedule?: number | null;
};

export type StuckInfo = { limit: number; minutes: number; reason: string };

/**
 * Takılmamışsa null. Planlı sipariş seçilen saatten ölçülür: saati gelmemiş sipariş takılmış sayılmaz.
 * Ödeme bekleyen siparişin eşiği yok, süresi dolunca ödeme görevi kapatır.
 */
export function stuckInfo(order: LiveOrderTiming): StuckInfo | null {
  if (!Object.prototype.hasOwnProperty.call(STUCK_LIMITS, order.status)) return null;
  const status = order.status as keyof typeof STUCK_LIMITS;
  const limit = STUCK_LIMITS[status];
  const planned = order.minutes_past_schedule != null;
  const minutes = planned ? order.minutes_past_schedule : order.minutes_in_status;
  if (minutes == null || minutes <= limit) return null;
  const reason = planned
    ? `Planlı saati ${minutes} dakika geçti, hâlâ ${PHRASES[status]} (sınır ${limit} dk)`
    : `${minutes} dakikadır ${PHRASES[status]} (sınır ${limit} dk)`;
  return { limit, minutes, reason };
}

/** Takılanlar başta, en uzun bekleyen önce; sonra süreye göre. Girdiyi değiştirmez. */
export function sortLiveOrders<T extends LiveOrderTiming>(orders: readonly T[]): T[] {
  const excess = (o: T) => {
    const stuck = stuckInfo(o);
    return stuck ? stuck.minutes - stuck.limit : -1;
  };
  return [...orders].sort((a, b) => excess(b) - excess(a) || (b.minutes_in_status ?? 0) - (a.minutes_in_status ?? 0));
}
