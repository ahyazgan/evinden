/**
 * Restoran sipariş listesinin sayfalama kuralları.
 * Açık siparişlerin hepsi her zaman yüklenir; kapanmışlar sayfa sayfa gelir.
 */

export const SELLER_ORDER_PAGE_SIZE = 30;
/** İstatistik sorgusunun tek sayfası. Supabase varsayılan olarak 1000 satırdan fazlasını döndürmez. */
export const SELLER_STATS_PAGE_SIZE = 500;
/** Paneldeki en çok satan ve müşteri istatistiklerinin kapsadığı gün sayısı. */
export const DASHBOARD_STATS_DAYS = 30;

export const OPEN_ORDER_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'] as const;

export type OrderCursor = { created_at: string; id: string };

/** Çözümlemede ayraç sayılan karakterler içerdiği için değerler tırnak içinde yazılır. */
export function olderThanFilter(cursor: OrderCursor): string {
  const at = `"${cursor.created_at}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`;
}

/** Tam sayfa geldiyse devamı olabilir; imleç sayfanın son satırıdır. */
export function nextCursor<T extends OrderCursor>(page: T[], pageSize: number): OrderCursor | null {
  if (page.length < pageSize) return null;
  const last = page[page.length - 1];
  return { created_at: last.created_at, id: last.id };
}

/** Listeleri id'ye göre birleştirir. Aynı sipariş birden çok listedeyse öndeki liste geçerlidir. */
export function mergeOrdersById<T extends { id: string }>(...lists: T[][]): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) {
    for (const order of list) {
      if (!seen.has(order.id)) seen.set(order.id, order);
    }
  }
  return Array.from(seen.values());
}

/** Analiz ekranı: bu ay ve bu hafta birlikte kapsanmalı, hafta önceki aydan başlayabilir. */
export function analyticsSince(now: Date): Date {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);
  return monthStart < weekStart ? monthStart : weekStart;
}

export function dashboardStatsSince(now: Date): Date {
  const since = new Date(now);
  since.setDate(now.getDate() - DASHBOARD_STATS_DAYS);
  since.setHours(0, 0, 0, 0);
  return since;
}

/** Müşteri başına bir sipariş: en çok sipariş veren müşterilerin adını sorgulamak için yeterli. */
export function topCustomerOrderIds(
  orders: { id: string; customer_id: string | null }[],
  count: number,
): string[] {
  const byCustomer = new Map<string, { orderId: string; orders: number }>();
  for (const order of orders) {
    if (!order.customer_id) continue;
    const prev = byCustomer.get(order.customer_id);
    byCustomer.set(order.customer_id, { orderId: prev?.orderId ?? order.id, orders: (prev?.orders ?? 0) + 1 });
  }
  return Array.from(byCustomer.values())
    .sort((a, b) => b.orders - a.orders)
    .slice(0, count)
    .map(c => c.orderId);
}
