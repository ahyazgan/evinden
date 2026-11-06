import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useResponsive } from '@/lib/responsive';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, ToolbarSearch } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { fetchDecisionComparison, fetchDecisionReport, type DecisionComparison, type DecisionReport } from '@/lib/enterprise';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const PERIODS = [7, 30, 90] as const;
type Group = 'all' | 'new' | 'repeat' | 'at_risk';

export default function DecisionReportsScreen() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const st = useMemo(() => createStyles(t), [t]);
  const [days, setDays] = useState<number>(30);
  const [group, setGroup] = useState<Group>('all');
  const [sellerSearch, setSellerSearch] = useState('');
  const [report, setReport] = useState<DecisionReport | null>(null);
  const [comparison, setComparison] = useState<DecisionComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [current, previous] = await Promise.all([fetchDecisionReport(days), fetchDecisionComparison(days)]);
      setReport(current); setComparison(previous);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const customers = report?.customers.filter(row => group === 'all' || row.segment === group) ?? [];
  const sellers = report?.sellers.filter(row => row.display_name.toLocaleLowerCase('tr-TR').includes(sellerSearch.toLocaleLowerCase('tr-TR'))) ?? [];
  const exportCsv = async () => {
    if (!report) return;
    const lines = [['Satıcı','Sipariş','Teslim','Satış (TL)','İptal %','İade %','Gecikme dk'], ...report.sellers.map(row => [row.display_name, row.orders, row.delivered, (row.revenue_cents / 100).toFixed(2), row.cancel_rate, row.refund_rate, row.avg_delivery_minutes ?? ''])];
    const csv = lines.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n');
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `afiyetli-satici-${days}-gun.csv`; link.click(); URL.revokeObjectURL(url);
    } else await Share.share({ title: 'Satıcı performans raporu', message: csv });
  };
  return <View style={st.safe}>
    <TopBar title="Karar raporları" subtitle={`Son ${days} gün · önceki dönemle karşılaştırmalı`} back right={<Button label="Dışa aktar" size="sm" variant="outline" onPress={exportCsv} />} />
    <SegmentedControl options={PERIODS.map(value => ({ value, label: `${value} gün` }))} value={days} onChange={setDays} />
    {loading ? <View style={st.center}><LogoLoader /></View> : failed ? <View style={st.center}><Text style={[st.muted, { color: t.textSecondary }]}>Rapor alınamadı.</Text><Button label="Tekrar dene" onPress={load} /></View> : report ? <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
      <View style={st.cards}>
        <MetricCard label="Satış" value={moneyTL(report.summary.revenue_cents)} icon="cash-outline" />
        <MetricCard label="Sipariş" value={String(report.summary.orders)} icon="receipt-outline" />
        <MetricCard label="Başarı" value={`%${report.summary.success_rate ?? 0}`} icon="checkmark-circle-outline" />
        <MetricCard label="İade" value={String(report.summary.refunds)} icon="arrow-undo-outline" />
      </View>
      {comparison ? <Comparison comparison={comparison} /> : null}
      <SectionHeader title="Satış trendi" subtitle="Günlük teslim satışları" />
      <View style={[st.chartCard, { backgroundColor: t.surface }]}><SalesChart data={report.daily.map(row => ({ label: row.day, value: row.revenue_cents }))} /></View>
      <SectionHeader title="Satıcı performansı" subtitle="Sipariş, iptal, iade ve gecikme" />
      <ToolbarSearch value={sellerSearch} onChangeText={setSellerSearch} placeholder="Satıcı ara" />
      <View style={[st.table, { backgroundColor: t.surface }]}>
        {isDesktop ? <View style={[st.tableHeader, { borderColor: t.divider }]}><Text style={[st.headerCell, { color: t.textSecondary }]}>Satıcı</Text><Text style={[st.headerCell, { color: t.textSecondary }]}>Sipariş / teslim</Text><Text style={[st.headerCell, { color: t.textSecondary }]}>İptal / iade</Text><Text style={[st.headerCell, st.headerAmount, { color: t.textSecondary }]}>Satış</Text></View> : null}
        {sellers.length === 0 ? <EmptyState title="Satıcı bulunamadı" description="Arama metnini değiştir." icon="search-outline" /> : sellers.map(row => <View key={row.id} style={[st.tableRow, { borderColor: t.divider }]}><View style={st.grow}><Text style={[st.rowTitle, { color: t.text }]}>{row.display_name}</Text><Text style={[st.rowSub, { color: t.textSecondary }]}>{row.orders} sipariş · {row.delivered} teslim · iptal %{row.cancel_rate} · iade %{row.refund_rate}</Text></View><Text style={[st.money, { color: t.text }]}>{moneyTL(row.revenue_cents)}</Text></View>)}
      </View>
      <SectionHeader title="Müşteri davranışı" subtitle="Segment bazında harcama ve risk" />
      <SegmentedControl options={[{ value: 'all', label: 'Tümü' }, { value: 'new', label: 'Yeni' }, { value: 'repeat', label: 'Tekrar eden' }, { value: 'at_risk', label: 'Riskli' }]} value={group} onChange={setGroup} />
      <View style={[st.table, { backgroundColor: t.surface }]}>{customers.length === 0 ? <EmptyState title="Bu segmentte müşteri yok" /> : customers.map(row => <View key={row.id} style={[st.tableRow, { borderColor: t.divider }]}><View style={st.grow}><Text style={[st.rowTitle, { color: t.text }]}>{row.name}</Text><Text style={[st.rowSub, { color: t.textSecondary }]}>{row.orders} sipariş · {row.refunds} iade · {row.avg_delivery_minutes ?? 0} dk</Text></View><Text style={[st.money, { color: t.text }]}>{moneyTL(row.spend_cents)}</Text></View>)}</View>
      <View style={{ height: 32 }} />
    </ScrollView> : null}
  </View>;
}


