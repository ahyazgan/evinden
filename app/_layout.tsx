import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { track } from '@/lib/analytics';
import { initErrorTracking, setUser } from '@/lib/error-tracking';
import { checkForUpdate } from '@/lib/force-update';
import { registerForPushNotifications } from '@/lib/notifications';
import { registerForPushNotifications as registerExpoPush, addNotificationResponseListener } from '@/lib/push-notifications';
import { fonts, useAppFonts } from '@/lib/fonts';
import { notificationRoute, notificationRoleOf } from '@/lib/notification-route';
import '@/lib/recovery-link';
import '@/lib/web-alert';
import { Logo } from '@/components/shared/Logo';
import { colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart-context';
import { AddressProvider } from '@/lib/address-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { FavoritesProvider } from '@/lib/favorites-context';
import { ThemeProvider } from '@/lib/theme-context';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const INTRO_MS = 1600;

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading, profile, session, signOut } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  // Animasyon en az bir tur görünür, hızlı açılışta ekran yanıp sönmez.
  const [introDone, setIntroDone] = useState(false);
  const [showLocation, setShowLocation] = useState<boolean | null>(null);
  const hasRedirected = useRef(false);
  const roleRef = useRef<string | undefined>(undefined);
  roleRef.current = profile?.role;

  useEffect(() => {
    // Yerel açılış görseli hemen kalkar, beklemeyi logo animasyonu karşılar.
    SplashScreen.hideAsync().catch(() => undefined);
    const timer = setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && !session) setUser(null);
  }, [loading, session]);

  // Askıya alınan hesap oturumda kalamaz.
  useEffect(() => {
    if (!profile?.is_suspended) return;
    Alert.alert('Hesabın askıya alındı', 'Destek için destek@afiyetli.app adresine yaz.');
    signOut();
  }, [profile?.is_suspended]);

  // Role-based routing
  useEffect(() => {
    if (loading || !profile) return;
    setUser({ id: profile.id });
    const inAdmin = segments[0] === 'yonetim';
    const inAuth = segments[0] === '(auth)';

    // Şifre yenilerken yönlendirme yapılmaz, yoksa yönetici formu göremeden panele düşer.
    if ((segments as string[])[1] === 'reset-password') return;

    if (profile.role === 'admin' && !inAdmin) {
      if (!hasRedirected.current) {
        hasRedirected.current = true;
        router.replace('/yonetim/dashboard' as any);
      }
    } else if (profile.role !== 'admin' && inAdmin) {
      router.replace('/(customer)' as any);
    }
  }, [loading, profile, segments]);

  useEffect(() => {
    if (!loading) {
      hasRedirected.current = false;
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

  const onLocationDone = (_loc: UserLocation) => {
    setShowLocation(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style="light" />
      {children}
      {loading || !introDone ? (
        <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: colors.secondary }]}>
          <Logo size={88} tone="onBrand" animated />
          <Text style={styles.slogan}>Afiyetli olsun.</Text>
        </View>
      ) : null}
      {!loading && introDone && showLocation === true && (
        <LocationPicker onDone={onLocationDone} />
      )}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useAppFonts();

  initErrorTracking();

  useEffect(() => { track('app_open'); }, []);

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
  slogan: {
    marginTop: 14,
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.lime,
  },
});
