/** Bu süreden eski konum müşteriye güncelmiş gibi gösterilmez. */
export const COURIER_STALE_MS = 2 * 60 * 1000;

export type CourierLocation = {
  orderId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  updatedAt: string;
};

/** Veritabanı satırı. numeric kolonlar yola göre sayı ya da metin gelebilir. */
export function parseCourierLocation(row: Record<string, any> | null | undefined): CourierLocation | null {
  if (!row || row.lat == null || row.lng == null || !row.order_id || !row.updated_at) return null;
  const latitude = Number(row.lat);
  const longitude = Number(row.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const heading = row.heading == null ? null : Number(row.heading);
  return {
    orderId: String(row.order_id),
    latitude,
    longitude,
    heading: Number.isFinite(heading) ? heading : null,
    updatedAt: String(row.updated_at),
  };
}

/** Saat farkı yüzünden eksi çıkarsa sıfır sayılır. */
export function ageSeconds(updatedAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1000));
}

export function isLocationStale(updatedAt: string, now: number = Date.now()): boolean {
  const time = new Date(updatedAt).getTime();
  return Number.isNaN(time) || now - time > COURIER_STALE_MS;
}

/** 850 m, 1,2 km, 12 km */
export function formatDistance(km: number): string {
  const metres = Math.round(km * 100) * 10;
  if (metres < 1000) return `${Math.max(metres, 10)} m`;
  if (km < 9.95) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** az önce, 20 sn önce, 3 dk önce, 2 saat önce */
export function formatAge(seconds: number): string {
  if (seconds < 5) return 'az önce';
  if (seconds < 60) return `${seconds} sn önce`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`;
  return `${Math.floor(seconds / 3600)} saat önce`;
}

/** Müşterinin okuduğu tek satır. Teslimat noktası bilinmiyorsa distanceKm null gelir, mesafe uydurulmaz. */
export function courierStatusLine(
  location: Pick<CourierLocation, 'updatedAt'> | null,
  distanceKm: number | null,
  now: number = Date.now(),
): string {
  if (!location) return 'Kurye konumu henüz gelmedi';
  const age = formatAge(ageSeconds(location.updatedAt, now));
  if (isLocationStale(location.updatedAt, now)) return `Kurye konumu güncel değil · ${age}`;
  if (distanceKm == null) return `Kurye yolda · ${age}`;
  return `Kurye ${formatDistance(distanceKm)} uzakta · ${age}`;
}

export function openStreetMapUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}`;
}
