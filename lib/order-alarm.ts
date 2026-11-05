/**
 * Yeni sipariş alarmının kararları. React Native'e bağlı değildir, birim testi bunu sınar.
 */

export type AlarmOrder = {
  id: string;
  status: string;
  scheduled_for: string | null;
};

/** Sesin çalma aralığı. Ses 1,5 saniye sürer. */
export const ALARM_REPEAT_MS = 6_000;
/** Canlı bağlantı koparsa siparişi yine de yakalayan yoklama aralığı. */
export const ALARM_POLL_MS = 20_000;

/**
 * Yanıt bekleyen siparişler. Sunucudaki kural (034): planlı siparişte yanıt süresi yalnızca restoran
 * açıkken işler, restoran kapalıyken alarm çalmaz; açılınca o sipariş yine sayılır.
 * Normal siparişin süresi her zaman işler. Ödemesi bekleyen sipariş satıcıya henüz görünmez.
 */
export function ordersNeedingReply<T extends AlarmOrder>(orders: T[], isOpenNow: boolean): T[] {
  return orders.filter(order => order.status === 'pending' && (!order.scheduled_for || isOpenNow));
}

/** Ses açık mı: ayar açık ve sesi kapatılmamış en az bir sipariş var. */
export function shouldSound(needingIds: string[], mutedIds: string[], soundEnabled: boolean): boolean {
  if (!soundEnabled) return false;
  return needingIds.some(id => !mutedIds.includes(id));
}

/** "Sesi kapat": o an bekleyen siparişlerin hepsi susar, sonradan gelen yeni sipariş yine çalar. */
export function muteCurrent(needingIds: string[], mutedIds: string[]): string[] {
  return [...new Set([...mutedIds, ...needingIds])];
}

/** Artık yanıt beklemeyen sipariş listeden çıkar, liste büyümez. */
export function pruneMuted(mutedIds: string[], needingIds: string[]): string[] {
  return mutedIds.filter(id => needingIds.includes(id));
}

/** Aynı içerikte gereksiz yeniden çizimi önler. */
export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(id => b.includes(id));
}

export function alarmLabel(count: number): string {
  return `${count} yeni sipariş`;
}
