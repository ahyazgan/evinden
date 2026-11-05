import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Logo } from '@/components/shared/Logo';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { useAuth } from '@/lib/auth-context';
import { fetchPlatformTotals, type PlatformTotals } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Stats = {
  totalUsers: number;
  totalSellers: number;
  pendingSellers: number;
  totalOrders: number;
  todayOrders: number;
  totals: PlatformTotals | null;
  activeCoupons: number;
  openReports: number;
  openFlags: number;
};

export default function AdminDashboardScreen() {
  const { colors: t } = useTheme();
  const s = useMemo(() => createStyles(t), [t]);
  const { signOut } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const [
        { count: totalUsers },
        { count: totalSellers },
        { count: pendingSellers },
        { count: totalOrders },
        { count: todayOrders },
        totals,
        { count: activeCoupons },
        { count: openReports },
        { count: openFlags },
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('sellers').select('*', { count: 'exact', head: true }),
        supabase.from('sellers').select('*', { count: 'exact', head: true }).eq('is_active', false).not('user_id', 'is', null),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().slice(0, 10)),
        // İptal edilen ve iade edilen siparişler sunucuda hariç tutulur.
        fetchPlatformTotals().catch(() => null),
        supabase.from('coupons').select('*', { count: 'exact', head: true }).eq('is_active', true).is('owner_id', null).is('seller_id', null),
        supabase.from('message_reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('fraud_flags').select('*', { count: 'exact', head: true }).is('reviewed_at', null),
      ]);

      setStats({
        totalUsers: totalUsers ?? 0,
        totalSellers: totalSellers ?? 0,
        pendingSellers: pendingSellers ?? 0,
        totalOrders: totalOrders ?? 0,
        todayOrders: todayOrders ?? 0,
        totals,
        activeCoupons: activeCoupons ?? 0,
        openReports: openReports ?? 0,
        openFlags: openFlags ?? 0,
      });
    } catch (e) {
      console.error('[admin] Stats error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, [loadStats]);

  // Kuruş yoksa küsurat gösterilmez, varsa tutar yuvarlanmaz.
  const priceTL = (cents: number) => `₺${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;

  const { isDesktop } = useResponsive();
  const header = (
    <TopBar
      leading={isDesktop ? undefined : <Logo size={26} tone="onBrand" inline />}
      title={isDesktop ? 'Yönetici paneli' : undefined}
      subtitle={isDesktop ? undefined : 'Yönetici paneli'}
      right={
        <TopIconButton
          icon="log-out-outline"
          label="Çıkış yap"
          onPress={() => { signOut(); router.replace('/(auth)/login' as any); }}
        />
      }
    />
  );

  if (loading) {
    return (
      <View style={s.safe}>
        {header}
        <View style={s.loading}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={s.loadingText}>Yükleniyor...</Text>
        </View>
      </View>
    );
  }

  const pendingSellers = stats?.pendingSellers ?? 0;
  const openFlags = stats?.openFlags ?? 0;

  const cards: { label: string; value: string; onPress?: () => void }[] = [
    { label: 'Kullanıcı', value: String(stats?.totalUsers ?? 0), onPress: () => router.push('/yonetim/users' as any) },
    { label: 'Aktif satıcı', value: String(stats?.totalSellers ?? 0), onPress: () => router.push('/yonetim/sellers' as any) },
    { label: 'Onay bekleyen', value: String(pendingSellers), onPress: () => router.push('/yonetim/sellers' as any) },
    { label: 'Toplam sipariş', value: String(stats?.totalOrders ?? 0), onPress: () => router.push('/yonetim/orders' as any) },
    { label: 'Bugün sipariş', value: String(stats?.todayOrders ?? 0) },
    { label: 'Teslim edilen satış', value: priceTL(stats?.totals?.sales_cents ?? 0) },
    { label: 'Toplam komisyon', value: priceTL(stats?.totals?.commission_cents ?? 0) },
    { label: 'Satıcılara ödenecek', value: priceTL(stats?.totals?.payable_cents ?? 0), onPress: () => router.push('/yonetim/payouts' as any) },
    { label: 'Satıcılardan alınacak', value: priceTL(stats?.totals?.receivable_cents ?? 0), onPress: () => router.push('/yonetim/payouts' as any) },
    { label: 'Bildirilen mesaj', value: String(stats?.openReports ?? 0), onPress: () => router.push('/yonetim/reports' as any) },
    { label: 'Aktif kupon', value: String(stats?.activeCoupons ?? 0), onPress: () => router.push('/yonetim/coupons' as any) },
  ];

  const todos: { label: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
    { label: 'Canlı siparişler', icon: 'pulse-outline', route: '/yonetim/live' },
    { label: openFlags > 0 ? `${openFlags} işaretli sipariş` : 'İşaretli siparişler', icon: 'flag-outline', route: '/yonetim/fraud' },
    { label: 'Destek talepleri', icon: 'help-circle-outline', route: '/yonetim/support' },
    { label: pendingSellers > 0 ? `${pendingSellers} satıcı başvurusu` : 'Satıcı başvurularını incele', icon: 'storefront-outline', route: '/yonetim/sellers' },
    { label: 'Siparişleri ve iadeleri izle', icon: 'receipt-outline', route: '/yonetim/orders' },
    { label: 'Kullanıcıları yönet', icon: 'people-outline', route: '/yonetim/users' },
    { label: 'Kupon oluştur', icon: 'pricetag-outline', route: '/yonetim/coupons' },
    { label: 'Kullanım hunisi', icon: 'funnel-outline', route: '/yonetim/funnel' },
    { label: 'Toplu duyuru gönder', icon: 'notifications-outline', route: '/yonetim/settings' },
  ];

  return (
    <View style={s.safe}>
      {header}

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <View style={s.grid}>
          {cards.map(card => (
            <Pressable
              key={card.label}
              style={s.card}
              onPress={card.onPress}
              disabled={!card.onPress}
              accessibilityRole={card.onPress ? 'button' : undefined}
            >
              <Text style={s.cardValue} numberOfLines={1} adjustsFontSizeToFit>{card.value}</Text>
              <Text style={s.cardLabel}>{card.label}</Text>
            </Pressable>
          ))}
          {/* Tek kalan kart satırın tamamına yayılmasın */}
          {cards.length % 2 === 1 ? <View style={s.cardFiller} /> : null}
        </View>

        <Text style={s.sectionTitle} accessibilityRole="header">Yapılacaklar</Text>
        <View style={s.list}>
          {todos.map((todo, i) => (
            <Pressable
              key={todo.route + todo.label}
              style={[s.row, i < todos.length - 1 && s.rowBorder]}
              onPress={() => router.push(todo.route as any)}
              accessibilityRole="button"
            >
              <Ionicons name={todo.icon} size={20} color={t.text} />
              <Text style={s.rowText}>{todo.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
            </Pressable>
          ))}
        </View>
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: t.textSecondary, fontFamily: fonts.regular, fontSize: 13 },
  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexBasis: '48%', flexGrow: 1, minWidth: 0, backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  cardFiller: { flexBasis: '48%', flexGrow: 1 },
  cardValue: { fontSize: 24, fontFamily: fonts.display, color: t.text },
  cardLabel: { fontSize: 12, color: t.textSecondary, fontFamily: fonts.regular, marginTop: 2 },
  sectionTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.3, color: t.heading, paddingTop: 16, paddingBottom: 8 },
  list: { backgroundColor: t.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: t.divider },
  rowText: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: t.text },
});
