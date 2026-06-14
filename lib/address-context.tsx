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
import {
  fetchAddresses,
  createAddress as dbCreateAddress,
  updateAddress as dbUpdateAddress,
  deleteAddress as dbDeleteAddress,
  type AddressRow,
} from './db';

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

function rowToAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    addressLine: row.address,
    isDefault: row.is_default,
  };
}

export function AddressProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);

  // Load addresses: from Supabase if logged in, else AsyncStorage
  useEffect(() => {
    if (session?.userId) {
      fetchAddresses(session.userId)
        .then(rows => {
          if (rows.length > 0) {
            const addrs = rows.map(rowToAddress);
            setAddresses(addrs);
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(addrs)).catch(() => {});
          } else {
            // Load from local and sync to Supabase
            AsyncStorage.getItem(STORAGE_KEY).then(raw => {
              if (raw) try { setAddresses(JSON.parse(raw)); } catch {}
            });
          }
        })
        .catch(() => {
          AsyncStorage.getItem(STORAGE_KEY).then(raw => {
            if (raw) try { setAddresses(JSON.parse(raw)); } catch {}
          });
        });
    } else {
      AsyncStorage.getItem(STORAGE_KEY).then(raw => {
        if (raw) try { setAddresses(JSON.parse(raw)); } catch {}
      });
    }
  }, [session?.userId]);

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
        const updated = newAddr.isDefault
          ? prev.map((a) => ({ ...a, isDefault: false }))
          : prev;
        const next = [...updated, newAddr];
        persist(next);

        // Sync to Supabase
        if (session?.userId) {
          dbCreateAddress({
            user_id: session.userId,
            label: newAddr.label,
            address: newAddr.addressLine,
            is_default: newAddr.isDefault,
          }).then(row => {
            // Update ID with Supabase ID
            setAddresses(prev2 =>
              prev2.map(a => a.id === newAddr.id ? { ...a, id: row.id } : a)
            );
          }).catch(() => {});
        }

        return next;
      });
    },
    [persist, session?.userId],
  );

  const removeAddress = useCallback(
    (id: string) => {
      setAddresses((prev) => {
        const next = prev.filter((a) => a.id !== id);
        if (next.length > 0 && !next.some((a) => a.isDefault)) {
          next[0].isDefault = true;
        }
        persist(next);

        // Sync to Supabase
        if (session?.userId) {
          dbDeleteAddress(id).catch(() => {});
        }

        return next;
      });
    },
    [persist, session?.userId],
  );

  const updateAddress = useCallback(
    (id: string, updates: Partial<Omit<SavedAddress, 'id'>>) => {
      setAddresses((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...updates } : a));
        persist(next);

        // Sync to Supabase
        if (session?.userId) {
          const dbUpdates: Partial<Pick<AddressRow, 'label' | 'address' | 'is_default'>> = {};
          if (updates.label !== undefined) dbUpdates.label = updates.label;
          if (updates.addressLine !== undefined) dbUpdates.address = updates.addressLine;
          if (updates.isDefault !== undefined) dbUpdates.is_default = updates.isDefault;
          if (Object.keys(dbUpdates).length > 0) {
            dbUpdateAddress(id, dbUpdates).catch(() => {});
          }
        }

        return next;
      });
    },
    [persist, session?.userId],
  );

  const setDefault = useCallback(
    (id: string) => {
      setAddresses((prev) => {
        const next = prev.map((a) => ({ ...a, isDefault: a.id === id }));
        persist(next);

        // Sync to Supabase
        if (session?.userId) {
          // Unset all defaults then set the new one
          prev.forEach(a => {
            if (a.isDefault && a.id !== id) {
              dbUpdateAddress(a.id, { is_default: false }).catch(() => {});
            }
          });
          dbUpdateAddress(id, { is_default: true }).catch(() => {});
        }

        return next;
      });
    },
    [persist, session?.userId],
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
