import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';

interface Stats {
  todayOrders: number;
  todayRevenueCents: number;
  pendingOrders: number;
  totalOrders: number;
  rating: number | null;
  ratingCount: number;
}

export default function SellerDashboardScreen() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    if (!profile) return;

    // Satıcı kaydını bul
    const { data: seller } = await supabase
      .from('sellers')
      .select('id, rating_avg, rating_count')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (!seller) {
      setStats({
        todayOrders: 0,
        todayRevenueCents: 0,
        pendingOrders: 0,
        totalOrders: 0,
        rating: null,
        ratingCount: 0,
      });
      setLoading(false);
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [{ data: todayData }, { data: pendingData }, { data: totalData }] =
      await Promise.all([
        supabase
          .from('orders')
          .select('total_cents')
          .eq('seller_id', seller.id)
          .gte('created_at', todayStart.toISOString())
          .neq('status', 'cancelled'),
        supabase
          .from('orders')
          .select('id', { count: 'exact' })
          .eq('seller_id', seller.id)
          .eq('status', 'pending'),
        supabase
          .from('orders')
          .select('id', { count: 'exact' })
          .eq('seller_id', seller.id)
          .neq('status', 'cancelled'),
      ]);

    const todayRevenue = (todayData ?? []).reduce(
      (sum, o) => sum + (o.total_cents ?? 0),
      0,
    );

    setStats({
      todayOrders: todayData?.length ?? 0,
      todayRevenueCents: todayRevenue,
      pendingOrders: pendingData?.length ?? 0,
      totalOrders: totalData?.length ?? 0,
      rating: seller.rating_avg,
      ratingCount: seller.rating_count,
    });
    setLoading(false);
    setRefreshing(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadStats();
  }

  function formatTL(cents: number) {
    return (cents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={styles.greeting}>Merhaba, {profile?.name ?? 'Satıcı'} 👋</Text>
      <Text style={styles.sub}>Bugünkü durumuna bir göz at</Text>

      {/* Bugün */}
      <Text style={styles.sectionLabel}>Bugün</Text>
      <View style={styles.row}>
        <StatCard
          label="Sipariş"
          value={String(stats?.todayOrders ?? 0)}
          accent={colors.primary}
        />
        <StatCard
          label="Kazanç"
          value={formatTL(stats?.todayRevenueCents ?? 0)}
          accent={colors.success}
        />
      </View>

      {/* Genel */}
      <Text style={styles.sectionLabel}>Genel</Text>
      <View style={styles.row}>
        <StatCard
          label="Bekleyen"
          value={String(stats?.pendingOrders ?? 0)}
          accent={stats?.pendingOrders ? colors.amber : '#ccc'}
        />
        <StatCard
          label="Toplam Sipariş"
          value={String(stats?.totalOrders ?? 0)}
          accent={colors.secondary}
        />
      </View>

      {/* Puan */}
      {stats?.rating != null ? (
        <>
          <Text style={styles.sectionLabel}>Değerlendirme</Text>
          <View style={styles.ratingCard}>
            <Text style={styles.ratingValue}>
              ★ {Number(stats.rating).toFixed(1)}
            </Text>
            <Text style={styles.ratingMeta}>
              {stats.ratingCount} değerlendirme
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={[styles.statCard, { borderTopColor: accent }]}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.secondary,
    marginTop: 8,
  },
  sub: { fontSize: 13, color: '#999', marginTop: 2, marginBottom: 20 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  row: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 13, color: '#999' },
  ratingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  ratingValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.amber,
  },
  ratingMeta: { fontSize: 13, color: '#999' },
});
