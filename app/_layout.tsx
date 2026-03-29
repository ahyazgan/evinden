import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Onboarding, shouldShowOnboarding } from '@/components/shared/Onboarding';
import { colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart-context';
import { AddressProvider } from '@/lib/address-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => undefined);
      shouldShowOnboarding().then(setShowOnboarding);
    }
  }, [loading]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {children}
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.loading]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
      {showOnboarding === true && (
        <Onboarding onDone={() => setShowOnboarding(false)} />
      )}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
