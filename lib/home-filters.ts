// Ana sayfadaki restoran listesinin filtre ve sıralama kuralları. Ekrandan bağımsızdır.

export type HomeSort = 'recommended' | 'alphabetical' | 'rating' | 'nearest' | 'reviews' | 'speed';

export type HomeFilters = {
  sort: HomeSort;
  cuisines: string[];
  open: boolean;
  campaign: boolean;
  freeDelivery: boolean;
  localFavorite: boolean;
  mealCard: boolean;
  pickup: boolean;
  minRating: number | null;
  maxMinOrderCents: number | null;
  maxMinutes: number | null;
  maxKm: number | null;
};

export const EMPTY_FILTERS: HomeFilters = {
  sort: 'recommended',
  cuisines: [],
  open: false,
  campaign: false,
  freeDelivery: false,
  localFavorite: false,
  mealCard: false,
  pickup: false,
  minRating: null,
  maxMinOrderCents: null,
  maxMinutes: null,
  maxKm: null,
};

export const SORT_OPTIONS: { key: HomeSort; label: string; needsLocation?: boolean }[] = [
  { key: 'recommended', label: 'Önerilen' },
  { key: 'alphabetical', label: 'Alfabetik' },
  { key: 'rating', label: 'Puana göre' },
  { key: 'nearest', label: 'Yakınlığa göre', needsLocation: true },
  { key: 'reviews', label: 'Değerlendirme sayısına göre' },
  { key: 'speed', label: 'Teslimat süresine göre' },
];

export const RATING_OPTIONS = [4.5, 4];
export const MIN_ORDER_OPTIONS = [20000, 30000, 40000];
export const MINUTE_OPTIONS = [20, 30, 40];
export const KM_OPTIONS = [1, 2, 5];

/** Listede ne kadar çok filtre açık: sıralama filtre sayılmaz. */
export function activeFilterCount(f: HomeFilters): number {
  return (
    f.cuisines.length +
    [f.open, f.campaign, f.freeDelivery, f.localFavorite, f.mealCard, f.pickup].filter(Boolean).length +
    [f.minRating, f.maxMinOrderCents, f.maxMinutes, f.maxKm].filter(v => v != null).length
  );
}

export type HomeSeller = {
  id: string;
  name: string;
  cuisines: readonly string[];
  open: boolean;
  hasCampaign: boolean;
  ratingAvg: number;
  ratingCount: number;
  timeMax: number;
  minOrderCents: number;
  deliveryFeeCents: number | null;
  mealCards: boolean;
  pickup: boolean;
  /** Konum bilinmiyorsa veya restoranın konumu yoksa null */
  km: number | null;
};

/** Yeterli sayıda müşterinin yüksek puan verdiği restoran. Rozet satın alınamaz, yalnızca puandan gelir. */
export function isLocalFavorite(ratingAvg: number, ratingCount: number): boolean {
  return ratingAvg >= 4.5 && ratingCount >= 50;
}

/** Bilgisi olmayan restoran, sınırlı filtreden geçmez: "2 km ve altı" denince uzaklığı bilinmeyen gösterilmez. */
export function matchesFilters(s: HomeSeller, f: HomeFilters): boolean {
  if (f.cuisines.length > 0 && !f.cuisines.some(c => s.cuisines.includes(c))) return false;
  if (f.open && !s.open) return false;
  if (f.campaign && !s.hasCampaign) return false;
  if (f.freeDelivery && s.deliveryFeeCents !== 0) return false;
  if (f.localFavorite && !isLocalFavorite(s.ratingAvg, s.ratingCount)) return false;
  if (f.mealCard && !s.mealCards) return false;
  if (f.pickup && !s.pickup) return false;
  if (f.minRating != null && (s.ratingCount === 0 || s.ratingAvg < f.minRating)) return false;
  if (f.maxMinOrderCents != null && s.minOrderCents > f.maxMinOrderCents) return false;
  if (f.maxMinutes != null && s.timeMax > f.maxMinutes) return false;
  if (f.maxKm != null && (s.km == null || s.km > f.maxKm)) return false;
  return true;
}

const farLast = (km: number | null) => (km == null ? Number.POSITIVE_INFINITY : km);

function compare(a: HomeSeller, b: HomeSeller, sort: HomeSort): number {
  switch (sort) {
    case 'alphabetical': return a.name.localeCompare(b.name, 'tr');
    case 'rating': return b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount;
    case 'reviews': return b.ratingCount - a.ratingCount || b.ratingAvg - a.ratingAvg;
    case 'speed': return a.timeMax - b.timeMax;
    case 'nearest': return farLast(a.km) - farLast(b.km);
    // Önerilen: açık olan öne, sonra yakın olan, sonra yüksek puanlı.
    default:
      return Number(b.open) - Number(a.open) || farLast(a.km) - farLast(b.km) || b.ratingAvg - a.ratingAvg;
  }
}

export function sortSellers<T extends HomeSeller>(list: readonly T[], sort: HomeSort): T[] {
  return [...list].sort((a, b) => compare(a, b, sort));
}

/** Filtre listesi için mutfaklar: yalnızca bölgede gerçekten olanlar, en çok restoranı olan önce. */
export function cuisineCounts(list: readonly Pick<HomeSeller, 'cuisines'>[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of list) for (const c of s.cuisines) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

/** "800 m" veya "2,7 km" */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.max(Math.round(km * 10) * 100, 100)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Puanlayan sayısı: 1240 yerine "1200+", az olanda tam sayı. */
export function formatRatingCount(count: number): string {
  if (count < 50) return String(count);
  if (count < 1000) return `${Math.floor(count / 50) * 50}+`;
  return `${Math.floor(count / 100) * 100}+`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Kampanya bugün bitiyorsa kalan süre ("03:12:45"). Daha uzunsa, süresi geçtiyse veya tarihi yoksa null. */
export function campaignCountdown(expiresAt: string | null | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0 || left > DAY_MS) return null;
  const total = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
