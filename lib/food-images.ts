/**
 * Uygulamayla gelen tanıtım görselleri.
 * Yalnızca tanıtım ve kategori alanlarında kullanılır; bir satıcının ürünü gibi gösterilmez.
 * Satıcı ve ürün kartları satıcının yüklediği fotoğrafı kullanır (bkz. FoodImage).
 */
export const CATEGORY_IMAGES = {
  ev: require('@/assets/images/categories/ev.jpg'),
  borek: require('@/assets/images/categories/borek.jpg'),
  izgara: require('@/assets/images/categories/izgara.jpg'),
  tatli: require('@/assets/images/categories/tatli.jpg'),
  kahvalti: require('@/assets/images/categories/kahvalti.jpg'),
};

/**
 * "Ne yesek?" satırının mutfak fotoğrafları (Nano Banana, aynı masa ve ışıkta çekilmiş gibi üretildi).
 * Anahtarlar lib/cuisines.ts ile aynı; fotoğrafı olmayan mutfak ikonla görünür.
 */
export const CUISINE_IMAGES: Partial<Record<string, number>> = {
  burger: require('@/assets/images/cuisines/burger.jpg'),
  doner: require('@/assets/images/cuisines/doner.jpg'),
  pizza: require('@/assets/images/cuisines/pizza.jpg'),
  kebap: require('@/assets/images/cuisines/kebap.jpg'),
  pide: require('@/assets/images/cuisines/pide.jpg'),
  tavuk: require('@/assets/images/cuisines/tavuk.jpg'),
  cigkofte: require('@/assets/images/cuisines/cigkofte.jpg'),
  esnaf: require('@/assets/images/cuisines/esnaf.jpg'),
  sandvic: require('@/assets/images/cuisines/sandvic.jpg'),
  tatli: require('@/assets/images/cuisines/tatli.jpg'),
  kahvalti: require('@/assets/images/cuisines/kahvalti.jpg'),
  kahve: require('@/assets/images/cuisines/kahve.jpg'),
};

/** Bölgede henüz restoran yokken gösterilen, fotoğrafı olan mutfaklar. */
export const PHOTO_CUISINES = Object.keys(CUISINE_IMAGES);

export const BANNER_IMAGES = {
  welcome: require('@/assets/images/banners/welcome.jpg'),
  delivery: require('@/assets/images/banners/delivery.jpg'),
  weekend: require('@/assets/images/banners/weekend.jpg'),
};

/** Kartlarda gösterilecek satıcı fotoğrafı: önce kapak, yoksa logo. */
export function sellerPhoto(seller: { cover_url?: string | null; logo_url?: string | null }): string | null {
  return seller.cover_url || seller.logo_url || null;
}
