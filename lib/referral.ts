import { Platform, Share } from 'react-native';
import { supabase } from './supabase';

/** Kullanıcının davet kodu. Giriş yapılmamışsa null döner. */
export async function getMyReferralCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_referral_code');
  return error ? null : (data as string);
}

/** Bu kullanıcı daha önce davet kodu kullandı mı? RLS kullanıcının kendi kayıtlarını gösterir. */
export async function hasUsedReferralCode(userId: string): Promise<boolean> {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referred_id', userId);
  return (count ?? 0) > 0;
}

/** Davet kodunu uygular. Kurallar sunucudadır (021); başarıda kupon kodu mesajda döner. */
export async function applyReferralCode(code: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('apply_referral_code', { p_code: code });
  if (error) {
    return { success: false, message: error.code === '55000' ? error.message : 'Tekrar dene.' };
  }
  return {
    success: true,
    message: `₺15 indirim kuponun: ${data}\n₺50 ve üzeri siparişte, 90 gün içinde kullanabilirsin.`,
  };
}

export async function shareReferralCode(code: string): Promise<void> {
  await Share.share({
    message: `Evinden'de mahallenin lezzetlerini keşfet! Davet kodum: ${code} — kodu girince ₺15 indirim kazanırsın.`,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}
