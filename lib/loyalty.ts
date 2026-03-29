import AsyncStorage from '@react-native-async-storage/async-storage';

const LOYALTY_KEY = '@evinden_loyalty';
const REFERRAL_KEY = '@evinden_referral';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcTier(totalOrders: number): LoyaltyData['tier'] {
  if (totalOrders >= 30) return 'platinum';
  if (totalOrders >= 15) return 'gold';
  if (totalOrders >= 5) return 'silver';
  return 'bronze';
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'EV';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function getLoyaltyData(): Promise<LoyaltyData> {
  try {
    const raw = await AsyncStorage.getItem(LOYALTY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    totalOrders: 0,
    totalSpentCents: 0,
    points: 0,
    tier: 'bronze',
    freeDeliveryEarned: 0,
    freeDeliveryUsed: 0,
    lastOrderDate: null,
    streakDays: 0,
    referralCode: generateReferralCode(),
    referralCount: 0,
    referralEarnings: 0,
  };
}

async function saveLoyaltyData(data: LoyaltyData): Promise<void> {
  await AsyncStorage.setItem(LOYALTY_KEY, JSON.stringify(data));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function recordOrder(totalCents: number): Promise<{
  pointsEarned: number;
  newTier: LoyaltyData['tier'];
  freeDeliveryUnlocked: boolean;
}> {
  const data = await getLoyaltyData();
  const tierConf = TIER_CONFIG[data.tier];
  const pointsEarned = Math.round((totalCents / 100) * tierConf.pointMultiplier);

  data.totalOrders += 1;
  data.totalSpentCents += totalCents;
  data.points += pointsEarned;
  data.lastOrderDate = new Date().toISOString();

  const newTier = calcTier(data.totalOrders);
  data.tier = newTier;

  // Every 10 orders = free delivery
  const freeDeliveryUnlocked = data.totalOrders % 10 === 0;
  if (freeDeliveryUnlocked) {
    data.freeDeliveryEarned += 1;
  }

  await saveLoyaltyData(data);
  return { pointsEarned, newTier, freeDeliveryUnlocked };
}

export async function redeemReward(rewardId: string): Promise<{ success: boolean; message: string }> {
  const reward = REWARDS.find(r => r.id === rewardId);
  if (!reward) return { success: false, message: 'Ödül bulunamadı' };

  const data = await getLoyaltyData();
  if (data.points < reward.pointsCost) {
    return { success: false, message: `Yetersiz puan. ${reward.pointsCost - data.points} puan daha gerekli.` };
  }

  data.points -= reward.pointsCost;
  if (reward.type === 'free_delivery') {
    data.freeDeliveryEarned += 1;
  }

  await saveLoyaltyData(data);
  return { success: true, message: `${reward.title} kazanıldı!` };
}

export async function recordReferral(): Promise<number> {
  const data = await getLoyaltyData();
  data.referralCount += 1;
  data.points += 30; // 30 points per referral
  data.referralEarnings += 1500; // ₺15 value
  await saveLoyaltyData(data);
  return data.referralCount;
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
