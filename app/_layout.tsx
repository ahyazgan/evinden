import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthGate } from '@/components/shared/AuthGate';
import { colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart-context';
import { AddressProvider } from '@/lib/address-context';
import { AuthProvider, useAuth } from '@/lib/auth-context';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function SplashOverlay({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => undefined);
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
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AddressProvider>
      <CartProvider>
      <SplashOverlay>
        {/* <AuthGate /> */}
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
