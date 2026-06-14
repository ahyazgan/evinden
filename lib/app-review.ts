import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REVIEW_KEY = '@evinden_review';
const ORDER_COUNT_KEY = '@evinden_order_count';
const REVIEW_THRESHOLD = 3; // 3. siparişten sonra sor

/** Sipariş sayısını artır ve gerekirse değerlendirme iste */
export async function trackOrderAndMaybeReview(): Promise<void> {
  try {
    const alreadyReviewed = await AsyncStorage.getItem(REVIEW_KEY);
    if (alreadyReviewed === 'true') return;

    const countStr = await AsyncStorage.getItem(ORDER_COUNT_KEY);
    const count = (parseInt(countStr ?? '0', 10) || 0) + 1;
    await AsyncStorage.setItem(ORDER_COUNT_KEY, count.toString());

    if (count >= REVIEW_THRESHOLD) {
      const isAvailable = await StoreReview.isAvailableAsync();
      if (isAvailable) {
        // Small delay so it doesn't interrupt order flow
        setTimeout(async () => {
          await StoreReview.requestReview();
          await AsyncStorage.setItem(REVIEW_KEY, 'true');
        }, 2000);
      }
    }
  } catch {
    // Silent fail — review prompt is non-critical
  }
}

/** Değerlendirme durumunu sıfırla (test için) */
export async function resetReviewStatus(): Promise<void> {
  await AsyncStorage.multiRemove([REVIEW_KEY, ORDER_COUNT_KEY]);
}
