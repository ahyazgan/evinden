import AsyncStorage from '@react-native-async-storage/async-storage';

const REVIEWS_KEY = '@evinden_reviews';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhotoReview = {
  id: string;
  sellerId: string;
  userId: string;
  userName: string;
  rating: number; // 1-5
  comment: string;
  photoUri: string | null; // local URI from camera/gallery
  menuItemTitle: string | null;
  createdAt: string; // ISO
  helpful: number;
};

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function getReviews(sellerId?: string): Promise<PhotoReview[]> {
  try {
    const raw = await AsyncStorage.getItem(REVIEWS_KEY);
    const all: PhotoReview[] = raw ? JSON.parse(raw) : [];
    if (sellerId) return all.filter(r => r.sellerId === sellerId);
    return all;
  } catch {
    return [];
  }
}

export async function addReview(review: Omit<PhotoReview, 'id' | 'createdAt' | 'helpful'>): Promise<PhotoReview> {
  const full: PhotoReview = {
    ...review,
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    helpful: 0,
  };
  const all = await getReviews();
  const updated = [full, ...all];
  await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify(updated));
  return full;
}

export async function markHelpful(reviewId: string): Promise<void> {
  const all = await getReviews();
  const idx = all.findIndex(r => r.id === reviewId);
  if (idx >= 0) {
    all[idx].helpful += 1;
    await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify(all));
  }
}

export async function deleteReview(reviewId: string): Promise<void> {
  const all = await getReviews();
  const filtered = all.filter(r => r.id !== reviewId);
  await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify(filtered));
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function calcSellerStats(reviews: PhotoReview[]): {
  avgRating: number;
  totalReviews: number;
  distribution: Record<number, number>;
  photoCount: number;
} {
  if (reviews.length === 0) {
    return { avgRating: 0, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, photoCount: 0 };
  }

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let photoCount = 0;

  for (const r of reviews) {
    sum += r.rating;
    distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    if (r.photoUri) photoCount++;
  }

  return {
    avgRating: sum / reviews.length,
    totalReviews: reviews.length,
    distribution,
    photoCount,
  };
}
