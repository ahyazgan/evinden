/**
 * Bugün kalan porsiyon. Sunucudaki place_order ile aynı kural:
 * limit 0 ise sınırsızdır (null döner), sayaç yalnızca bugünün tarihindeyse geçerlidir.
 */
export function remainingToday(
  dailyLimit: number | null | undefined,
  soldToday: number | null | undefined,
  stockResetDate: string | null | undefined,
  today: string,
): number | null {
  if (!dailyLimit || dailyLimit <= 0) return null;
  const sold = stockResetDate === today ? soldToday ?? 0 : 0;
  return Math.max(dailyLimit - sold, 0);
}
