import { fetchLoyalty, redeemLoyaltyReward, type LoyaltyRow } from './db';
import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LoyaltyData = {
  totalOrders: number;
  totalSpentCents: number;
  points: number; // 1 TL = 1 point
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  freeDeliveryEarned: number; // how many free deliveries earned
  freeDeliveryUsed: number;
  lastOrderDate: string | null;
  streakDays: number; // consecutive weeks with orders
  referralCode: string;
  referralCount: number;
  referralEarnings: number; // cents earned from referrals
};

export type LoyaltyReward = {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  icon: string;
  type: 'free_delivery' | 'discount_10' | 'discount_20' | 'discount_30';
};

// ─── Tier config ─────────────────────────────────────────────────────────────

export const TIER_CONFIG = {
  bronze: { label: 'Bronz', icon: '🥉', minOrders: 0, pointMultiplier: 1, color: '#CD7F32' },
  silver: { label: 'Gümüş', icon: '🥈', minOrders: 5, pointMultiplier: 1.25, color: '#C0C0C0' },
  gold: { label: 'Altın', icon: '🥇', minOrders: 15, pointMultiplier: 1.5, color: '#FFD700' },
  platinum: { label: 'Platin', icon: '💎', minOrders: 30, pointMultiplier: 2, color: '#E5E4E2' },
} as const;

export const REWARDS: LoyaltyReward[] = [
  { id: 'free_del', title: 'Ücretsiz Teslimat', description: 'Bir sonraki siparişte ücretsiz teslimat', pointsCost: 50, icon: '🚚', type: 'free_delivery' },
  { id: 'disc_10', title: '₺10 İndirim', description: '₺10 anında indirim kuponu', pointsCost: 80, icon: '🏷️', type: 'discount_10' },
  { id: 'disc_20', title: '₺20 İndirim', description: '₺20 anında indirim kuponu', pointsCost: 150, icon: '🎁', type: 'discount_20' },
  { id: 'disc_30', title: '₺30 İndirim', description: '₺30 süper indirim kuponu', pointsCost: 250, icon: '🎉', type: 'discount_30' },
];

// ─── Storage ─────────────────────────────────────────────────────────────────

export const EMPTY_LOYALTY: LoyaltyData = {
  totalOrders: 0,
  totalSpentCents: 0,
  points: 0,
  tier: 'bronze',
  freeDeliveryEarned: 0,
  freeDeliveryUsed: 0,
  lastOrderDate: null,
  streakDays: 0,
  referralCode: '',
  referralCount: 0,
  referralEarnings: 0,
};

function rowToData(row: LoyaltyRow): LoyaltyData {
  return {
    totalOrders: row.total_orders,
    totalSpentCents: row.total_spent,
    points: row.points,
    tier: row.tier,
    freeDeliveryEarned: row.free_deliveries_earned,
    freeDeliveryUsed: row.free_deliveries_used,
    lastOrderDate: row.last_order_date,
    streakDays: row.streak_days,
    referralCode: row.referral_code ?? '',
    referralCount: row.referral_count,
    referralEarnings: row.referral_earnings,
  };
}

/** Puanlar sunucudadır: teslim edilen siparişte verilir, istemci yazamaz (018). */
export async function getLoyaltyData(): Promise<LoyaltyData> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY_LOYALTY;
  const row = await fetchLoyalty(user.id);
  return row ? rowToData(row) : EMPTY_LOYALTY;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Puan karşılığı kişiye özel kupon alır. Kod sepette kullanılır. */
export async function redeemReward(rewardId: string): Promise<{ success: boolean; message: string }> {
  try {
    const code = await redeemLoyaltyReward(rewardId);
    return { success: true, message: `Kupon kodunuz: ${code}\nSepette kullanabilirsiniz, 90 gün geçerlidir.` };
  } catch (e: any) {
    return { success: false, message: e?.code === '55000' ? 'Puanınız bu ödül için yetersiz.' : 'Lütfen tekrar deneyin.' };
  }
}

// ─── Progress helpers ────────────────────────────────────────────────────────

export function getNextTierProgress(data: LoyaltyData): { nextTier: string; ordersNeeded: number; progress: number } | null {
  const tiers = ['bronze', 'silver', 'gold', 'platinum'] as const;
  const idx = tiers.indexOf(data.tier);
  if (idx >= tiers.length - 1) return null;

  const next = tiers[idx + 1];
  const needed = TIER_CONFIG[next].minOrders;
  const progress = Math.min(data.totalOrders / needed, 1);
  return { nextTier: TIER_CONFIG[next].label, ordersNeeded: needed - data.totalOrders, progress };
}

export function getFreeDeliveryProgress(data: LoyaltyData): { current: number; next: number; progress: number } {
  const current = data.totalOrders % 10;
  return { current, next: 10, progress: current / 10 };
}
