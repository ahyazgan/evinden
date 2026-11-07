/**
 * Ana sayfadaki "Ne yesek?" sırası. Türkiye'de en çok sipariş edilenler önde (Ticaret Bakanlığı 2025,
 * Yemeksepeti 2024, Trendyol Yemek 2023): burger, döner, pizza, kebap, pide/lahmacun, tavuk, çiğ köfte.
 * Mevsim ve saat sırayı oynatır: kışın çorba ve ev yemekleri, yazın dondurma ve kahve yukarı çıkar;
 * gece yarısından sonra döner, sabah kahvaltı başa geçer. Saat İstanbul saatidir.
 */
export const POPULAR_CUISINES = [
  'burger', 'doner', 'pizza', 'kebap', 'pide', 'tavuk', 'cigkofte', 'esnaf',
  'sandvic', 'tatli', 'kahvalti', 'kahve', 'kofte', 'corba', 'manti', 'dunya',
  'salata', 'deniz', 'pastane', 'dondurma',
] as const;

/** İstanbul'un ay ve saati (UTC+3, yaz saati yok). */
export function istanbulMonthHour(now: Date): { month: number; hour: number } {
  const t = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return { month: t.getUTCMonth() + 1, hour: t.getUTCHours() };
}

function moveTo(list: string[], ids: readonly string[], index: number): string[] {
  const rest = list.filter(id => !ids.includes(id));
  const at = Math.min(index, rest.length);
  return [...rest.slice(0, at), ...ids.filter(id => list.includes(id)), ...rest.slice(at)];
}

/** Bu an için mutfak sırası; listede olmayan mutfaklar en sona, kendi aralarında geldiği sırayla. */
export function cuisineOrder(now: Date = new Date()): string[] {
  const { month, hour } = istanbulMonthHour(now);
  let order: string[] = [...POPULAR_CUISINES];
  if (month === 12 || month <= 2) order = moveTo(order, ['corba', 'esnaf'], 3);
  else if (month >= 6 && month <= 8) order = moveTo(order, ['dondurma', 'kahve'], 3);
  if (hour < 6) order = moveTo(order, ['doner'], 0);
  else if (hour >= 6 && hour < 11) order = moveTo(order, ['kahvalti'], 0);
  return order;
}

/** Mutfakları bu anın sırasına dizer; bilinmeyenler sonda kalır. */
export function sortByCuisineOrder<T extends { id: string }>(items: readonly T[], now: Date = new Date()): T[] {
  const rank = new Map(cuisineOrder(now).map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (rank.get(a.item.id) ?? 999) - (rank.get(b.item.id) ?? 999) || a.i - b.i)
    .map(x => x.item);
}

type RailSeller = { ratingAvg: number; ratingCount: number; createdAt: string | null };

/** Semtin yıldızları: yeterince puanlanmış ve yüksek puanlı restoranlar; puan, sonra puanlayan sayısı. */
export function neighbourhoodStars<T extends RailSeller>(list: readonly T[], limit = 8): T[] {
  return list
    .filter(s => s.ratingCount >= 10 && s.ratingAvg >= 4.3)
    .sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount)
    .slice(0, limit);
}

export const NEW_SELLER_DAYS = 30;

/** Yeni açılanlar: son 30 günde katılanlar, en yenisi önce. */
export function newlyOpened<T extends RailSeller>(list: readonly T[], now: Date = new Date(), limit = 8): T[] {
  const since = now.getTime() - NEW_SELLER_DAYS * 24 * 60 * 60 * 1000;
  return list
    .filter(s => s.createdAt && new Date(s.createdAt).getTime() >= since)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, limit);
}
