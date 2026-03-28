import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AppUserRole, UserProfile } from '@/types';

const AUTH_STORAGE_KEY = '@evinden_demo_session';

type AuthContextValue = {
  session: { userId: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  demoLogin: (phone: string) => Promise<boolean>;
  demoRegister: (name: string, phone: string, role: AppUserRole) => Promise<boolean>;
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

  const demoRegister = useCallback(async (name: string, phone: string, role: AppUserRole): Promise<boolean> => {
    const newProfile: UserProfile = {
      id: 'user-' + Date.now().toString(36),
      name,
      phone,
      role,
      avatar_url: null,
      is_approved: role === 'buyer', // Sellers need approval
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

  const signOut = useCallback(async () => {
    setSession(null);
    setProfile(null);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ session, profile, loading, refreshProfile, demoLogin, demoRegister, signOut }),
    [session, profile, loading, refreshProfile, demoLogin, demoRegister, signOut],
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
