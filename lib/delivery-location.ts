import * as Location from 'expo-location';
import { getSavedLocation } from '@/components/shared/LocationPicker';
import { isInDeliveryArea, usableCoords, type Coords } from './geo';

const LOCATION_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
  ]);
}

/** Cihazın şu anki konumu. İzin verilmezse veya alınamazsa null döner. */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** Yazılı adresin koordinatı. Bulunamazsa null döner. */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  try {
    const results = await withTimeout(Location.geocodeAsync(address));
    const first = results?.[0];
    return first ? { latitude: first.latitude, longitude: first.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Teslimat koordinatı. Siparişin gideceği yer yazılan adrestir: adres başka bir ilçedeyse kayıtlı konum
 * sonucu bozmasın diye önce tek başına, sonra kayıtlı ilçeyle birlikte aranır ve satıcının alanına düşen
 * sonuç tercih edilir. Adres hiç bulunamazsa kayıtlı konuma, en son cihaz konumuna düşülür.
 */
export async function resolveDeliveryCoords(
  address: string,
  seller: Parameters<typeof isInDeliveryArea>[0],
): Promise<Coords | null> {
  const saved = await getSavedLocation().catch(() => null);
  const alone = await geocodeAddress(`${address}, Türkiye`);
  if (alone && isInDeliveryArea(seller, alone)) return alone;
  const withContext = saved ? await geocodeAddress(`${address}, ${saved.district}, ${saved.city}`) : null;
  if (withContext && isInDeliveryArea(seller, withContext)) return withContext;
  return alone ?? withContext ?? usableCoords(saved) ?? (await getCurrentCoords());
}
