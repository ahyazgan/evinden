import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { ChainTabBar } from '@/components/shared/ChainTabBar';
import { DesktopNav } from '@/components/shared/DesktopNav';
import { centeredScene, NARROW_PAGE_WIDTH, PAGE_WIDTH, useResponsive } from '@/lib/responsive';

/** Masaüstünde geniş açılan ekranlar; diğerleri okunaklı dar sütunda kalır */
const WIDE_ROUTES = ['index', 'explore', 'cart', 'seller/[id]', 'order/[id]', 'food-category'];

export default function CustomerLayout() {
  const { colors } = useTheme();
  const { isDesktop } = useResponsive();

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => (isDesktop ? <DesktopNav {...props} /> : <ChainTabBar {...props} floating />)}
      screenLayout={({ children, route }) => (isDesktop ? (
        <View style={[s.scene, centeredScene(WIDE_ROUTES.includes(route.name) ? PAGE_WIDTH : NARROW_PAGE_WIDTH)]}>{children}</View>
      ) : children)}
      screenOptions={() => ({
        headerShown: false,
        tabBarPosition: isDesktop ? 'top' : 'bottom',
        sceneStyle: { backgroundColor: colors.background },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana Sayfa',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Sepet',
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bag' : 'bag-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favoriler',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'heart' : 'heart-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} />
          ),
        }}
      />
      {/* Gizli sekmeler */}
      <Tabs.Screen name="orders" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="order/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="seller/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="addresses" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="campaign" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="notifications" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="messages" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="seller-apply" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="profile-edit" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="food-category" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="loyalty" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="privacy" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="terms" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="sales-terms" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="help" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  scene: { flex: 1 },
});
