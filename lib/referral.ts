import { Platform, Share } from 'react-native';

/** Uygulamayı paylaşır. Davet kodu ve ödül sistemi henüz yok; bu yüzden indirim vaadi içermez. */
export async function shareApp(): Promise<void> {
  await Share.share({
    message: "🍽️ Evinden'de mahallenin lezzetlerini keşfet!",
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}
