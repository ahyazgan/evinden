import { Share, Platform } from 'react-native';

// ─── Share helpers ───────────────────────────────────────────────────────────

export async function shareOrder(sellerName: string, itemTitles: string[]): Promise<void> {
  const items = itemTitles.slice(0, 3).join(', ');
  const more = itemTitles.length > 3 ? ` ve ${itemTitles.length - 3} ürün daha` : '';
  const message = `🍽️ ${sellerName} — ${items}${more} sipariş ettim! Evinden uygulamasıyla ev yapımı lezzetleri keşfet 😋`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}

export async function shareSeller(sellerName: string, rating: number, district: string): Promise<void> {
  const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
  const message = `${sellerName} ${stars} (${rating.toFixed(1)})\n📍 ${district}\n\n🍽️ Ev yapımı lezzetler Evinden uygulamasında!`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}

export async function shareMenuItem(title: string, sellerName: string, priceTL: string): Promise<void> {
  const message = `😋 ${title} — ${priceTL}\n${sellerName} mutfağından!\n\n🍽️ Evinden uygulamasıyla sipariş ver.`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}

export async function shareReview(sellerName: string, rating: number, comment: string): Promise<void> {
  const stars = '★'.repeat(rating);
  const message = `${stars} ${sellerName}\n"${comment}"\n\n🍽️ Evinden'de ev yapımı lezzetleri keşfet!`;

  await Share.share({
    message,
    ...(Platform.OS === 'ios' ? { url: 'https://evinden.app' } : {}),
  });
}
