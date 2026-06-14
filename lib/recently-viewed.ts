import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = '@evinden_recently_viewed';
const MAX_ITEMS = 10;

export function useRecentlyViewed() {
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setRecentIds(JSON.parse(raw));
        } catch {}
      }
    });
  }, []);

  const addRecent = useCallback(async (id: string) => {
    setRecentIds((prev) => {
      const filtered = prev.filter((x) => x !== id);
      const next = [id, ...filtered].slice(0, MAX_ITEMS);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { recentIds, addRecent };
}
