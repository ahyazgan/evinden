import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Onboarding, shouldShowOnboarding } from '@/components/shared/Onboarding';
import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { registerForPushNotifications } from '@/lib/notifications';
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
  const { loading } = useAuth();
  const { colors: t } = useTheme();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showLocation, setShowLocation] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => undefined);
      shouldShowOnboarding().then(setShowOnboarding);
      getSavedLocation().then(loc => setShowLocation(!loc));
      registerForPushNotifications().catch(() => undefined);
    }
  }, [loading]);

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
