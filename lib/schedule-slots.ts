// Planlı sipariş için gün ve saat seçenekleri. Saf yardımcı: asıl kontrolü place_order yapar (033).
// Kurallar: en erken 45 dakika, en geç 7 gün sonrası, satıcının çalışma saatleri içinde, İstanbul saati.

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye yıl boyu UTC+3'tür
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const SCHEDULE_MIN_LEAD_MINUTES = 45;
export const SCHEDULE_MAX_DAYS = 7;
export const SCHEDULE_STEP_MINUTES = 30;
/** Müşteri ödemeyi tamamlarken seçtiği saat geçersiz kalmasın diye sunucu sınırının üstüne eklenir. */
export const SCHEDULE_BUFFER_MINUTES = 5;

export type ScheduleSlot = { iso: string; time: string };
export type ScheduleDay = { dateKey: string; label: string; slots: ScheduleSlot[] };

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/** İstanbul takvimindeki tarih ve saat parçaları. */
function localParts(at: Date) {
  const local = new Date(at.getTime() + ISTANBUL_OFFSET_MS);
  const iso = local.toISOString();
  return {
    dateKey: iso.slice(0, 10),
    time: iso.slice(11, 16),
    day: local.getUTCDate(),
    month: MONTHS[local.getUTCMonth()],
    weekday: WEEKDAYS[local.getUTCDay()],
  };
}

function dayOffset(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "Bugün", "Yarın" veya "Cmt 7 Kas" */
function dayLabel(at: Date, now: Date): string {
  const target = localParts(at);
  const offset = dayOffset(localParts(now).dateKey, target.dateKey);
  if (offset === 0) return 'Bugün';
  if (offset === 1) return 'Yarın';
  return `${target.weekday} ${target.day} ${target.month}`;
}

/**
 * Seçilebilir günler ve 30 dakikalık saatler. Boş gün listelenmez.
 * `isOpen` dışarıdan verilir: ekranda `isOpenAt(hours, istanbulClock(at))`, sunucudaki `seller_open_at` ile aynı kural.
 */
export function scheduleDays(isOpen: (at: Date) => boolean, now: Date = new Date()): ScheduleDay[] {
  const step = SCHEDULE_STEP_MINUTES * MINUTE_MS;
  const earliest = now.getTime() + (SCHEDULE_MIN_LEAD_MINUTES + SCHEDULE_BUFFER_MINUTES) * MINUTE_MS;
  const latest = now.getTime() + SCHEDULE_MAX_DAYS * DAY_MS;

  const days: ScheduleDay[] = [];
  // İstanbul UTC+3 olduğu için saat başı ve buçuk UTC'de de aynı adımlara denk gelir.
  for (let ms = Math.ceil(earliest / step) * step; ms <= latest; ms += step) {
    const at = new Date(ms);
    if (!isOpen(at)) continue;
    const { dateKey, time } = localParts(at);
    let day = days[days.length - 1];
    if (day?.dateKey !== dateKey) {
      day = { dateKey, label: dayLabel(at, now), slots: [] };
      days.push(day);
    }
    day.slots.push({ iso: at.toISOString(), time });
  }
  return days;
}

/** "bugün 12:30", "yarın 12:30" veya "Cmt 7 Kas 12:30" */
export function scheduledLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const label = dayLabel(at, now);
  return `${label === 'Bugün' ? 'bugün' : label === 'Yarın' ? 'yarın' : label} ${localParts(at).time}`;
}

/** Sipariş ekranlarındaki satır: "Planlı: yarın 12:30" */
export function plannedLabel(iso: string, now: Date = new Date()): string {
  return `Planlı: ${scheduledLabel(iso, now)}`;
}
