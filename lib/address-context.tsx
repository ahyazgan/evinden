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

export type SavedAddress = {
  id: string;
  label: string;       // "Ev", "İş", vb.
  addressLine: string;  // Mahalle, sokak, bina no
  floor?: string;       // Kat / daire
  isDefault: boolean;
};

type AddressContextValue = {
  addresses: SavedAddress[];
  addAddress: (addr: Omit<SavedAddress, 'id'>) => void;
  updateAddress: (id: string, updates: Partial<Omit<SavedAddress, 'id'>>) => void;
  removeAddress: (id: string) => void;
  setDefault: (id: string) => void;
  defaultAddress: SavedAddress | null;
};

const AddressContext = createContext<AddressContextValue | undefined>(undefined);

const STORAGE_KEY = '@evinden_addresses';

function generateId() {
  return 'addr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function AddressProvider({ children }: { children: ReactNode }) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setAddresses(JSON.parse(raw));
        } catch {}
      }
    });
  }, []);

  const persist = useCallback((next: SavedAddress[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const addAddress = useCallback(
    (addr: Omit<SavedAddress, 'id'>) => {
      setAddresses((prev) => {
        const isFirst = prev.length === 0;
        const newAddr: SavedAddress = {
          ...addr,
          id: generateId(),
          isDefault: isFirst ? true : addr.isDefault,
        };
        // If new one is default, unset others
        const updated = newAddr.isDefault
          ? prev.map((a) => ({ ...a, isDefault: false }))
          : prev;
        const next = [...updated, newAddr];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeAddress = useCallback(
    (id: string) => {
      setAddresses((prev) => {
        const next = prev.filter((a) => a.id !== id);
        // If we removed the default, make the first one default
        if (next.length > 0 && !next.some((a) => a.isDefault)) {
          next[0].isDefault = true;
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateAddress = useCallback(
    (id: string, updates: Partial<Omit<SavedAddress, 'id'>>) => {
      setAddresses((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...updates } : a));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setDefault = useCallback(
    (id: string) => {
      setAddresses((prev) => {
        const next = prev.map((a) => ({ ...a, isDefault: a.id === id }));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const defaultAddress = useMemo(
    () => addresses.find((a) => a.isDefault) ?? null,
    [addresses],
  );

  const value = useMemo(
    () => ({ addresses, addAddress, updateAddress, removeAddress, setDefault, defaultAddress }),
    [addresses, addAddress, updateAddress, removeAddress, setDefault, defaultAddress],
  );

  return <AddressContext.Provider value={value}>{children}</AddressContext.Provider>;
}

export function useAddresses() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddresses yalnızca AddressProvider içinde kullanılabilir');
  return ctx;
}
