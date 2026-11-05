import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { latestOnly, loadProfileRow } from '@/lib/profile-load';
import { supabase } from './supabase';
import type { SellerDocumentType, SellerType } from './db';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';

import type { UserProfile } from '@/types';

WebBrowser.maybeCompleteAuthSession();

type SellerApplicationData = {
  storeName: string;
  city: string;
  district: string;
  address: string;
  phone: string;
  sellerType: SellerType;
  /** Yüklenmiş dosyaların depodaki yolları; restoran başvurusunda zorunludur. */
  documents: { docType: SellerDocumentType; path: string }[];
  /** Mağazanın konumu: teslimat alanı buradan hesaplanır. */
  latitude: number;
  longitude: number;
};

type AuthContextValue = {
  session: { userId: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'avatar_url'>>) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, name: string, marketingConsent?: boolean) => Promise<{ error: string | null }>;
  setMarketingConsent: (consent: boolean) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  applyAsSeller: (data: SellerApplicationData) => Promise<void>;
  signOut: () => Promise<void>;
  // Legacy demo support
  demoLogin: (phone: string) => Promise<boolean>;
  demoRegister: (name: string, phone: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Satıcı başvuru durumunu sunucudaki kayıtlardan türetir (yerel duruma güvenmez). */
async function deriveSellerApplication(
  userId: string,
  role: string,
  isApproved: boolean,
): Promise<'none' | 'pending' | 'approved'> {
  if (role === 'seller' && isApproved) return 'approved';
  const { data } = await supabase.from('sellers').select('id').eq('user_id', userId).maybeSingle();
  return data ? 'pending' : 'none';
}

// Map Supabase user to our UserProfile
async function fetchOrCreateProfile(user: User): Promise<UserProfile | null> {
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Kullanıcı';
  const newRow = {
    id: user.id,
    name: displayName,
    phone: user.phone || user.user_metadata?.phone || null,
    role: 'buyer',
    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    is_approved: true,
  };
  // Kayıt formundaki kampanya izni hesap bilgisinde bekler: e-posta onayı açıksa kayıt anında oturum ve
  // henüz yoktur, izin ilk girişte satırla birlikte yazılır. Sosyal girişte bu bilgi olmaz, izin kapalı kalır.
  const wantsMarketing = user.user_metadata?.marketing_consent === true;

  const row = await loadProfileRow<any>({
    read: async () => supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
    insert: async () => {
      const first = await supabase
        .from('users')
        .insert(wantsMarketing ? { ...newRow, marketing_consent: true } : newRow)
        .select()
        .single();
      // İzin yazılamadı diye hesap açılışı durmaz; kullanıcı Profil'den yeniden açabilir.
      if (first.error && first.error.code !== '23505' && wantsMarketing) {
        return supabase.from('users').insert(newRow).select().single();
      }
      return first;
    },
  });

  if (!row) {
    console.error('[auth] Profil okunamadı');
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    role: row.role as 'buyer' | 'seller' | 'admin',
    avatar_url: row.avatar_url,
    is_approved: row.is_approved,
    is_suspended: !!row.is_suspended,
    marketing_consent: !!row.marketing_consent,
    seller_application: await deriveSellerApplication(row.id, row.role, row.is_approved),
    created_at: row.created_at,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ userId: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for auth state changes
  useEffect(() => {
    // Açılışta ve sekmeye dönüşte birden çok yükleme başlayabilir: yalnızca sonuncusu yazılır.
    const begin = latestOnly();
    const load = async (user: User) => {
      const isLatest = begin();
      const p = await fetchOrCreateProfile(user).catch(() => null);
      if (isLatest()) setProfile(prev => p ?? (prev?.id === user.id ? prev : null));
    };

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s?.user) {
        setSession({ userId: s.user.id });
        await load(s.user);
      }
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' && s?.user) {
        const user = s.user;
        setSession({ userId: user.id });
        // Supabase bu geri çağırma bitene kadar oturum kilidini tutar. İçeride sorgu beklemek
        // kilitlenmeye yol açabilir, bu yüzden yükleme sonraki adıma bırakılır.
        setTimeout(() => { void load(user); }, 0);
      } else if (event === 'SIGNED_OUT') {
        begin();
        setSession(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
    if (data) {
      setProfile({
        id: data.id,
        name: data.name,
        phone: data.phone,
        role: data.role,
        is_suspended: !!data.is_suspended,
        marketing_consent: !!data.marketing_consent,
        avatar_url: data.avatar_url,
        is_approved: data.is_approved,
        seller_application: await deriveSellerApplication(data.id, data.role, data.is_approved),
        created_at: data.created_at,
      });
    }
  }, []);

  const updateProfile = useCallback(async (updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'avatar_url'>>) => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', profile.id)
      .select()
      .single();
    if (!error && data) {
      setProfile(prev => prev ? { ...prev, ...updates } : prev);
    }
  }, [profile]);

  // Sonucu çağırana döner: anahtar hata olunca geri alınır.
  const setMarketingConsent = useCallback(async (consent: boolean) => {
    if (!profile) return { error: 'Oturum yok' };
    const { data, error } = await supabase
      .from('users')
      .update({ marketing_consent: consent })
      .eq('id', profile.id)
      .select('marketing_consent')
      .single();
    if (error || !data) return { error: error?.message ?? 'Kaydedilemedi' };
    setProfile(prev => (prev ? { ...prev, marketing_consent: !!data.marketing_consent } : prev));
    return { error: null };
  }, [profile]);

  // Email/Password Sign In
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  // Email/Password Sign Up
  const signUpWithEmail = useCallback(async (email: string, password: string, name: string, marketingConsent = false) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, ...(marketingConsent ? { marketing_consent: true } : {}) },
      },
    });
    if (error) return { error: error.message };
    // For email confirmation disabled projects, user is auto-confirmed
    if (data.user && data.session) {
      // Profile will be created by onAuthStateChange
    }
    return { error: null };
  }, []);

  // Google OAuth
  const signInWithGoogle = useCallback(async () => {
    try {
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'afiyetli',
        path: 'auth/callback',
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) return { error: error.message };
      if (!data.url) return { error: 'OAuth URL alınamadı' };

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success') {
        const url = result.url;

        // Extract tokens — Supabase returns them in URL fragment (#access_token=...)
        // or as query params depending on config
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        // Try fragment first (most common for Supabase OAuth)
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
          const fragment = url.substring(hashIndex + 1);
          const fragParams = new URLSearchParams(fragment);
          accessToken = fragParams.get('access_token');
          refreshToken = fragParams.get('refresh_token');
        }

        // Fallback to query params
        if (!accessToken) {
          const qIndex = url.indexOf('?');
          if (qIndex !== -1) {
            const queryStr = url.substring(qIndex + 1).split('#')[0];
            const qParams = new URLSearchParams(queryStr);
            accessToken = qParams.get('access_token');
            refreshToken = qParams.get('refresh_token');
          }
        }

        // Some Supabase configs return a code instead of tokens
        if (!accessToken) {
          const qIndex = url.indexOf('?');
          if (qIndex !== -1) {
            const qParams = new URLSearchParams(url.substring(qIndex + 1));
            const code = qParams.get('code');
            if (code) {
              const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
              if (exchangeErr) return { error: exchangeErr.message };
              return { error: null };
            }
          }
        }

        if (accessToken && refreshToken) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionErr) return { error: sessionErr.message };
          return { error: null };
        }
        return { error: 'Token alınamadı. Supabase Google provider ayarlarını kontrol edin.' };
      }
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { error: 'Giriş iptal edildi' };
      }
      return { error: 'Bilinmeyen hata oluştu' };
    } catch (e: any) {
      return { error: e.message || 'Google giriş hatası' };
    }
  }, []);

  // Apple OAuth
  const signInWithApple = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        // Use native Apple auth on iOS
        const AppleAuth = require('expo-apple-authentication');
        const crypto = require('expo-crypto');

        const nonce = Math.random().toString(36).substring(2, 15);
        const hashedNonce = await crypto.digestStringAsync(
          crypto.CryptoDigestAlgorithm.SHA256,
          nonce
        );

        const credential = await AppleAuth.signInAsync({
          requestedScopes: [
            AppleAuth.AppleAuthenticationScope.FULL_NAME,
            AppleAuth.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });

        if (!credential.identityToken) {
          return { error: 'Apple identity token alınamadı' };
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce,
        });

        if (error) return { error: error.message };
        return { error: null };
      } else {
        // On Android/web, use OAuth flow
        const redirectUrl = AuthSession.makeRedirectUri({ path: 'auth/callback' });
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
          },
        });

        if (error) return { error: error.message };
        if (!data.url) return { error: 'OAuth URL alınamadı' };

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        if (result.type === 'success') {
          const url = result.url;
          const params = new URL(url);
          const accessToken = params.hash
            ? new URLSearchParams(params.hash.substring(1)).get('access_token')
            : params.searchParams.get('access_token');
          const refreshToken = params.hash
            ? new URLSearchParams(params.hash.substring(1)).get('refresh_token')
            : params.searchParams.get('refresh_token');

          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            return { error: null };
          }
          return { error: 'Token alınamadı' };
        }
        return { error: 'Giriş iptal edildi' };
      }
    } catch (e: any) {
      return { error: e.message || 'Apple giriş hatası' };
    }
  }, []);

  // Seller application
  const applyAsSeller = useCallback(async (data: SellerApplicationData) => {
    if (!profile) return;

    // Belgeler kaydedilemezse başvuru tekrar gönderilebilir: mevcut kayıt yeniden kullanılır.
    const { data: existing, error: readError } = await supabase
      .from('sellers')
      .select('id, seller_type')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (readError) throw readError;
    if (existing && existing.seller_type !== data.sellerType) {
      throw new Error('Mevcut başvurun farklı bir satıcı türüyle yapılmış. Değişiklik için destek ekibine yaz.');
    }

    let sellerId = existing?.id as string | undefined;
    if (!sellerId) {
      const { data: created, error } = await supabase
        .from('sellers')
        .insert({
          user_id: profile.id,
          display_name: data.storeName,
          city: data.city,
          district: data.district,
          address_line: data.address,
          seller_type: data.sellerType,
          latitude: data.latitude,
          longitude: data.longitude,
        })
        .select('id')
        .single();
      if (error) throw error;
      sellerId = created.id as string;
    }

    if (data.documents.length > 0) {
      const { error } = await supabase.from('seller_documents').upsert(
        data.documents.map(d => ({ seller_id: sellerId, doc_type: d.docType, storage_path: d.path })),
        { onConflict: 'seller_id,doc_type' },
      );
      if (error) throw error;
    }

    // Update local state
    setProfile(prev => prev ? {
      ...prev,
      seller_application: 'pending',
      seller_store_name: data.storeName,
    } : prev);
  }, [profile]);

  // Sign out
  const signOut = useCallback(async () => {
    setSession(null);
    setProfile(null);
    // Fire-and-forget: awaiting signOut hangs in RN due to navigator.locks
    supabase.auth.signOut().catch(() => undefined);
  }, []);

  // Legacy demo methods (for backward compatibility during transition)
  const demoLogin = useCallback(async (_phone: string): Promise<boolean> => {
    // Demo login now goes through email auth
    // This is kept for backward compatibility with demo button
    return false;
  }, []);

  const demoRegister = useCallback(async (_name: string, _phone: string): Promise<boolean> => {
    return false;
  }, []);

  const value = useMemo(
    () => ({
      session, profile, loading,
      refreshProfile, updateProfile, setMarketingConsent,
      signInWithEmail, signUpWithEmail,
      signInWithGoogle, signInWithApple,
      applyAsSeller,
      signOut,
      demoLogin, demoRegister,
    }),
    [session, profile, loading, refreshProfile, updateProfile, setMarketingConsent,
     signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple,
     applyAsSeller, signOut, demoLogin, demoRegister],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth yalnizca AuthProvider icinde kullanilabilir');
  }
  return ctx;
}
