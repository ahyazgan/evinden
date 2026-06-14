import { useRouter } from 'expo-router';
import { useAuth } from './auth-context';

/**
 * Lazy-login hook: returns session/profile plus a `requireAuth` guard.
 * Call `requireAuth()` before any action that needs login.
 * Returns `true` if already logged in, `false` if redirecting to login.
 */
export function useRequireAuth() {
  const { session, profile, loading } = useAuth();
  const router = useRouter();

  const requireAuth = (): boolean => {
    if (session && profile) return true;
    router.push('/(auth)/login' as any);
    return false;
  };

  return { session, profile, loading, isLoggedIn: !!session, requireAuth };
}
