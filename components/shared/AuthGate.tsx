import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/lib/auth-context';

export function AuthGate() {
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();

  useEffect(() => {
    if (loading || !navState?.key) return;

    const seg0 = segments[0];
    const seg1 = segments.at(1);
    const inAuth = seg0 === '(auth)';
    const inCustomer = seg0 === '(customer)';
    const inSeller = seg0 === '(seller)';

    const isAwaiting = inAuth && seg1 === 'awaiting-approval';
    const isRegister = inAuth && seg1 === 'register';

    if (!session) {
      if (!inAuth || isAwaiting) {
        router.replace('/(auth)/login');
      }
      return;
    }

    if (!profile) {
      if (!isRegister) {
        router.replace('/(auth)/register');
      }
      return;
    }

    if (profile.role === 'buyer') {
      if (inAuth || inSeller) {
        router.replace('/(customer)');
      }
      return;
    }

    if (profile.role === 'seller') {
      if (profile.is_approved) {
        if (!inSeller || inAuth) {
          router.replace('/(seller)/dashboard');
        }
      } else if (!isAwaiting) {
        router.replace('/(auth)/awaiting-approval');
      }
    }
  }, [loading, session, profile, segments, navState?.key, router]);

  return null;
}
