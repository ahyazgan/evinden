import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { ChainTabBar } from '@/components/shared/ChainTabBar';
import { DesktopNav } from '@/components/shared/DesktopNav';
import { centeredScene, PANEL_PAGE_WIDTH, useResponsive } from '@/lib/responsive';

export default function AdminLayout() {
  const { isDesktop } = useResponsive();
  const { colors } = useTheme();
  const { loading, profile, session } = useAuth();
  // Veriyi veritabanı korur; bu, panel ekranlarının yönetici olmayana görünmemesi içindir.
  // Oturum varken profil henüz okunmamış olabilir: gerçek yönetici girişe atılmasın.
  const notAdmin = profile ? profile.role !== 'admin' : !session;
  if (!loading && notAdmin) return <Redirect href={'/(auth)/login' as any} />;
  return (
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
        name="sellers"
        options={{
          title: 'Satıcılar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'storefront' : 'storefront-outline'} size={22} color={color} />
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
        name="settings"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="users" options={{ href: null }} />
      <Tabs.Screen name="coupons" options={{ href: null }} />
      <Tabs.Screen name="payouts" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen name="support" options={{ href: null }} />
      <Tabs.Screen name="funnel" options={{ href: null }} />
      <Tabs.Screen name="live" options={{ href: null }} />
      <Tabs.Screen name="fraud" options={{ href: null }} />
      <Tabs.Screen name="decision-reports" options={{ href: null }} />
      <Tabs.Screen name="finance" options={{ href: null }} />
      <Tabs.Screen name="sla" options={{ href: null }} />
      <Tabs.Screen name="refunds" options={{ href: null }} />
      <Tabs.Screen name="reconciliation" options={{ href: null }} />
      <Tabs.Screen name="invoices" options={{ href: null }} />
      <Tabs.Screen name="invoice/[id]" options={{ href: null }} />
    </Tabs>
  );
}
