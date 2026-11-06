import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { EmptyState, MetricCard, SectionHeader } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { fetchOperationsOverview, type OperationsOverview } from '@/lib/enterprise';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

export default function FinanceScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setOverview(await fetchOperationsOverview()); setLoadError(null); }
    catch (e: any) { setLoadError(e?.message ?? 'Bağlantını kontrol edip tekrar dene.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const modules = [
    { title: 'SLA yönetimi', description: 'Yanıt ve hazırlık kurallarını yönet, açık ihlalleri sonuçlandır.', icon: 'timer-outline' as const, route: '/yonetim/sla', count: overview?.sla_open ?? 0, danger: false },
    { title: 'İade karar merkezi', description: 'Müşteri taleplerini incele, karar ver ve iadeyi kayda geçir.', icon: 'arrow-undo-outline' as const, route: '/yonetim/refunds', count: (overview?.refunds_requested ?? 0) + (overview?.refunds_approved ?? 0), danger: false },
    { title: 'Ödeme mutabakatı', description: 'Sağlayıcı tutarlarını platform satışlarıyla karşılaştır, farkları açıkla.', icon: 'git-compare-outline' as const, route: '/yonetim/reconciliation', count: overview?.reconciliation_differences ?? 0, danger: true },
    { title: 'Komisyon faturaları', description: 'Ay kapanınca restoranlara kesilecek komisyon faturasını hazırla, numarasını işle.', icon: 'receipt-outline' as const, route: '/yonetim/commission-invoices', count: overview?.commission_drafts ?? 0, danger: false },
  ];
  return <View style={st.safe}>
    <TopBar title="Finans merkezi" subtitle="SLA, iade ve ödeme mutabakatı" back />
    {loading ? <View style={st.center}><LogoLoader /></View> : <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
      {loadError ? <Text accessibilityLiveRegion="polite" style={[st.sub, { color: t.danger }]}>Sayılar alınamadı, aşağıdaki değerler güncel değil. {loadError}</Text> : null}
      <View style={st.metrics}>
        <MetricCard label="Açık SLA" value={String(overview?.sla_open ?? 0)} icon="timer-outline" variant={overview?.sla_open ? 'warning' : 'accent'} onPress={() => router.push('/yonetim/sla' as any)} />
        <MetricCard label="Bekleyen iade" value={String((overview?.refunds_requested ?? 0) + (overview?.refunds_approved ?? 0))} icon="arrow-undo-outline" variant={overview?.refunds_requested ? 'warning' : 'accent'} onPress={() => router.push('/yonetim/refunds' as any)} />
        <MetricCard label="Mutabakat farkı" value={String(overview?.reconciliation_differences ?? 0)} icon="git-compare-outline" variant={overview?.reconciliation_differences ? 'danger' : 'accent'} onPress={() => router.push('/yonetim/reconciliation' as any)} />
      </View>
      <SectionHeader title="Operasyon modülleri" subtitle="Her işlem kendi odaklı ekranında" />
      {modules.length === 0 ? <EmptyState title="Modül yok" /> : modules.map(module => <Pressable key={module.route} onPress={() => router.push(module.route as any)} accessibilityRole="button" accessibilityLabel={module.title} style={[st.card, { backgroundColor: t.surface }]}>
        <View style={st.icon}><Ionicons name={module.icon} size={22} color={module.danger && module.count > 0 ? t.danger : t.text} /></View>
        <View style={st.copy}><Text style={[st.title, { color: t.heading }]}>{module.title}</Text><Text style={[st.sub, { color: t.textSecondary }]}>{module.description}</Text><Text style={[st.count, { color: module.count ? (module.danger ? t.danger : t.amber) : t.success }]}>{module.count ? `${module.count} bekleyen iş` : 'Bekleyen iş yok'}</Text></View>
        <Ionicons name="chevron-forward" size={20} color={t.textSecondary} />
      </Pressable>)}
      <View style={[st.note, { backgroundColor: t.surface }]}><Ionicons name="information-circle-outline" size={20} color={t.textSecondary} /><Text style={[st.sub, { color: t.textSecondary }]}>SLA cezaları kayıt altındadır; satıcı hakedişinden otomatik düşülmez. Bu davranış ayrı finansal karar olarak yönetilir.</Text></View>
      <View style={{ height: 32 }} />
    </ScrollView>}
  </View>;
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: 16, gap: 12 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 13, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontFamily: fonts.bold }, sub: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular }, count: { fontSize: 12, fontFamily: fonts.bold },
  note: { borderRadius: 14, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
