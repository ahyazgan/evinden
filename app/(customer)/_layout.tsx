import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { useCart } from '@/lib/cart-context';
import { fonts } from '@/lib/fonts';
import { DesktopNav } from '@/components/shared/DesktopNav';
import { centeredScene, NARROW_PAGE_WIDTH, PAGE_WIDTH, useResponsive } from '@/lib/responsive';

/** Masaüstünde geniş açılan ekranlar; diğerleri okunaklı dar sütunda kalır */
const WIDE_ROUTES = ['index', 'explore', 'cart', 'seller/[id]', 'order/[id]', 'food-category'];

export default function CustomerLayout() {
  const { totalItems } = useCart();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10);
  const { isDesktop } = useResponsive();

  return (
    <Tabs
      backBehavior="history"
      tabBar={isDesktop ? (props) => <DesktopNav {...props} /> : undefined}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarPosition: isDesktop ? 'top' : 'bottom',
        sceneStyle: isDesktop ? centeredScene(WIDE_ROUTES.includes(route.name) ? PAGE_WIDTH : NARROW_PAGE_WIDTH) : undefined,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: 60 + bottom,
          paddingBottom: bottom,
          paddingTop: 8,
          shadowColor: '#151A16',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 20,
          elevation: 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.semibold, marginTop: 2 },
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
            <Ionicons name={focused ? 'search' : 'search-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Sepet',
          tabBarAccessibilityLabel: totalItems > 0 ? `Sepet, ${totalItems} ürün` : 'Sepet',
          tabBarIcon: ({ color }) => isDesktop ? (
            <View>
              <Ionicons name="bag-outline" size={20} color={color} />
              {totalItems > 0 ? (
                <View style={[s.cartBadge, s.cartBadgeDesktop, { borderColor: colors.surface }]}>
                  <Text style={s.cartBadgeText}>{totalItems > 99 ? '99+' : totalItems}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[s.cartBtn, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
              <Ionicons name="bag-outline" size={23} color="#fff" />
              {totalItems > 0 ? (
                <View style={[s.cartBadge, { borderColor: colors.primary }]}>
                  <Text style={s.cartBadgeText}>{totalItems > 99 ? '99+' : totalItems}</Text>
                </View>
              ) : null}
            </View>
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
    </Tabs>
  );
}

const s = StyleSheet.create({
  cartBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    backgroundColor: '#F7C948',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: '#17402F' },
  cartBadgeDesktop: { top: -8, right: -10, minWidth: 18, height: 18, borderRadius: 9 },
});
