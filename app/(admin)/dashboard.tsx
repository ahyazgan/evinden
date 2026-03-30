import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type Stats = {
  totalUsers: number;
  totalSellers: number;
  pendingSellers: number;
  totalOrders: number;
  todayOrders: number;
  totalRevenue: number;
  activeCoupons: number;
};

export default function AdminDashboardScreen() {
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
        { data: revenueData },
        { count: activeCoupons },
      ] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('sellers').select('*', { count: 'exact', head: true }),
        supabase.from('sellers').select('*', { count: 'exact', head: true }).eq('is_active', false),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().slice(0, 10)),
        supabase.from('orders').select('total_cents'),
        supabase.from('coupons').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ]);

      const totalRevenue = (revenueData ?? []).reduce((sum: number, o: any) => sum + (o.total_cents ?? 0), 0);

      setStats({
        totalUsers: totalUsers ?? 0,
        totalSellers: totalSellers ?? 0,
        pendingSellers: pendingSellers ?? 0,
        totalOrders: totalOrders ?? 0,
        todayOrders: todayOrders ?? 0,
        totalRevenue,
        activeCoupons: activeCoupons ?? 0,
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

  const priceTL = (cents: number) => `₺${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const cards = [
    { label: 'Toplam Kullanıcı', value: String(stats?.totalUsers ?? 0), icon: 'people', color: '#1565C0', bg: '#E3F2FD', onPress: () => router.push('/(admin)/users' as any) },
    { label: 'Aktif Satıcı', value: String(stats?.totalSellers ?? 0), icon: 'storefront', color: '#2E7D32', bg: '#E8F5E9', onPress: () => router.push('/(admin)/sellers' as any) },
    { label: 'Onay Bekleyen', value: String(stats?.pendingSellers ?? 0), icon: 'hourglass', color: '#E65100', bg: '#FFF3E0', onPress: () => router.push('/(admin)/sellers' as any) },
    { label: 'Toplam Sipariş', value: String(stats?.totalOrders ?? 0), icon: 'receipt', color: '#6A1B9A', bg: '#F3E5F5', onPress: () => router.push('/(admin)/orders' as any) },
    { label: 'Bugün Sipariş', value: String(stats?.todayOrders ?? 0), icon: 'today', color: '#00695C', bg: '#E0F2F1' },
    { label: 'Toplam Gelir', value: priceTL(stats?.totalRevenue ?? 0), icon: 'cash', color: '#BF360C', bg: '#FBE9E7' },
    { label: 'Aktif Kupon', value: String(stats?.activeCoupons ?? 0), icon: 'pricetag', color: '#AD1457', bg: '#FCE4EC', onPress: () => router.push('/(admin)/coupons' as any) },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Admin Panel</Text>
          <Text style={s.headerSub}>evinden yönetim</Text>
        </View>
        <Pressable style={s.logoutBtn} onPress={() => { signOut(); router.replace('/(auth)/login' as any); }}>
          <Ionicons name="log-out-outline" size={20} color="#E8593C" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={s.grid}>
          {cards.map((card, i) => (
            <Pressable key={i} style={s.card} onPress={card.onPress}>
              <View style={[s.cardIcon, { backgroundColor: card.bg }]}>
                <Ionicons name={card.icon as any} size={24} color={card.color} />
              </View>
              <Text style={s.cardValue}>{card.value}</Text>
              <Text style={s.cardLabel}>{card.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.quickActions}>
          <Text style={s.sectionTitle}>Hızlı İşlemler</Text>
          {[
            { label: 'Satıcı Başvurularını İncele', icon: 'checkmark-circle-outline', route: '/(admin)/sellers' },
            { label: 'Kullanıcıları Yönet', icon: 'people-outline', route: '/(admin)/users' },
            { label: 'Kupon Oluştur', icon: 'pricetag-outline', route: '/(admin)/coupons' },
            { label: 'Siparişleri İzle', icon: 'eye-outline', route: '/(admin)/orders' },
          ].map((action, i) => (
            <Pressable key={i} style={s.actionRow} onPress={() => router.push(action.route as any)}>
              <Ionicons name={action.icon as any} size={20} color="#6B5E50" />
              <Text style={s.actionText}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#C4B8AA" />
            </Pressable>
          ))}
        </View>
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#A89A8A', fontSize: 13 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF0ED', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '48%' as any, backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#EDE8E2', gap: 8,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardValue: { fontSize: 22, fontWeight: '800', color: '#1A1208' },
  cardLabel: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },
  quickActions: { marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208', marginBottom: 12 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#EDE8E2', marginBottom: 8,
  },
  actionText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1A1208' },
});
