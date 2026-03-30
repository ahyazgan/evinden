import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchReviews as dbFetchReviews, createReview as dbCreateReview, type ReviewRow } from './db';

const REVIEWS_KEY = '@evinden_reviews';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PhotoReview = {
  id: string;
  sellerId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  photoUri: string | null;
  menuItemTitle: string | null;
  createdAt: string;
  helpful: number;
  sellerReply?: string | null;
};

function rowToPhotoReview(row: ReviewRow): PhotoReview {
  return {
    id: row.id,
    sellerId: row.seller_id,
    userId: row.customer_id,
    userName: '',
    rating: row.rating,
    comment: row.comment ?? '',
    photoUri: row.photo_url,
    menuItemTitle: row.menu_item_title,
    createdAt: row.created_at,
    helpful: row.helpful_count,
    sellerReply: row.seller_reply,
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function getReviews(sellerId?: string): Promise<PhotoReview[]> {
  // Try Supabase first
  if (sellerId) {
    try {
      const rows = await dbFetchReviews(sellerId);
      if (rows.length > 0) return rows.map(rowToPhotoReview);
    } catch {}
  }

  // Fallback to AsyncStorage
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
  // Try Supabase
  try {
    const row = await dbCreateReview({
      seller_id: review.sellerId,
      customer_id: review.userId,
      rating: review.rating,
      comment: review.comment || undefined,
      photo_url: review.photoUri || undefined,
      menu_item_title: review.menuItemTitle || undefined,
    });
    const result = rowToPhotoReview(row);
    result.userName = review.userName;

    // Also cache locally
    const all = await getLocalReviews();
    await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify([result, ...all]));

    return result;
  } catch {
    // Fallback to local-only
    const full: PhotoReview = {
      ...review,
      id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      helpful: 0,
    };
    const all = await getLocalReviews();
    await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify([full, ...all]));
    return full;
  }
}

async function getLocalReviews(): Promise<PhotoReview[]> {
  try {
    const raw = await AsyncStorage.getItem(REVIEWS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function markHelpful(reviewId: string): Promise<void> {
  const all = await getLocalReviews();
  const idx = all.findIndex(r => r.id === reviewId);
  if (idx >= 0) {
    all[idx].helpful += 1;
    await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify(all));
  }
}

export async function deleteReview(reviewId: string): Promise<void> {
  const all = await getLocalReviews();
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
