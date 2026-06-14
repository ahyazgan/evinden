import AsyncStorage from '@react-native-async-storage/async-storage';

const SCHEDULE_KEY = '@evinden_menu_schedule';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Pazartesi, 6=Pazar

export const DAY_LABELS: Record<DayOfWeek, string> = {
  0: 'Pazartesi',
  1: 'Salı',
  2: 'Çarşamba',
  3: 'Perşembe',
  4: 'Cuma',
  5: 'Cumartesi',
  6: 'Pazar',
};

export type ScheduleEntry = {
  menuItemId: string;
  menuItemTitle: string;
  days: DayOfWeek[]; // which days this item is available
  startTime: string; // "09:00"
  endTime: string;   // "21:00"
};

export type MenuSchedule = {
  sellerId: string;
  entries: ScheduleEntry[];
  updatedAt: string;
};

// ─── Storage ─────────────────────────────────────────────────────────────────

export async function getSchedule(sellerId: string): Promise<MenuSchedule | null> {
  try {
    const raw = await AsyncStorage.getItem(`${SCHEDULE_KEY}_${sellerId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveSchedule(schedule: MenuSchedule): Promise<void> {
  schedule.updatedAt = new Date().toISOString();
  await AsyncStorage.setItem(`${SCHEDULE_KEY}_${schedule.sellerId}`, JSON.stringify(schedule));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getTodayDay(): DayOfWeek {
  const jsDay = new Date().getDay(); // 0=Sunday
  return (jsDay === 0 ? 6 : jsDay - 1) as DayOfWeek;
}

export function getAvailableItemsForNow(schedule: MenuSchedule | null): string[] {
  if (!schedule) return [];

  const today = getTodayDay();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return schedule.entries
    .filter(entry => {
      if (!entry.days.includes(today)) return false;
      const [sh, sm] = entry.startTime.split(':').map(Number);
      const [eh, em] = entry.endTime.split(':').map(Number);
      return nowMinutes >= sh * 60 + sm && nowMinutes <= eh * 60 + em;
    })
    .map(entry => entry.menuItemId);
}

export function getDaySchedule(schedule: MenuSchedule | null, day: DayOfWeek): ScheduleEntry[] {
  if (!schedule) return [];
  return schedule.entries.filter(entry => entry.days.includes(day));
}

// ─── Demo schedule ───────────────────────────────────────────────────────────

export function getDemoSchedule(sellerId: string): MenuSchedule {
  const allDays: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
  const weekdays: DayOfWeek[] = [0, 1, 2, 3, 4];
  const weekend: DayOfWeek[] = [5, 6];

  const schedules: Record<string, ScheduleEntry[]> = {
    'demo-1': [
      { menuItemId: 'm1-1', menuItemTitle: 'Karnıyarık', days: [0, 2, 4], startTime: '11:00', endTime: '21:00' },
      { menuItemId: 'm1-2', menuItemTitle: 'Pilav Üstü Kuru', days: weekdays, startTime: '11:00', endTime: '21:00' },
      { menuItemId: 'm1-3', menuItemTitle: 'Köfte', days: [1, 3, 5], startTime: '11:00', endTime: '21:00' },
      { menuItemId: 'm1-4', menuItemTitle: 'Mevsim Salata', days: allDays, startTime: '09:00', endTime: '21:00' },
    ],
    'demo-6': [
      { menuItemId: 'm6-1', menuItemTitle: 'Serpme Kahvaltı', days: weekend, startTime: '07:00', endTime: '14:00' },
      { menuItemId: 'm6-2', menuItemTitle: 'Gözleme', days: allDays, startTime: '07:00', endTime: '14:00' },
      { menuItemId: 'm6-3', menuItemTitle: 'Menemen', days: weekdays, startTime: '07:00', endTime: '11:00' },
    ],
  };

  return {
    sellerId,
    entries: schedules[sellerId] ?? [],
    updatedAt: new Date().toISOString(),
  };
}
