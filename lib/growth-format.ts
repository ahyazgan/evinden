/** Büyüme raporlarının biçimlendirme kuralları (veritabanı istemcisi olmadan sınanır). */

/** Baz puanı yüzde metnine çevirir: 1250 → "%12,5" */
export function bpsLabel(bps: number): string {
  const pct = Math.round(bps) / 100;
  return `%${String(pct).replace('.', ',')}`;
}

/** Kalite puanının anlamı; az siparişli restoran "yeni" sayılır (puanı 50, nötr). */
export function qualityLevel(score: number, orders: number, minimumOrders = 5): 'new' | 'good' | 'watch' | 'risk' {
  if (orders < minimumOrders) return 'new';
  if (score >= 80) return 'good';
  if (score >= 60) return 'watch';
  return 'risk';
}
