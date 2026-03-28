import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/types';

type AuthContextValue = {
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

    if (error) {
      console.warn('[evinden] profil yüklenemedi', error.message);
      setProfile(null);
      return;
    }

    setProfile(data as UserProfile | null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) {
      setProfile(null);
      return;
    }
    await loadProfile(uid);
  }, [loadProfile]);

  useEffect(() => {
    let active = true;

    // DEMO MODU: Supabase yoksa mock profil kullan
    if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
      setProfile({
        id: 'demo-user',
        name: 'Demo Kullanıcı',
        phone: null,
        role: 'buyer',
        avatar_url: null,
        is_approved: true,
        created_at: new Date().toISOString(),
      });
      setLoading(false);
      return () => { active = false; };
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const s = data.session;
      setSession(s);
      if (s?.user) {
        await loadProfile(s.user.id);
      } else {
        setProfile(null);
      }
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession?.user) {
        await loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      refreshProfile,
    }),
    [session, profile, loading, refreshProfile],
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
