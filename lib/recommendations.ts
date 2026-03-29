import AsyncStorage from '@react-native-async-storage/async-storage';

const ORDER_HISTORY_KEY = '@evinden_order_history';
const MAX_HISTORY = 50;

// ─── Types ───────────────────────────────────────────────────────────────────

export type OrderRecord = {
  id: string;
  sellerId: string;
  sellerName: string;
  items: { menuItemId: string; title: string; category?: string }[];
  totalCents: number;
  createdAt: string; // ISO
};

export type RecommendationType = 'reorder' | 'popular_now' | 'for_you' | 'time_based';

export type Recommendation = {
  type: RecommendationType;
  sellerId: string;
  sellerName: string;
  reason: string;
  score: number; // 0–100 for sorting
};

// ─── Order History (local) ───────────────────────────────────────────────────

export async function getOrderHistory(): Promise<OrderRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(ORDER_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addOrderToHistory(order: OrderRecord): Promise<void> {
  const history = await getOrderHistory();
  const updated = [order, ...history].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(updated));
}

// ─── Time-based popularity ───────────────────────────────────────────────────

type TimeSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

function getCurrentTimeSlot(): TimeSlot {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'snack';
  return 'dinner';
}

function getTimeSlotLabel(slot: TimeSlot): string {
  switch (slot) {
    case 'breakfast': return 'Kahvaltı saati';
    case 'lunch': return 'Öğle yemeği saati';
    case 'snack': return 'Atıştırmalık saati';
    case 'dinner': return 'Akşam yemeği saati';
  }
}

// Popular sellers per time slot (demo)
const TIME_POPULAR: Record<TimeSlot, string[]> = {
  breakfast: ['demo-6', 'demo-2'],
  lunch: ['demo-1', 'demo-3', 'demo-5'],
  snack: ['demo-4', 'demo-2'],
  dinner: ['demo-1', 'demo-3', 'demo-5'],
};

// ─── Demo trending data ──────────────────────────────────────────────────────

const TRENDING_SELLERS: Record<string, number> = {
  'demo-1': 87,
  'demo-3': 92,
  'demo-4': 65,
  'demo-6': 78,
};

// ─── Recommendation Engine ───────────────────────────────────────────────────

export async function getRecommendations(
  allSellerIds: string[],
  sellerNames: Record<string, string>,
): Promise<Recommendation[]> {
  const history = await getOrderHistory();
  const recommendations: Recommendation[] = [];

  // 1. Reorder — sellers user ordered from before
  const sellerOrderCount: Record<string, number> = {};
  const sellerLastOrder: Record<string, string> = {};
  for (const order of history) {
    sellerOrderCount[order.sellerId] = (sellerOrderCount[order.sellerId] ?? 0) + 1;
    if (!sellerLastOrder[order.sellerId] || order.createdAt > sellerLastOrder[order.sellerId]) {
      sellerLastOrder[order.sellerId] = order.createdAt;
    }
  }

  for (const [sellerId, count] of Object.entries(sellerOrderCount)) {
    recommendations.push({
      type: 'reorder',
      sellerId,
      sellerName: sellerNames[sellerId] ?? sellerId,
      reason: `${count}x sipariş verdiniz`,
      score: Math.min(count * 15 + 30, 95),
    });
  }

  // 2. Time-based popular
  const slot = getCurrentTimeSlot();
  const label = getTimeSlotLabel(slot);
  for (const sellerId of TIME_POPULAR[slot] ?? []) {
    if (!recommendations.some(r => r.sellerId === sellerId && r.type === 'reorder')) {
      recommendations.push({
        type: 'time_based',
        sellerId,
        sellerName: sellerNames[sellerId] ?? sellerId,
        reason: `${label} favorisi`,
        score: 60 + Math.random() * 20,
      });
    }
  }

  // 3. Trending / popular now
  for (const [sellerId, popularity] of Object.entries(TRENDING_SELLERS)) {
    if (!recommendations.some(r => r.sellerId === sellerId)) {
      recommendations.push({
        type: 'popular_now',
        sellerId,
        sellerName: sellerNames[sellerId] ?? sellerId,
        reason: `${popularity}+ sipariş bu hafta`,
        score: popularity * 0.7,
      });
    }
  }

  // 4. "For you" — based on favorite categories from history
  const catCount: Record<string, number> = {};
  for (const order of history) {
    for (const item of order.items) {
      const cat = item.category ?? 'Genel';
      catCount[cat] = (catCount[cat] ?? 0) + 1;
    }
  }
  const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
  if (topCat) {
    for (const sellerId of allSellerIds) {
      if (!recommendations.some(r => r.sellerId === sellerId)) {
        recommendations.push({
          type: 'for_you',
          sellerId,
          sellerName: sellerNames[sellerId] ?? sellerId,
          reason: `${topCat[0]} seviyorsunuz`,
          score: 40 + Math.random() * 15,
        });
      }
    }
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}
