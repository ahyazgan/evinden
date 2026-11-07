import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrderStats, type SellerOrderStatRow } from '@/lib/db';
import { orderSalesCents } from '@/lib/earnings';
import { fonts } from '@/lib/fonts';
import { analyticsSince } from '@/lib/seller-orders';
import { useTheme } from '@/lib/theme-context';

type Period = 'daily' | 'weekly' | 'monthly';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function computeAnalytics(orders: SellerOrderStatRow[], period: Period) {
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

  const inPeriod = orders.filter(o => new Date(o.created_at) >= start);
  const cancelled = inPeriod.filter(o => o.status === 'cancelled').length;
  // İptal edilen sipariş gelire, grafiğe ve en çok satanlara girmez. Bahşiş gelir sayılmaz.
  const filtered = inPeriod.filter(o => o.status !== 'cancelled');
  const totalRevenue = filtered.reduce((s, o) => s + orderSalesCents(o), 0);
  const avgOrder = filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0;
  const cancelRate = inPeriod.length > 0 ? Math.round((cancelled / inPeriod.length) * 1000) / 10 : 0;

  let chartData: { label: string; revenue: number }[] = [];
  if (period === 'daily') {
    for (let h = 9; h <= 21; h++) {
      const label = `${h.toString().padStart(2, '0')}:00`;
      const rev = filtered.filter(o => new Date(o.created_at).getHours() === h).reduce((s, o) => s + orderSalesCents(o), 0);
      chartData.push({ label, revenue: rev });
    }
  } else if (period === 'weekly') {
    const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    chartData = days.map((label, i) => {
      const rev = filtered.filter(o => { const d = new Date(o.created_at).getDay(); return (d === 0 ? 6 : d - 1) === i; }).reduce((s, o) => s + orderSalesCents(o), 0);
      return { label, revenue: rev };
    });
  } else {
    for (let w = 0; w < 4; w++) {
      const wStart = new Date(start);
      wStart.setDate(start.getDate() + w * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 7);
      const rev = filtered.filter(o => { const d = new Date(o.created_at); return d >= wStart && d < wEnd; }).reduce((s, o) => s + orderSalesCents(o), 0);
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
    stats: { orders: inPeriod.length, revenue: totalRevenue, avgOrder, cancelRate },
    chartData,
    topProducts,
  };
}

// ─── Chart Component ──────────────────────────────────────────────────────────

function BarChart({ data }: { data: { label: string; revenue: number }[] }) {
  const { colors: t } = useTheme();
  const maxVal = Math.max(...data.map((d) => d.revenue));
  // Saatlik grafikte sütun dar: "09:00" yerine "09" yazılır.
  const compact = data.length > 7;

  return (
    <View style={st.chartBars}>
      {data.map((d, i) => {
        const h = maxVal > 0 ? (d.revenue / maxVal) * 120 : 0;
        return (
          <View
            key={i}
            style={st.barCol}
            accessible
            accessibilityLabel={`${d.label}: ${priceTL(d.revenue)}`}
          >
            <View style={[st.bar, { height: h, backgroundColor: t.brand }]} />
            <Text style={[st.barLabel, { color: t.textSecondary }]} numberOfLines={1}>{compact ? d.label.slice(0, 2) : d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function StatTile({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string }) {
  const { colors: t } = useTheme();
  return (
    <View style={[st.statCard, { backgroundColor: t.surface }]}>
      <Ionicons name={icon} size={20} color={t.text} />
      <Text style={[st.statValue, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      <Text style={[st.statLabel, { color: t.textSecondary }]}>{label}</Text>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const { colors: t } = useTheme();
  const { profile } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [allOrders, setAllOrders] = useState<SellerOrderStatRow[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (!seller) return;
        const orders = await fetchSellerOrderStats(seller.id, analyticsSince(new Date()));
        setAllOrders(orders);
      } catch {}
    })();
  }, [profile?.id]);

  const analytics = useMemo(() => computeAnalytics(allOrders, period), [allOrders, period]);
  const { chartData, stats, topProducts } = analytics;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar title="Gelir analizi" back />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Period pills */}
        <View style={st.pillRow}>
          {([['daily', 'Bugün'], ['weekly', 'Bu hafta'], ['monthly', 'Bu ay']] as [Period, string][]).map(
            ([key, label]) => {
              const on = period === key;
              return (
                <Pressable
                  key={key}
                  style={[st.chip, { backgroundColor: on ? t.brand : t.surface }]}
                  hitSlop={2}
                  onPress={() => setPeriod(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[st.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
                </Pressable>
              );
            },
          )}
        </View>

        {/* Revenue card */}
        <View style={[st.revenueCard, { backgroundColor: t.brand }]}>
          <Text style={[st.revenueLabel, { color: t.onBrandSoft }]}>Toplam gelir</Text>
          <Text style={[st.revenueAmount, { color: t.onBrand }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{priceTL(stats.revenue)}</Text>
        </View>

        {/* Stats grid */}
        <View style={st.statsGrid}>
          <StatTile icon="receipt-outline" value={stats.orders} label="Sipariş" />
          <StatTile icon="wallet-outline" value={priceTL(stats.avgOrder)} label="Ort. sepet" />
          <StatTile icon="close-circle-outline" value={`%${stats.cancelRate}`} label="İptal oranı" />
        </View>

        {/* Chart */}
        <Text style={[st.sectionTitle, { color: t.heading }]}>Gelir grafiği</Text>
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <BarChart data={chartData} />
        </View>

        {/* Top products */}
        <Text style={[st.sectionTitle, { color: t.heading }]}>En çok satan ürünler</Text>
        <View style={[st.card, { backgroundColor: t.surface }]}>
          {topProducts.length === 0 ? (
            <Text style={[st.emptyLine, { color: t.textSecondary }]}>Bu dönemde satış yok.</Text>
          ) : topProducts.map((p, i) => (
            <View key={i} style={[st.topRow, i < topProducts.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}>
              <View style={[st.topRank, { backgroundColor: t.background }]}>
                <Text style={[st.topRankText, { color: t.text }]}>{i + 1}</Text>
              </View>
              <View style={st.topInfo}>
                <Text style={[st.topName, { color: t.text }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[st.topCount, { color: t.textSecondary }]}>{p.count} adet satıldı</Text>
              </View>
              <Text style={[st.topRevenue, { color: t.text }]}>{priceTL(p.revenue)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },

  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { flex: 1, height: 40, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  revenueCard: { borderRadius: 16, padding: 14, marginBottom: 10 },
  revenueLabel: { fontSize: 13, fontFamily: fonts.semibold },
  revenueAmount: { fontSize: 36, lineHeight: 44, fontFamily: fonts.display, letterSpacing: -0.6, marginTop: 2 },

  statsGrid: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, minWidth: 0, borderRadius: 16, padding: 12, gap: 4 },
  statValue: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display },
  statLabel: { fontSize: 12, fontFamily: fonts.regular },

  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 18, marginBottom: 8 },
  card: { borderRadius: 16, padding: 14 },
  emptyLine: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },

  chartBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 146, gap: 4 },
  barCol: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', borderRadius: 6, minHeight: 4 },
  barLabel: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold, marginTop: 6 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  topRank: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  topRankText: { fontSize: 13, fontFamily: fonts.extrabold },
  topInfo: { flex: 1, minWidth: 0 },
  topName: { fontSize: 13, fontFamily: fonts.bold },
  topCount: { fontSize: 12, fontFamily: fonts.regular, marginTop: 1 },
  topRevenue: { fontSize: 14, fontFamily: fonts.extrabold },
});
