import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrders, type OrderWithItems } from '@/lib/db';

type Period = 'daily' | 'weekly' | 'monthly';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function computeAnalytics(orders: OrderWithItems[], period: Period) {
  const now = new Date();
  let start: Date;
  if (period === 'daily') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'weekly') {
    start = new Date(now);
    start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const filtered = orders.filter(o => new Date(o.created_at) >= start);
  const cancelled = filtered.filter(o => o.status === 'cancelled').length;
  const totalRevenue = filtered.reduce((s, o) => s + o.total_cents, 0);
  const avgOrder = filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0;
  const cancelRate = filtered.length > 0 ? Math.round((cancelled / filtered.length) * 1000) / 10 : 0;

  let chartData: { label: string; revenue: number }[] = [];
  if (period === 'daily') {
    for (let h = 9; h <= 21; h++) {
      const label = `${h.toString().padStart(2, '0')}:00`;
      const rev = filtered.filter(o => new Date(o.created_at).getHours() === h).reduce((s, o) => s + o.total_cents, 0);
      chartData.push({ label, revenue: rev });
    }
  } else if (period === 'weekly') {
    const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    chartData = days.map((label, i) => {
      const rev = filtered.filter(o => { const d = new Date(o.created_at).getDay(); return (d === 0 ? 6 : d - 1) === i; }).reduce((s, o) => s + o.total_cents, 0);
      return { label, revenue: rev };
    });
  } else {
    for (let w = 0; w < 4; w++) {
      const wStart = new Date(start);
      wStart.setDate(start.getDate() + w * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 7);
      const rev = filtered.filter(o => { const d = new Date(o.created_at); return d >= wStart && d < wEnd; }).reduce((s, o) => s + o.total_cents, 0);
      chartData.push({ label: `Hft ${w + 1}`, revenue: rev });
    }
  }

  // Top products
  const itemMap = new Map<string, { count: number; revenue: number }>();
  filtered.forEach(o => o.order_items.forEach(i => {
    const prev = itemMap.get(i.title_snapshot) ?? { count: 0, revenue: 0 };
    itemMap.set(i.title_snapshot, { count: prev.count + i.quantity, revenue: prev.revenue + i.line_total_cents });
  }));
  const topProducts = Array.from(itemMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, data]) => ({ name, count: data.count, revenue: data.revenue }));

  return {
    stats: { orders: filtered.length, revenue: totalRevenue, avgOrder, cancelRate },
    chartData,
    topProducts,
  };
}

// ─── Chart Component ──────────────────────────────────────────────────────────

function BarChart({ data }: { data: { label: string; revenue: number }[] }) {
  const maxVal = Math.max(...data.map((d) => d.revenue));

  return (
    <View style={st.chartWrap}>
      <View style={st.chartBars}>
        {data.map((d, i) => {
          const h = maxVal > 0 ? (d.revenue / maxVal) * 120 : 0;
          return (
            <View key={i} style={st.barCol}>
              <View style={[st.bar, { height: h }]} />
              <Text style={st.barLabel}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [allOrders, setAllOrders] = useState<OrderWithItems[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (!seller) return;
        const orders = await fetchSellerOrders(seller.id);
        setAllOrders(orders);
      } catch {}
    })();
  }, [profile?.id]);

  const analytics = useMemo(() => computeAnalytics(allOrders, period), [allOrders, period]);
  const { chartData, stats, topProducts } = analytics;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.backIcon}>‹</Text>
        </Pressable>
        <Text style={st.headerTitle}>Gelir Analizi</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Period pills */}
        <View style={st.pillRow}>
          {([['daily', 'Bugün'], ['weekly', 'Bu Hafta'], ['monthly', 'Bu Ay']] as [Period, string][]).map(
            ([key, label]) => (
              <Pressable
                key={key}
                style={[st.pill, period === key && st.pillActive]}
                onPress={() => setPeriod(key)}
              >
                <Text style={[st.pillText, period === key && st.pillTextActive]}>{label}</Text>
              </Pressable>
            ),
          )}
        </View>

        {/* Revenue card */}
        <View style={st.revenueCard}>
          <Text style={st.revenueLabel}>Toplam Gelir</Text>
          <Text style={st.revenueAmount}>{priceTL(stats.revenue)}</Text>
          <View style={st.revenueRow}>
            <Text style={st.revenueTrend}>📈 +12.5%</Text>
            <Text style={st.revenueSub}>önceki döneme göre</Text>
          </View>
        </View>

        {/* Stats grid */}
        <View style={st.statsGrid}>
          <View style={st.statCard}>
            <Text style={st.statIcon}>📦</Text>
            <Text style={st.statValue}>{stats.orders}</Text>
            <Text style={st.statLabel}>Sipariş</Text>
          </View>
          <View style={st.statCard}>
            <Text style={st.statIcon}>💰</Text>
            <Text style={st.statValue}>{priceTL(stats.avgOrder)}</Text>
            <Text style={st.statLabel}>Ort. Sepet</Text>
          </View>
          <View style={st.statCard}>
            <Text style={st.statIcon}>❌</Text>
            <Text style={st.statValue}>%{stats.cancelRate}</Text>
            <Text style={st.statLabel}>İptal Oranı</Text>
          </View>
        </View>

        {/* Chart */}
        <View style={st.chartSection}>
          <Text style={st.sectionTitle}>Gelir Grafiği</Text>
          <View style={st.chartCard}>
            <BarChart data={chartData} />
          </View>
        </View>

        {/* Top products */}
        <View style={st.topSection}>
          <Text style={st.sectionTitle}>En Çok Satan Ürünler</Text>
          <View style={st.topCard}>
            {topProducts.map((p, i) => (
              <View key={i} style={[st.topRow, i < topProducts.length - 1 && st.topRowBorder]}>
                <View style={st.topRank}>
                  <Text style={st.topRankText}>{i + 1}</Text>
                </View>
                <View style={st.topInfo}>
                  <Text style={st.topName}>{p.name}</Text>
                  <Text style={st.topCount}>{p.count} adet satıldı</Text>
                </View>
                <Text style={st.topRevenue}>{priceTL(p.revenue)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  scroll: { padding: 16, paddingBottom: 20 },

  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  pill: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE8E2', alignItems: 'center' },
  pillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  pillText: { fontSize: 13, fontWeight: '700', color: '#8A7E72' },
  pillTextActive: { color: '#fff' },

  revenueCard: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  revenueLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  revenueAmount: { fontSize: 36, fontWeight: '900', color: '#fff', marginTop: 4 },
  revenueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  revenueTrend: { fontSize: 14, fontWeight: '700', color: '#fff', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  revenueSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  statIcon: { fontSize: 20 },
  statValue: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  statLabel: { fontSize: 11, color: '#8A7E72', fontWeight: '600' },

  chartSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1A1208', marginBottom: 12 },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  chartWrap: {},
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 140, gap: 4 },
  barCol: { alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  bar: { width: '70%', backgroundColor: colors.primary, borderRadius: 6, minHeight: 4 },
  barLabel: { fontSize: 9, color: '#8A7E72', marginTop: 6, fontWeight: '600' },

  topSection: { marginBottom: 16 },
  topCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  topRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' },
  topRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFF8E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRankText: { fontSize: 13, fontWeight: '800', color: '#F57F17' },
  topInfo: { flex: 1 },
  topName: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  topCount: { fontSize: 11, color: '#8A7E72', marginTop: 1 },
  topRevenue: { fontSize: 14, fontWeight: '800', color: colors.primary },
});
