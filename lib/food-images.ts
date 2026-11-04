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

export const BANNER_IMAGES = {
  welcome: require('@/assets/images/banners/welcome.jpg'),
  delivery: require('@/assets/images/banners/delivery.jpg'),
  weekend: require('@/assets/images/banners/weekend.jpg'),
};

export const ONBOARDING_IMAGES = {
  slide1: require('@/assets/images/onboarding/slide1.jpg'),
  slide2: require('@/assets/images/onboarding/slide2.jpg'),
  slide3: require('@/assets/images/onboarding/slide3.jpg'),
  slide4: require('@/assets/images/onboarding/slide4.jpg'),
};

/** Kartlarda gösterilecek satıcı fotoğrafı: önce kapak, yoksa logo. */
export function sellerPhoto(seller: { cover_url?: string | null; logo_url?: string | null }): string | null {
  return seller.cover_url || seller.logo_url || null;
}
