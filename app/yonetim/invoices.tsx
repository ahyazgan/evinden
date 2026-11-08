import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill, ToolbarSearch } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { createInvoices, fetchInvoiceCandidates, fetchInvoices, refreshInvoiceStatuses, type InvoiceCandidateRow, type InvoiceRow } from '@/lib/enterprise';
import { enterpriseStatus, INVOICE_STATUS } from '@/lib/enterprise-status';
import { moneyTL, dateTR } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Filter = 'all' | 'pending' | 'draft' | 'submitted' | 'accepted' | 'rejected' | 'correction';

function invoiceFilterFromParam(value?: string): Filter {
  return value === 'pending' || value === 'draft' || value === 'submitted' || value === 'accepted' || value === 'rejected' || value === 'correction' ? value : 'all';
}

function matchesFilter(row: InvoiceRow, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return ['draft', 'queued', 'sending', 'submitted'].includes(row.status);
  if (filter === 'correction') return row.correction_status === 'required';
  return row.status === filter;
}

export default function AdminInvoicesScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [candidates, setCandidates] = useState<InvoiceCandidateRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>(() => invoiceFilterFromParam(statusParam));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [rows, possible] = await Promise.all([fetchInvoices(), fetchInvoiceCandidates()]); setInvoices(rows); setCandidates(possible); }
    catch (e: any) { Alert.alert('Faturalar alınamadı', e?.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setFilter(invoiceFilterFromParam(statusParam)); }, [statusParam]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const [checking, setChecking] = useState(false);
  const corrections = invoices.filter(r => r.correction_status === 'required').length;
  const submitted = invoices.filter(r => r.status === 'submitted').length;
  const checkStatuses = async () => {
    setChecking(true);
    try {
      const r = await refreshInvoiceStatuses(); await load();
      Alert.alert('Durumlar sorgulandı', r.checked === 0
        ? 'Sonuç bekleyen fatura yok.'
        : `${r.checked} fatura sorgulandı: ${r.accepted} kabul, ${r.rejected} red, ${r.unchanged} sonuç bekliyor${r.failed ? `, ${r.failed} sorgulanamadı` : ''}.`);
    } catch (e: any) { Alert.alert('Durumlar sorgulanamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setChecking(false); }
  };
  const visibleInvoices = invoices.filter(row => {
    const statusMatches = matchesFilter(row, filter);
    return statusMatches &&`${row.invoice_number} ${row.customer_name} ${row.seller_name}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR'));
  });
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const createSelected = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const result = await createInvoices([...selected]); setSelected(new Set()); await load();
      Alert.alert('Faturalar oluşturuldu', `${result.created} taslak hazırlandı. Göndermek için detayı inceleyip onayla.${result.skipped ? ` ${result.skipped} sipariş atlandı.` : ''}`);
    } catch (e: any) { Alert.alert('Faturalar oluşturulamadı', e?.message); }
    finally { setBusy(false); }
  };

  return (
    <View style={st.safe}>
      <TopBar title="E-faturalar" subtitle="Oluştur, önizle ve sağlayıcıya gönder" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
          <View style={st.metrics}>
            <MetricCard label="Faturalanacak" value={String(candidates.length)} icon="document-text-outline" />
            <MetricCard label="Reddedilen" value={String(invoices.filter(r => r.status === 'rejected').length)} icon="alert-circle-outline" variant={invoices.some(r => r.status === 'rejected') ? 'danger' : 'accent'} onPress={() => setFilter('rejected')} />
            {corrections ? <MetricCard label="Düzeltme bekleyen" value={String(corrections)} icon="document-attach-outline" variant="danger" onPress={() => setFilter('correction')} /> : null}
          </View>
          {submitted ? <Button label={`GİB sonucunu sorgula (${submitted})`} variant="outline" onPress={checkStatuses} loading={checking} fullWidth /> : null}
          <SectionHeader title="Faturalar" subtitle="Durum filtreleri ve detay ekranı" />
          <SegmentedControl options={[{ value: 'all', label: 'Tümü' }, { value: 'pending', label: 'Bekleyen' }, { value: 'draft', label: 'Taslak' }, { value: 'submitted', label: 'Gönderildi' }, { value: 'accepted', label: 'Kabul' }, { value: 'rejected', label: 'Red' }, { value: 'correction', label: 'Düzeltme' }]} value={filter} onChange={setFilter} />
          <ToolbarSearch value={search} onChangeText={setSearch} placeholder="Fatura, müşteri veya satıcı ara" />
          {visibleInvoices.length === 0 ? <EmptyState title="Fatura bulunamadı" description="Filtreyi değiştir veya yeni fatura oluştur." icon="document-text-outline" /> : visibleInvoices.map(row => {
            const status = enterpriseStatus(INVOICE_STATUS, row.status);
            return <Pressable key={row.id} onPress={() => router.push(`/yonetim/invoice/${row.id}` as any)} style={[st.card, { backgroundColor: t.surface }]} accessibilityRole="button" accessibilityLabel={`${row.invoice_number}, ${status.label}`}>
              <View style={st.head}><Text style={st.title}>{row.invoice_number}</Text><StatusPill label={status.label} variant={status.variant} /></View>
              <Text style={st.sub}>{row.customer_name} · {row.seller_name}</Text>
              <View style={st.row}><Text style={st.amount}>{moneyTL(row.total_cents)}</Text><Text style={st.sub}>{dateTR(row.created_at)}</Text><Ionicons name="chevron-forward" size={18} color={t.textSecondary} /></View>
              {row.correction_status === 'required' ? <Text style={st.error}>Sipariş iade edildi: GİB iptali veya alıcının iade faturası kaydı bekliyor</Text> : null}
              {row.error ? <Text numberOfLines={2} style={st.error}>{row.error}</Text> : null}
            </Pressable>;
          })}
          <SectionHeader title="Faturalanacak siparişler" subtitle="Profili eksik olmayanları seçip toplu taslak oluştur" />
          {candidates.length === 0 ? <EmptyState title="Faturalanacak sipariş yok" description="Teslim edilip henüz faturalanmamış sipariş bulunmuyor." icon="checkmark-circle-outline" /> : candidates.map(row => {
            const complete = !!row.billing_title && !!row.billing_tax_number && !!row.billing_tax_office && !!row.billing_address && !!row.billing_email;
            const checked = selected.has(row.order_id);
            return <Pressable key={row.order_id} onPress={() => complete && toggle(row.order_id)} disabled={!complete} style={[st.card, { backgroundColor: t.surface, opacity: complete ? 1 : 0.65 }]} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !complete }}>
              <View style={st.rowHead}><View style={st.grow}><Text style={st.title}>{row.customer_name} · {row.seller_name}</Text><Text style={st.sub}>#{row.order_id.slice(0, 8)} · {moneyTL(row.total_cents)}</Text></View><View style={[st.check, { borderColor: checked ? t.accent : t.divider, backgroundColor: checked ? t.accent : t.surface }]}>{checked ? <Ionicons name="checkmark" size={16} color={t.onAccent} /> : null}</View></View>
              <Text style={complete ? st.sub : st.error}>{complete ? row.billing_title : 'Kurumsal fatura profili eksik'}</Text>
            </Pressable>;
          })}
          {selected.size ? <View style={[st.bulk, { backgroundColor: t.brand }]}><Text style={[st.bulkText, { color: t.onBrand }]}>{selected.size} sipariş seçildi</Text><Button label="Taslak oluştur" variant="accent" onPress={createSelected} loading={busy} /></View> : null}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { borderRadius: 16, padding: 14, gap: 7 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 }, title: { fontFamily: fonts.bold, fontSize: 15, color: t.text }, sub: { fontFamily: fonts.regular, fontSize: 13, color: t.textSecondary },
  amount: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: t.text }, error: { fontFamily: fonts.regular, fontSize: 12, color: t.danger },
  check: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bulk: { position: 'absolute', left: 16, right: 16, bottom: 16, minHeight: 58, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bulkText: { fontSize: 14, fontFamily: fonts.bold },
});
