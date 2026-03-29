import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share, Platform } from 'react-native';

const REFERRAL_KEY = '@evinden_referral_data';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReferralData = {
  myCode: string;
  referredBy: string | null;
  invitedUsers: { name: string; date: string; rewardClaimed: boolean }[];
  totalEarned: number; // cents
};

// ─── Storage ─────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'EV';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function getReferralData(): Promise<ReferralData> {
  try {
    const raw = await AsyncStorage.getItem(REFERRAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const data: ReferralData = {
    myCode: generateCode(),
    referredBy: null,
    invitedUsers: [],
    totalEarned: 0,
  };
  await AsyncStorage.setItem(REFERRAL_KEY, JSON.stringify(data));
  return data;
}

async function saveReferralData(data: ReferralData): Promise<void> {
  await AsyncStorage.setItem(REFERRAL_KEY, JSON.stringify(data));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function applyReferralCode(code: string): Promise<{ success: boolean; message: string }> {
  const data = await getReferralData();
  if (data.referredBy) {
    return { success: false, message: 'Zaten bir davet kodu kullandınız.' };
  }
  if (code.toUpperCase() === data.myCode) {
    return { success: false, message: 'Kendi kodunuzu kullanamazsınız.' };
  }
  data.referredBy = code.toUpperCase();
  await saveReferralData(data);
  return { success: true, message: 'Davet kodu uygulandı! İlk siparişinizde ₺15 indirim kazandınız.' };
}

export async function recordSuccessfulReferral(invitedName: string): Promise<void> {
  const data = await getReferralData();
  data.invitedUsers.push({
    name: invitedName,
    date: new Date().toISOString(),
    rewardClaimed: false,
  });
  data.totalEarned += 1500; // ₺15 per referral
  await saveReferralData(data);
}

// ─── Share ───────────────────────────────────────────────────────────────────

export async function shareReferralCode(): Promise<void> {
  const data = await getReferralData();
  const message = `🍽️ Evinden'de ev yapımı lezzetleri keşfet! Davet kodum: ${data.myCode} — İlk siparişinde ₺15 indirim kazanırsın!`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}

export function getReferralRewardText(): string {
  return 'Arkadaşın üye olup ilk siparişini verdiğinde, ikinize de ₺15 indirim!';
}
