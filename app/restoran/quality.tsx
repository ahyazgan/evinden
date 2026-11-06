import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { fetchSellerInvoices, fetchSellerSlaViolations, type SellerInvoiceRow, type SellerSlaRow } from '@/lib/enterprise';
import { enterpriseStatus, INVOICE_STATUS, SLA_STATUS } from '@/lib/enterprise-status';
import { dateTR, moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Tab = 'sla' | 'invoices';

const VIOLATION_LABELS: Record<SellerSlaRow['violation_type'], string> = {
  acceptance_timeout: 'Sipariş zamanında onaylanmadı',
  preparation_timeout: 'Hazırlık süresi aşıldı',
};

const DAY = 24 * 60 * 60 * 1000;

export default function SellerQualityScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [tab, setTab] = useState<Tab>('sla');
  const [violations, setViolations] = useState<SellerSlaRow[]>([]);
  const [invoices, setInvoices] = useState<SellerInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, i] = await Promise.all([fetchSellerSlaViolations(), fetchSellerInvoices()]);
      setViolations(v); setInvoices(i); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const last30 = violations.filter(v => Date.now() - new Date(v.occurred_at).getTime() < 30 * DAY);
  const openPenalty = violations.filter(v => v.status === 'open').reduce((sum, v) => sum + v.penalty_cents, 0);

  return (
    <View style={st.safe}>
      <TopBar title="Gecikme ve fatura" subtitle="Hizmet kaydın ve adına kesilen faturalar" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
          {loadError ? (
            <View style={[st.card, { backgroundColor: t.surface }]}>
              <Text accessibilityLiveRegion="polite" style={st.error}>Kayıtlar alınamadı. Bağlantını kontrol edip tekrar dene.</Text>
              <Button label="Tekrar dene" variant="outline" size="sm" onPress={() => { setLoading(true); void load(); }} />
            </View>
          ) : null}
          <SegmentedControl options={[{ value: 'sla', label: 'Gecikmeler' }, { value: 'invoices', label: 'Faturalar' }]} value={tab} onChange={setTab} />

          {tab === 'sla' ? <>
            <View style={st.metrics}>
              <MetricCard label="Son 30 gün" value={String(last30.length)} hint="Gecikme kaydı" icon="timer-outline" variant={last30.length ? 'warning' : 'accent'} />
              {openPenalty > 0 ? <MetricCard label="Açık ceza" value={moneyTL(openPenalty)} hint="Yönetim kararı bekliyor" icon="alert-circle-outline" variant="danger" /> : null}
            </View>
            <Text style={st.sub}>Siparişi zamanında onaylamadığında veya hazırlık süresi aşıldığında burada kayıt oluşur. Kayıtlar mağaza puanını ve sıralamayı etkileyebilir. İtirazın varsa destekten yaz.</Text>
            <SectionHeader title="Gecikme kayıtları" subtitle="En yeniden eskiye" />
            {violations.length === 0 ? <EmptyState title="Gecikme kaydın yok" description="Siparişleri zamanında onaylayıp hazırladığın sürece burası boş kalır." icon="checkmark-circle-outline" /> : violations.map(v => {
              const status = enterpriseStatus(SLA_STATUS, v.status);
              return <View key={v.id} style={[st.card, { backgroundColor: t.surface }]} accessible accessibilityLabel={`${VIOLATION_LABELS[v.violation_type]}, ${status.label}`}>
                <View style={st.head}><Text style={st.title}>{VIOLATION_LABELS[v.violation_type]}</Text><StatusPill label={status.label} variant={status.variant} /></View>
                <Text style={st.sub}>Sipariş #{v.order_id.slice(0, 8)} · {dateTR(v.occurred_at, true)}</Text>
                <Text style={st.sub}>{v.minutes_late > 0 ? `Sınırı ${v.minutes_late} dakika aştı` : 'Süre sınırında'}{v.penalty_cents > 0 ? ` · Ceza ${moneyTL(v.penalty_cents)}` : ''}</Text>
                {v.note ? <Text style={st.note}>Yönetim notu: {v.note}</Text> : null}
              </View>;
            })}
          </> : <>
            <Text style={st.sub}>Kurumsal müşterilere senin adına kesilen e-faturalar. Fatura bilgilerin Mağaza ayarlarındaki şirket bilgilerinden alınır.</Text>
            <SectionHeader title="Faturalar" subtitle="En yeniden eskiye" />
            {invoices.length === 0 ? <EmptyState title="Henüz fatura yok" description="Kurumsal bir müşteri fatura istediğinde burada görünür." icon="document-text-outline" /> : invoices.map(i => {
              const status = enterpriseStatus(INVOICE_STATUS, i.status);
              return <View key={i.id} style={[st.card, { backgroundColor: t.surface }]} accessible accessibilityLabel={`${i.invoice_number}, ${status.label}`}>
                <View style={st.head}><Text style={st.title}>{i.invoice_number}</Text><StatusPill label={status.label} variant={status.variant} /></View>
                <Text style={st.sub}>{i.buyer_title} · Sipariş #{i.order_id.slice(0, 8)}</Text>
                <View style={st.head}><Text style={st.amount}>{moneyTL(i.total_cents)}</Text><Text style={st.sub}>KDV {moneyTL(i.tax_cents)} · {dateTR(i.issued_at)}</Text></View>
                {i.correction_status === 'required' ? <Text style={st.error}>Siparişin iadesi onaylandı; fatura için iptal veya iade faturası işlemi yönetimde.</Text> : null}
              </View>;
            })}
          </>}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.text },
  amount: { fontFamily: fonts.bold, fontSize: 14, color: t.text },
  error: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: t.danger },
});
