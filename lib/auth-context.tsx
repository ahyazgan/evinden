import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { UserProfile } from '@/types';

const AUTH_STORAGE_KEY = '@evinden_demo_session';

type SellerApplicationData = {
  storeName: string;
  city: string;
  district: string;
  address: string;
  phone: string;
};

type AuthContextValue = {
  session: { userId: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'avatar_url'>>) => Promise<void>;
  demoLogin: (phone: string) => Promise<boolean>;
  demoRegister: (name: string, phone: string) => Promise<boolean>;
  applyAsSeller: (data: SellerApplicationData) => Promise<void>;
  approveSellerDemo: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ userId: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Load saved session on mount
  useEffect(() => {
    AsyncStorage.getItem(AUTH_STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw) as UserProfile;
          setSession({ userId: saved.id });
          setProfile(saved);
        } catch {}
      }
      setLoading(false);
    });
  }, []);

  const persistProfile = useCallback(async (p: UserProfile) => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(p)).catch(() => {});
  }, []);

  const refreshProfile = useCallback(async () => {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as UserProfile;
        setSession({ userId: saved.id });
        setProfile(saved);
      } catch {}
    }
  }, []);

  const demoLogin = useCallback(async (phone: string): Promise<boolean> => {
    // Check all demo accounts stored
    const accountsRaw = await AsyncStorage.getItem('@evinden_demo_accounts');
    let accounts: UserProfile[] = [];
    if (accountsRaw) {
      try { accounts = JSON.parse(accountsRaw); } catch {}
    }
    const found = accounts.find((a) => a.phone === phone);
    if (!found) return false;

    setSession({ userId: found.id });
    setProfile(found);
    await persistProfile(found);
    return true;
  }, [persistProfile]);

  const demoRegister = useCallback(async (name: string, phone: string): Promise<boolean> => {
    const newProfile: UserProfile = {
      id: 'user-' + Date.now().toString(36),
      name,
      phone,
      role: 'buyer',
      avatar_url: null,
      is_approved: true,
      seller_application: 'none',
      created_at: new Date().toISOString(),
    };

    // Save to accounts list
    const accountsRaw = await AsyncStorage.getItem('@evinden_demo_accounts');
    let accounts: UserProfile[] = [];
    if (accountsRaw) {
      try { accounts = JSON.parse(accountsRaw); } catch {}
    }
    // Remove old entry with same phone
    accounts = accounts.filter((a) => a.phone !== phone);
    accounts.push(newProfile);
    await AsyncStorage.setItem('@evinden_demo_accounts', JSON.stringify(accounts));

    // Set as current session
    setSession({ userId: newProfile.id });
    setProfile(newProfile);
    await persistProfile(newProfile);
    return true;
  }, [persistProfile]);

  const applyAsSeller = useCallback(async (data: SellerApplicationData) => {
    if (!profile) return;
    const updated: UserProfile = {
      ...profile,
      seller_application: 'pending',
      seller_store_name: data.storeName,
    };
    setProfile(updated);
    await persistProfile(updated);
    // Update in accounts list too
    const accountsRaw = await AsyncStorage.getItem('@evinden_demo_accounts');
    let accounts: UserProfile[] = [];
    if (accountsRaw) { try { accounts = JSON.parse(accountsRaw); } catch {} }
    accounts = accounts.map(a => a.id === updated.id ? updated : a);
    await AsyncStorage.setItem('@evinden_demo_accounts', JSON.stringify(accounts));
  }, [profile, persistProfile]);

  const approveSellerDemo = useCallback(async () => {
    if (!profile) return;
    const updated: UserProfile = {
      ...profile,
      role: 'seller',
      seller_application: 'approved',
      is_approved: true,
    };
    setProfile(updated);
    await persistProfile(updated);
    const accountsRaw = await AsyncStorage.getItem('@evinden_demo_accounts');
    let accounts: UserProfile[] = [];
    if (accountsRaw) { try { accounts = JSON.parse(accountsRaw); } catch {} }
    accounts = accounts.map(a => a.id === updated.id ? updated : a);
    await AsyncStorage.setItem('@evinden_demo_accounts', JSON.stringify(accounts));
  }, [profile, persistProfile]);

  const updateProfile = useCallback(async (updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'avatar_url'>>) => {
    if (!profile) return;
    const updated: UserProfile = { ...profile, ...updates };
    setProfile(updated);
    await persistProfile(updated);
    const accountsRaw = await AsyncStorage.getItem('@evinden_demo_accounts');
    let accounts: UserProfile[] = [];
    if (accountsRaw) { try { accounts = JSON.parse(accountsRaw); } catch {} }
    accounts = accounts.map(a => a.id === updated.id ? updated : a);
    await AsyncStorage.setItem('@evinden_demo_accounts', JSON.stringify(accounts));
  }, [profile, persistProfile]);

  const signOut = useCallback(async () => {
    setSession(null);
    setProfile(null);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ session, profile, loading, refreshProfile, updateProfile, demoLogin, demoRegister, applyAsSeller, approveSellerDemo, signOut }),
    [session, profile, loading, refreshProfile, updateProfile, demoLogin, demoRegister, applyAsSeller, approveSellerDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth yalnızca AuthProvider içinde kullanılabilir');
  }
  return ctx;
}
