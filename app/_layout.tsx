import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Onboarding, shouldShowOnboarding } from '@/components/shared/Onboarding';
import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { registerForPushNotifications } from '@/lib/notifications';
import { registerForPushNotifications as registerExpoPush, addNotificationResponseListener } from '@/lib/push-notifications';
import { useAppFonts } from '@/lib/fonts';
import { colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart-context';
import { AddressProvider } from '@/lib/address-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { FavoritesProvider } from '@/lib/favorites-context';
import { ThemeProvider } from '@/lib/theme-context';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading, profile, session } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showLocation, setShowLocation] = useState<boolean | null>(null);
  const hasRedirected = useRef(false);

  // Role-based routing
  useEffect(() => {
    if (loading || !profile) return;
    const inAdmin = segments[0] === '(admin)';
    const inAuth = segments[0] === '(auth)';

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
      const data = response.notification.request.content.data;
      if (data?.type === 'order_status' && data?.orderId) {
        router.push('/(customer)/orders' as any);
      } else if (data?.type === 'promo') {
        router.push('/(customer)/campaign' as any);
      }
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
      {children}
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: t.background }]}>
          <ActivityIndicator size="large" color={t.primary} />
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

  if (!fontsLoaded) return null;

  return (
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
  );
}

const styles = StyleSheet.create({
  loading: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
