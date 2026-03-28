import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';

export default function CustomerLayout() {
  const { totalItems } = useCart();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FAF7F2',
          borderTopColor: '#EDE8E2',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#BBBBBB',
        tabBarLabelStyle: { fontSize: 9, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🔍</Text>,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Siparişler',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📦</Text>,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favoriler',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>❤️</Text>,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Sepet',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🛒</Text>,
          tabBarBadge: totalItems > 0 ? totalItems : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: '#fff', fontSize: 9 },
        }}
      />
      {/* Gizli sekmeler */}
      <Tabs.Screen name="seller" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="profile" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
