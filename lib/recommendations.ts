/**
 * "Sana özel" bölümünün puanlaması. Saf fonksiyonlar: girdiler müşterinin veritabanındaki gerçek
 * siparişleridir, uydurma popülerlik ve rastgelelik yoktur. Her kartın nedeni gerçekten sayılan bir şeydir.
 */

export type HistoryOrder = {
  sellerId: string;
  createdAt: string;
  /** Siparişteki ürünlerin kategorileri; silinmiş üründe null olabilir. */
  categories: readonly (string | null)[];
};

export type RecommendationSeller = { id: string; open: boolean };
/** Bu restoranın menüsünde o kategoride satışta ürün var. */
export type CategoryMatch = { sellerId: string; category: string };
export type Recommendation = { sellerId: string; reason: string; score: number; open: boolean };

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye yıl boyu UTC+3'tür
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_WINDOW_DAYS = 60;
/** Bir kategori "sık seçilen" sayılmak için en az bu kadar siparişte geçmeli. */
const MIN_CATEGORY_ORDERS = 2;

export type TimeSlot = 'sabah' | 'öğle' | 'akşam' | 'gece';

export function timeSlot(at: Date): TimeSlot {
  const hour = new Date(at.getTime() + ISTANBUL_OFFSET_MS).getUTCHours();
  if (hour >= 5 && hour < 11) return 'sabah';
  if (hour >= 11 && hour < 16) return 'öğle';
  if (hour >= 16 && hour < 23) return 'akşam';
  return 'gece';
}

/** Satıcı formu kategoriyi kısa kodla kaydeder (app/(seller)/menu.tsx). Müşteriye okunur adı yazılır. */
const CATEGORY_LABELS: Record<string, string> = {
  corba: 'Çorbalar',
  ana: 'Ana Yemekler',
  salata: 'Salatalar',
  tatli: 'Tatlılar',
  icecek: 'İçecekler',
};

/** "Diğer" bir zevk söylemez, öneriye temel olmaz. */
function isMeaningfulCategory(category: string | null): category is string {
  if (!category) return false;
  const value = category.trim();
  return value !== '' && value !== 'diger' && value !== 'Diğer';
}

/** Müşterinin en çok seçtiği kategoriler. Bir siparişte iki kez geçen kategori bir sayılır. */
export function favouriteCategories(orders: readonly HistoryOrder[], limit = 2): { category: string; orderCount: number }[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    for (const category of new Set(order.categories)) {
      if (isMeaningfulCategory(category)) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, orderCount]) => orderCount >= MIN_CATEGORY_ORDERS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category, orderCount]) => ({ category, orderCount }));
}

function visitedReason(count: number, sameSlot: number, slot: TimeSlot): string {
  if (count >= 2) {
    // "Genelde" ancak siparişlerin yarısından fazlası bu saatlerdeyse doğrudur.
    return sameSlot >= 2 && sameSlot * 2 > count
      ? `${count} kez sipariş verdin, genelde ${slot}`
      : `${count} kez sipariş verdin`;
  }
  return sameSlot === 1 ? `Daha önce ${slot} sipariş verdin` : 'Daha önce sipariş verdin';
}

/**
 * Yalnızca `sellers` içindeki restoranlar önerilir: teslimat alanı dışındakileri çağıran çıkarır.
 * Geçmiş yoksa boş döner ve bölüm hiç görünmez. Açıklar önce, kapalılar en sonda sıralanır.
 */
export function recommend(input: {
  orders: readonly HistoryOrder[];
  sellers: readonly RecommendationSeller[];
  categoryMatches?: readonly CategoryMatch[];
  now?: Date;
  limit?: number;
}): Recommendation[] {
  const { orders, sellers, categoryMatches = [], now = new Date(), limit = 6 } = input;
  if (orders.length === 0) return [];

  const slot = timeSlot(now);
  const history = new Map<string, { count: number; sameSlot: number; last: number }>();
  for (const order of orders) {
    const at = new Date(order.createdAt);
    const entry = history.get(order.sellerId) ?? { count: 0, sameSlot: 0, last: 0 };
    entry.count += 1;
    if (timeSlot(at) === slot) entry.sameSlot += 1;
    entry.last = Math.max(entry.last, at.getTime());
    history.set(order.sellerId, entry);
  }

  const favourites = new Map(favouriteCategories(orders).map(f => [f.category, f.orderCount]));

  const results: Recommendation[] = [];
  for (const seller of sellers) {
    const entry = history.get(seller.id);
    if (entry) {
      const daysAgo = Math.max(0, (now.getTime() - entry.last) / DAY_MS);
      const recency = Math.max(0, 1 - daysAgo / RECENCY_WINDOW_DAYS) * 20;
      const timing = (entry.sameSlot / entry.count) * 15;
      results.push({
        sellerId: seller.id,
        reason: visitedReason(entry.count, entry.sameSlot, slot),
        score: entry.count * 30 + recency + timing,
        open: seller.open,
      });
      continue;
    }
    // Hiç gidilmemiş restoran: en çok seçilen kategori menüsünde varsa, gidilenlerin altında kalır.
    const best = categoryMatches
      .filter(m => m.sellerId === seller.id && favourites.has(m.category))
      .sort((a, b) => favourites.get(b.category)! - favourites.get(a.category)!)[0];
    if (best) {
      results.push({
        sellerId: seller.id,
        reason: `Sık seçtiğin ${CATEGORY_LABELS[best.category] ?? best.category} burada da var`,
        score: Math.min(25, 10 + favourites.get(best.category)! * 3),
        open: seller.open,
      });
    }
  }

  return results
    .sort((a, b) => Number(b.open) - Number(a.open) || b.score - a.score || a.sellerId.localeCompare(b.sellerId))
    .slice(0, limit);
}
