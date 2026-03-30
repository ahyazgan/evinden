import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';
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
};

type AuthContextValue = {
  session: { userId: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'avatar_url'>>) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  applyAsSeller: (data: SellerApplicationData) => Promise<void>;
  approveSellerDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  // Legacy demo support
  demoLogin: (phone: string) => Promise<boolean>;
  demoRegister: (name: string, phone: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Map Supabase user to our UserProfile
async function fetchOrCreateProfile(user: User): Promise<UserProfile | null> {
  // Try to get existing profile
  const { data: existing, error: fetchErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (existing && !fetchErr) {
    return {
      id: existing.id,
      name: existing.name,
      phone: existing.phone,
      role: existing.role as 'buyer' | 'seller' | 'admin',
      avatar_url: existing.avatar_url,
      is_approved: existing.is_approved,
      seller_application: 'none',
      created_at: existing.created_at,
    };
  }

  // Create new profile for first-time users
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Kullanici';
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  const phone = user.phone || user.user_metadata?.phone || null;

  const { data: created, error: createErr } = await supabase
    .from('users')
    .insert({
      id: user.id,
      name: displayName,
      phone,
      role: 'buyer',
      avatar_url: avatarUrl,
      is_approved: true,
    })
    .select()
    .single();

  if (createErr) {
    console.error('[auth] Profile create error:', createErr.message);
    // Return a minimal profile so the app doesn't crash
    return {
      id: user.id,
      name: displayName,
      phone,
      role: 'buyer',
      avatar_url: avatarUrl,
      is_approved: true,
      seller_application: 'none',
      created_at: new Date().toISOString(),
    };
  }

  return {
    id: created.id,
    name: created.name,
    phone: created.phone,
    role: created.role as 'buyer' | 'seller' | 'admin',
    avatar_url: created.avatar_url,
    is_approved: created.is_approved,
    seller_application: 'none',
    created_at: created.created_at,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ userId: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s?.user) {
        setSession({ userId: s.user.id });
        const p = await fetchOrCreateProfile(s.user);
        setProfile(p);
      }
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (event === 'SIGNED_IN' && s?.user) {
        setSession({ userId: s.user.id });
        const p = await fetchOrCreateProfile(s.user);
        setProfile(p);
      } else if (event === 'SIGNED_OUT') {
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
        avatar_url: data.avatar_url,
        is_approved: data.is_approved,
        seller_application: 'none',
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

  // Email/Password Sign In
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  // Email/Password Sign Up
  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
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
        scheme: 'evinden',
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
      if (!data.url) return { error: 'OAuth URL alinamadi' };

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
        return { error: 'Token alinamadi. Supabase Google provider ayarlarini kontrol edin.' };
      }
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { error: 'Giris iptal edildi' };
      }
      return { error: 'Bilinmeyen hata olustu' };
    } catch (e: any) {
      return { error: e.message || 'Google giris hatasi' };
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
          return { error: 'Apple identity token alinamadi' };
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
        if (!data.url) return { error: 'OAuth URL alinamadi' };

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
          return { error: 'Token alinamadi' };
        }
        return { error: 'Giris iptal edildi' };
      }
    } catch (e: any) {
      return { error: e.message || 'Apple giris hatasi' };
    }
  }, []);

  // Seller application
  const applyAsSeller = useCallback(async (data: SellerApplicationData) => {
    if (!profile) return;

    // Create seller record in Supabase
    const { error } = await supabase.from('sellers').insert({
      user_id: profile.id,
      display_name: data.storeName,
      city: data.city,
      district: data.district,
      address_line: data.address,
    });

    if (error) {
      console.error('[auth] Seller application error:', error.message);
    }

    // Update local state
    setProfile(prev => prev ? {
      ...prev,
      seller_application: 'pending',
      seller_store_name: data.storeName,
    } : prev);
  }, [profile]);

  // Demo: approve seller
  const approveSellerDemo = useCallback(async () => {
    if (!profile) return;

    // Update user role in Supabase
    await supabase.from('users').update({ role: 'seller', is_approved: true }).eq('id', profile.id);

    setProfile(prev => prev ? {
      ...prev,
      role: 'seller',
      seller_application: 'approved',
      is_approved: true,
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
      refreshProfile, updateProfile,
      signInWithEmail, signUpWithEmail,
      signInWithGoogle, signInWithApple,
      applyAsSeller, approveSellerDemo,
      signOut,
      demoLogin, demoRegister,
    }),
    [session, profile, loading, refreshProfile, updateProfile,
     signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple,
     applyAsSeller, approveSellerDemo, signOut, demoLogin, demoRegister],
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
