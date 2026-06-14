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
import { useAuth } from './auth-context';
import { fetchFavorites, addFavorite, removeFavorite } from './db';

const FAV_STORAGE_KEY = '@evinden_favorites';

type FavoritesContextValue = {
  favoriteIds: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  count: number;
};

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  // Load favorites: from Supabase if logged in, else AsyncStorage
  useEffect(() => {
    if (session?.userId) {
      fetchFavorites(session.userId)
        .then(rows => {
          const ids = rows.map(r => r.seller_id);
          setFavoriteIds(ids);
          AsyncStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(ids)).catch(() => {});
        })
        .catch(() => {
          // Fallback to local
          AsyncStorage.getItem(FAV_STORAGE_KEY).then(raw => {
            if (raw) try { setFavoriteIds(JSON.parse(raw)); } catch {}
          });
        });
    } else {
      AsyncStorage.getItem(FAV_STORAGE_KEY).then(raw => {
        if (raw) try { setFavoriteIds(JSON.parse(raw)); } catch {}
      });
    }
  }, [session?.userId]);

  const persist = useCallback((next: string[]) => {
    AsyncStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(id),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      setFavoriteIds(prev => {
        const removing = prev.includes(id);
        const next = removing ? prev.filter(x => x !== id) : [id, ...prev];
        persist(next);

        // Sync to Supabase in background
        if (session?.userId) {
          if (removing) {
            removeFavorite(session.userId, id).catch(() => {});
          } else {
            addFavorite(session.userId, id).catch(() => {});
          }
        }

        return next;
      });
    },
    [persist, session?.userId],
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
