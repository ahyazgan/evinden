const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye yıl boyu UTC+3'tür

/** Sunucunun günlük stok için kullandığı gün (Europe/Istanbul). */
export function istanbulToday(now: Date = new Date()): string {
  return new Date(now.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

export type Clock = {
  /** 0=Pazartesi ... 6=Pazar: seller_hours ve weekly_menu ile aynı */
  dayOfWeek: number;
  minutes: number;
};

export function istanbulClock(now: Date = new Date()): Clock {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  return {
    dayOfWeek: (local.getUTCDay() + 6) % 7,
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

type HoursRow = {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_open: boolean;
};

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Sunucudaki `seller_open_at` ile aynı kurallar (018). Yalnızca gösterim içindir;
 * asıl kontrolü `place_order` yapar. Hiç saat girilmemişse satıcı açık sayılır.
 */
export function isOpenAt(hours: HoursRow[], clock: Clock): boolean {
  const prev = hours.find(h => h.day_of_week === (clock.dayOfWeek + 6) % 7);
  if (prev?.is_open && prev.open_time && prev.close_time) {
    const prevClose = toMinutes(prev.close_time);
    if (prevClose < toMinutes(prev.open_time) && clock.minutes < prevClose) return true;
  }

  const today = hours.find(h => h.day_of_week === clock.dayOfWeek);
  if (!today) return true;
  if (!today.is_open) return false;
  if (!today.open_time || !today.close_time) return true;

  const open = toMinutes(today.open_time);
  const close = toMinutes(today.close_time);
  if (close < open) return clock.minutes >= open;
  return clock.minutes >= open && clock.minutes < close;
}
