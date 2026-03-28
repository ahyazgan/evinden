import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

type Period = 'daily' | 'weekly' | 'monthly';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DAILY_DATA = [
  { label: '09:00', revenue: 8500 },
  { label: '10:00', revenue: 12000 },
  { label: '11:00', revenue: 22000 },
  { label: '12:00', revenue: 35000 },
  { label: '13:00', revenue: 41000 },
  { label: '14:00', revenue: 18000 },
  { label: '15:00', revenue: 9500 },
  { label: '16:00', revenue: 15000 },
  { label: '17:00', revenue: 28000 },
  { label: '18:00', revenue: 32000 },
  { label: '19:00', revenue: 38000 },
  { label: '20:00', revenue: 21000 },
];

const WEEKLY_DATA = [
  { label: 'Pzt', revenue: 145000 },
  { label: 'Sal', revenue: 178000 },
  { label: 'Çar', revenue: 132000 },
  { label: 'Per', revenue: 198000 },
  { label: 'Cum', revenue: 245000 },
  { label: 'Cmt', revenue: 312000 },
  { label: 'Paz', revenue: 185000 },
];

const MONTHLY_DATA = [
  { label: 'Hft 1', revenue: 895000 },
  { label: 'Hft 2', revenue: 1120000 },
  { label: 'Hft 3', revenue: 980000 },
  { label: 'Hft 4', revenue: 1250000 },
];

const TOP_PRODUCTS = [
  { name: 'Kuru Fasulye + Pilav', count: 48, revenue: 384000 },
  { name: 'Mercimek Çorbası', count: 42, revenue: 189000 },
  { name: 'İzmir Köfte', count: 35, revenue: 332500 },
  { name: 'Karışık Salata', count: 28, revenue: 98000 },
  { name: 'Serpme Kahvaltı', count: 22, revenue: 550000 },
];

const STATS = {
  daily: { orders: 18, revenue: 280000, avgOrder: 15556, cancelRate: 5.6 },
  weekly: { orders: 124, revenue: 1395000, avgOrder: 11250, cancelRate: 4.2 },
  monthly: { orders: 485, revenue: 5245000, avgOrder: 10814, cancelRate: 3.8 },
};

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
  const [period, setPeriod] = useState<Period>('weekly');

  const chartData = period === 'daily' ? DAILY_DATA : period === 'weekly' ? WEEKLY_DATA : MONTHLY_DATA;
  const stats = STATS[period];

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
            {TOP_PRODUCTS.map((p, i) => (
              <View key={i} style={[st.topRow, i < TOP_PRODUCTS.length - 1 && st.topRowBorder]}>
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
