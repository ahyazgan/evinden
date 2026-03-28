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

    // No session → login
    if (!session) {
      if (!inAuth || isAwaiting) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // Session but no profile shouldn't happen in demo, but safety net
    if (!profile) {
      if (!inAuth) {
        router.replace('/(auth)/register');
      }
      return;
    }

    // Buyer → customer area
    if (profile.role === 'buyer') {
      if (inAuth || inSeller) {
        router.replace('/(customer)');
      }
      return;
    }

    // Seller
    if (profile.role === 'seller') {
      if (profile.is_approved) {
        if (inAuth || (!inSeller && !inCustomer)) {
          router.replace('/(seller)/dashboard');
        }
      } else if (!isAwaiting) {
        router.replace('/(auth)/awaiting-approval');
      }
    }
  }, [loading, session, profile, segments, navState?.key, router]);

  return null;
}