function Comparison({ comparison }: { comparison: DecisionComparison }) {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const change = (current: number, previous: number) => previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 1000) / 10;
  const rows = [
    { label: 'Satış', current: comparison.current.revenue_cents, previous: comparison.previous.revenue_cents, money: true },
    { label: 'Sipariş', current: comparison.current.orders, previous: comparison.previous.orders, money: false },
    { label: 'Başarı oranı', current: comparison.current.success_rate ?? 0, previous: comparison.previous.success_rate ?? 0, money: false, suffix: '%' },
    { label: 'İade', current: comparison.current.refunds, previous: comparison.previous.refunds, money: false },
  ];
  return <View style={[st.compare, { backgroundColor: t.surface }]}>{rows.map(row => {
    const delta = change(row.current, row.previous);
    const good = row.label === 'İade' ? delta <= 0 : delta >= 0;
    return <View key={row.label} style={st.compareRow}><Text style={[st.rowSub, { color: t.textSecondary }]}>{row.label}</Text><Text style={[st.compareValue, { color: t.text }]}>{row.money ? moneyTL(row.current) : `${row.current}${row.suffix ?? ''}`}</Text><View style={[st.delta, { backgroundColor: good ? `${t.success}18` : `${t.danger}18` }]}><Ionicons name={delta >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color={good ? t.success : t.danger} /><Text style={[st.deltaText, { color: good ? t.success : t.danger }]}>{Math.abs(delta)}%</Text></View></View>;
  })}</View>;
}

function SalesChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const width = 720; const height = 210; const pad = 18;
  if (!data.length) return <EmptyState title="Grafik verisi yok" description="Bu dönemde satış kaydı bulunmuyor." icon="bar-chart-outline" />;
  const max = Math.max(...data.map(row => row.value), 1);
  const points = data.map((row, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(data.length - 1, 1);
    const y = height - pad - (row.value / max) * (height - pad * 2);
    return { x, y, ...row };
  });
  return <View accessible accessibilityLabel={`Günlük satış grafiği, ${data.length} gün`}><Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
    <Line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={t.divider} strokeWidth={1} />
    <Line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke={t.divider} strokeWidth={1} />
    <Polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={t.accent} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
    {points.map(point => <Circle key={point.label} cx={point.x} cy={point.y} r={5} fill={t.surface} stroke={t.text} strokeWidth={2} />)}
  </Svg><View style={st.axis}><Text style={[st.axisText, { color: t.textSecondary }]}>{new Date(`${data[0].label}T12:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</Text><Text style={[st.axisText, { color: t.textSecondary }]}>{moneyTL(max)}</Text><Text style={[st.axisText, { color: t.textSecondary }]}>{new Date(`${data[data.length - 1].label}T12:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</Text></View></View>;
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  list: { padding: 16, gap: 14 }, cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, muted: { fontFamily: fonts.regular, fontSize: 13 },
  compare: { borderRadius: 16, paddingHorizontal: 14 }, compareRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: t.divider },
  compareValue: { flex: 1, textAlign: 'right', fontFamily: fonts.bold, fontSize: 14 }, delta: { minWidth: 62, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  deltaText: { fontFamily: fonts.bold, fontSize: 11 }, chartCard: { borderRadius: 16, padding: 10, overflow: 'hidden' }, axis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }, axisText: { fontFamily: fonts.regular, fontSize: 11 },
  table: { borderRadius: 16, overflow: 'hidden' }, tableRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1 },
  tableHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1 }, headerCell: { flex: 1, fontFamily: fonts.semibold, fontSize: 12 }, headerAmount: { flex: 1, textAlign: 'right' },
  grow: { flex: 1 }, rowTitle: { fontFamily: fonts.semibold, fontSize: 14 }, rowSub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, money: { fontFamily: fonts.bold, fontSize: 14 },
});

