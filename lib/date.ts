/** Sunucunun günlük stok için kullandığı gün (Europe/Istanbul). Türkiye yıl boyu UTC+3'tür. */
export function istanbulToday(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
