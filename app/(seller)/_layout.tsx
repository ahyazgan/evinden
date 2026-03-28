import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { colors } from '@/constants/theme';

export default function SellerLayout() {
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
        name="dashboard"
        options={{
          title: 'Panel',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📊</Text>,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menüm',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🍽️</Text>,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Siparişler',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📦</Text>,
        }}
      />
    </Tabs>
  );
}
