import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const FAV_STORAGE_KEY = '@evinden_favorites';

type FavoritesContextValue = {
  favoriteIds: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  count: number;
};

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(FAV_STORAGE_KEY).then((raw) => {
      if (raw) {
        try { setFavoriteIds(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  const persist = useCallback((next: string[]) => {
    AsyncStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(id),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      setFavoriteIds((prev) => {
        const next = prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [id, ...prev];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const value = useMemo(
    () => ({ favoriteIds, isFavorite, toggleFavorite, count: favoriteIds.length }),
    [favoriteIds, isFavorite, toggleFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}
