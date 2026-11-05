import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { ChainTabBar } from '@/components/shared/ChainTabBar';
import { DesktopNav } from '@/components/shared/DesktopNav';
import { NewOrderAlarm } from '@/components/shared/NewOrderAlarm';
import { centeredScene, PANEL_PAGE_WIDTH, useResponsive } from '@/lib/responsive';

export default function SellerLayout() {
  const { isDesktop } = useResponsive();
  const { colors } = useTheme();
  return (
    <NewOrderAlarm>
      <Tabs
        tabBar={(props) => (isDesktop ? <DesktopNav {...props} /> : <ChainTabBar {...props} />)}
        screenOptions={{
          headerShown: false,
          tabBarPosition: isDesktop ? 'top' : 'bottom',
          sceneStyle: [{ backgroundColor: colors.background }, isDesktop && centeredScene(PANEL_PAGE_WIDTH)] as any,
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Panel',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: 'Menüm',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'restaurant' : 'restaurant-outline'} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Siparişler',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Mağaza',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={color} />
            ),
          }}
        />
        {/* Hidden screens */}
        <Tabs.Screen name="analytics" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
        <Tabs.Screen name="reviews" options={{ href: null }} />
        <Tabs.Screen name="campaigns" options={{ href: null }} />
        <Tabs.Screen name="earnings" options={{ href: null }} />
        <Tabs.Screen name="messages" options={{ href: null }} />
        <Tabs.Screen name="receipt" options={{ href: null }} />
        <Tabs.Screen name="weekly-menu" options={{ href: null }} />
      </Tabs>
    </NewOrderAlarm>
  );
}
