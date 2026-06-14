import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@evinden_search_history';
const MAX_ITEMS = 10;

export const POPULAR_SEARCHES = [
  'Ev yemeği',
  'Börek',
  'Kahvaltı',
  'Köfte',
  'Çorba',
  'Tatlı',
  'Izgara',
  'Gözleme',
];

export async function getSearchHistory(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addSearchTerm(term: string): Promise<void> {
  const trimmed = term.trim();
  if (!trimmed) return;
  try {
    const list = await getSearchHistory();
    const filtered = list.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
    filtered.unshift(trimmed);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_ITEMS)));
  } catch {}
}

export async function removeSearchTerm(term: string): Promise<void> {
  try {
    const list = await getSearchHistory();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(list.filter(t => t !== term)),
    );
  } catch {}
}

export async function clearSearchHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}
