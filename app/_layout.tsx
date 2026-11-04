import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Onboarding, shouldShowOnboarding } from '@/components/shared/Onboarding';
import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { initErrorTracking, setUser } from '@/lib/error-tracking';
import { checkForUpdate } from '@/lib/force-update';
import { registerForPushNotifications } from '@/lib/notifications';
import { registerForPushNotifications as registerExpoPush, addNotificationResponseListener } from '@/lib/push-notifications';
import { useAppFonts } from '@/lib/fonts';
import { notificationRoute, notificationRoleOf } from '@/lib/notification-route';
import '@/lib/recovery-link';
import { Logo } from '@/components/shared/Logo';
import { colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart-context';
import { AddressProvider } from '@/lib/address-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { FavoritesProvider } from '@/lib/favorites-context';
import { ThemeProvider } from '@/lib/theme-context';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading, profile, session, signOut } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showLocation, setShowLocation] = useState<boolean | null>(null);
  const hasRedirected = useRef(false);
  const roleRef = useRef<string | undefined>(undefined);
  roleRef.current = profile?.role;

  useEffect(() => {
    if (!loading && !session) setUser(null);
  }, [loading, session]);

  // Askıya alınan hesap oturumda kalamaz.
  useEffect(() => {
    if (!profile?.is_suspended) return;
    Alert.alert('Hesabın askıya alındı', 'Destek için destek@evinden.app adresine yaz.');
    signOut();
  }, [profile?.is_suspended]);

  // Role-based routing
  useEffect(() => {
    if (loading || !profile) return;
    setUser({ id: profile.id });
    const inAdmin = segments[0] === '(admin)';
    const inAuth = segments[0] === '(auth)';

    // Şifre yenilerken yönlendirme yapılmaz, yoksa yönetici formu göremeden panele düşer.
    if ((segments as string[])[1] === 'reset-password') return;

    if (profile.role === 'admin' && !inAdmin) {
      if (!hasRedirected.current) {
        hasRedirected.current = true;
        router.replace('/(admin)/dashboard' as any);
      }
    } else if (profile.role !== 'admin' && inAdmin) {
      router.replace('/(customer)' as any);
    }
  }, [loading, profile, segments]);

  useEffect(() => {
    if (!loading) {
      hasRedirected.current = false;
      SplashScreen.hideAsync().catch(() => undefined);
      shouldShowOnboarding().then(setShowOnboarding);
      getSavedLocation().then(loc => setShowLocation(!loc));
      checkForUpdate().catch(() => undefined);
      registerForPushNotifications().catch(() => undefined);
      registerExpoPush().then(async (token) => {
        if (token && session?.userId) {
          const { savePushToken } = await import('@/lib/db');
          savePushToken(session.userId, token).catch(() => undefined);
        }
      }).catch(() => undefined);
    }
  }, [loading]);

  // Handle notification taps
  useEffect(() => {
    const sub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const role = notificationRoleOf(roleRef.current);
      const route = notificationRoute(typeof data?.type === 'string' ? data.type : null, data, role);
      if (route) router.push(route as any);
    });
    return () => sub.remove();
  }, []);

  const onOnboardingDone = () => {
    setShowOnboarding(false);
    // After onboarding, check if location is needed
  };

  const onLocationDone = (_loc: UserLocation) => {
    setShowLocation(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style="light" />
      {children}
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: colors.secondary }]}>
          <Logo size={88} tone="onBrand" />
          <ActivityIndicator size="small" color="#C8F031" style={styles.spinner} />
        </View>
      ) : null}
      {showOnboarding === true && (
        <Onboarding onDone={onOnboardingDone} />
      )}
      {showOnboarding === false && showLocation === true && (
        <LocationPicker onDone={onLocationDone} />
      )}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useAppFonts();

  initErrorTracking();

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
    <AuthProvider>
      <FavoritesProvider>
      <AddressProvider>
      <CartProvider>
      <SplashOverlay>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </SplashOverlay>
      </CartProvider>
      </AddressProvider>
      </FavoritesProvider>
    </AuthProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: { marginTop: 20 },
});
