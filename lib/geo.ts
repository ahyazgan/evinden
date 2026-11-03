export type Coords = { latitude: number; longitude: number };

/** İki nokta arası kuş uçuşu mesafe. Sunucudaki distance_km ile aynı hesap (020). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type SellerArea = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  delivery_radius_km?: number | string | null;
};

export function sellerHasLocation(seller: SellerArea | null | undefined): boolean {
  return seller?.latitude != null && seller?.longitude != null;
}

/** Konumu bilinmeyen satıcı ya da müşteri için alan denetlenmez; asıl denetimi place_order yapar. */
export function isInDeliveryArea(seller: SellerArea, customer: Coords | null, defaultRadiusKm = 10): boolean {
  if (!customer || !sellerHasLocation(seller)) return true;
  const km = haversineKm(Number(seller.latitude), Number(seller.longitude), customer.latitude, customer.longitude);
  return km <= Number(seller.delivery_radius_km ?? defaultRadiusKm);
}

/** Elle seçilen konumlar 0,0 olarak kaydedilir: bunlar gerçek koordinat değildir. */
export function usableCoords(loc: { latitude?: number | null; longitude?: number | null } | null | undefined): Coords | null {
  if (!loc?.latitude || !loc?.longitude) return null;
  return { latitude: loc.latitude, longitude: loc.longitude };
}
