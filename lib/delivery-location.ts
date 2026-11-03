import * as Location from 'expo-location';
import { getSavedLocation } from '@/components/shared/LocationPicker';
import { usableCoords, type Coords } from './geo';

/** Cihazın şu anki konumu. İzin verilmezse veya alınamazsa null döner. */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch {
    return null;
  }
}

/** Yazılı adresin koordinatı. Bulunamazsa null döner. */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  try {
    const [first] = await Location.geocodeAsync(address);
    return first ? { latitude: first.latitude, longitude: first.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * Teslimat koordinatı: önce yazılan adres (siparişin gideceği yer odur), sonra kayıtlı konum,
 * en son cihaz konumu. Hiçbiri yoksa null döner ve sipariş sunucuda reddedilir.
 */
export async function resolveDeliveryCoords(address: string): Promise<Coords | null> {
  const saved = await getSavedLocation().catch(() => null);
  const context = saved ? `${address}, ${saved.district}, ${saved.city}` : address;
  return (await geocodeAddress(context)) ?? usableCoords(saved) ?? (await getCurrentCoords());
}
