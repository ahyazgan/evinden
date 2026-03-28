import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';

export default function CustomerLayout() {
  const { totalItems } = useCart();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#E8E4DD',
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#AAAAAA',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>🏠</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Sepet',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>🛒</Text>
          ),
          tabBarBadge: totalItems > 0 ? totalItems : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: '#fff', fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Siparişlerim',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>📦</Text>
          ),
        }}
      />
      {/* Satıcı detay sayfası tab bar'da gösterilmez */}
      <Tabs.Screen
        name="seller"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
