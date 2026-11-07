import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { mustLeaveSellerArea, sellerLanding } from '@/lib/role-landing';
import { track } from '@/lib/analytics';
import { initErrorTracking, setUser } from '@/lib/error-tracking';
import { hideBootSplash } from '@/lib/boot-splash';
import { routeSeo } from '@/lib/seo';
import { Seo } from '@/components/shared/Seo';
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

/** Webde her sayfanın başlığı ve dizine girip girmeyeceği. Restoran sayfası bunu kendisi yapar. */
function RouteHead() {
  const seo = routeSeo(usePathname());
  if (seo.own) return null;
  return <Seo title={seo.title} description={seo.description} path={seo.canonical} noindex={seo.noindex} />;
}

// Telefonda logo animasyonu bir tur döner. Webde sayfa zaten HTML'deki açılış görüntüsüyle hemen
// çizilir (public/index.html); ayrıca beklemek içeriği geciktirir, Google da bunu yavaşlık sayar.
const INTRO_MS = Platform.OS === 'web' ? 0 : 1600;

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading, profile, session, signOut } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const segments = useSegments();
  // Animasyon en az bir tur görünür, hızlı açılışta ekran yanıp sönmez.
  const [introDone, setIntroDone] = useState(false);
  const hasRedirected = useRef(false);
  const sellerSettledFor = useRef<string | null>(null);
  const roleRef = useRef<string | undefined>(undefined);
  roleRef.current = profile?.role;

  useEffect(() => {
    // Yerel açılış görseli hemen kalkar, beklemeyi logo animasyonu karşılar.
    SplashScreen.hideAsync().catch(() => undefined);
    // Webde HTML'deki açılış görüntüsü artık uygulamanın kendi açılış ekranına devreder.
    hideBootSplash();
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

  // Restoran paneli yalnızca onaylı satıcınındır; adresle gelen başkası müşteri tarafına döner.
  useEffect(() => {
    if (loading) return;
    if (mustLeaveSellerArea(profile, segments)) router.replace('/(customer)' as any);
  }, [loading, profile, segments]);

  // Role-based routing
  useEffect(() => {
    if (loading || !profile) return;
    setUser({ id: profile.id });
    const inAdmin = segments[0] === 'yonetim';
    const inAuth = segments[0] === '(auth)';

    // Şifre yenilerken yönlendirme yapılmaz, yoksa yönetici formu göremeden panele düşer.
    if ((segments as string[])[1] === 'reset-password') return;

    const landing = sellerLanding(profile, segments, sellerSettledFor.current === profile.id);
    if (landing.settled) sellerSettledFor.current = profile.id;
    if (landing.route) router.replace(landing.route as any);

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
      checkForUpdate().catch(() => undefined);
      registerForPushNotifications().catch(() => undefined);
    }
  }, [loading]);

  // Her girişte yeniden kaydedilir: çıkış yapınca jeton silinir, ilk girişte de henüz yoktur.
  useEffect(() => {
    const userId = session?.userId;
    if (loading || !userId) return;
    registerExpoPush().then(async (token) => {
      if (token) {
        const { savePushToken } = await import('@/lib/db');
        savePushToken(userId, token).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, [loading, session?.userId]);

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
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();

  initErrorTracking();

  useEffect(() => { track('app_open'); }, []);

  // Yazı tipi inemezse uygulama sistem yazı tipiyle açılır, boş ekranda kalmaz.
  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
    <AuthProvider>
      <FavoritesProvider>
      <AddressProvider>
      <CartProvider>
      <SplashOverlay>
        <RouteHead />
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
