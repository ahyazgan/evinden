import { Share, Platform } from 'react-native';
import { SITE_URL } from '@/constants/business';

// ─── Share helpers ───────────────────────────────────────────────────────────

export async function shareOrder(sellerName: string, itemTitles: string[]): Promise<void> {
  const items = itemTitles.slice(0, 3).join(', ');
  const more = itemTitles.length > 3 ? ` ve ${itemTitles.length - 3} ürün daha` : '';
  const message = `${sellerName} — ${items}${more} sipariş ettim! Afiyetli uygulamasıyla lezzetleri keşfet`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: SITE_URL } : {}),
  });
}

export async function shareSeller(sellerName: string, rating: number, district: string): Promise<void> {
  const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
  const message = `${sellerName} ${stars} (${rating.toFixed(1)})\n${district}\n\nMahallenin lezzetleri Afiyetli uygulamasında!`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: SITE_URL } : {}),
  });
}

export async function shareMenuItem(title: string, sellerName: string, priceTL: string): Promise<void> {
  const message = `${title} — ${priceTL}\n${sellerName} menüsünden!\n\nAfiyetli uygulamasıyla sipariş ver.`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: SITE_URL } : {}),
  });
}

export async function shareReview(sellerName: string, rating: number, comment: string): Promise<void> {
  const stars = '★'.repeat(rating);
  const message = `${stars} ${sellerName}\n"${comment}"\n\nAfiyetli'de mahallenin lezzetlerini keşfet!`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: SITE_URL } : {}),
  });
}
