import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DetailRow, EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { closeReconciliation, createReconciliation, fetchReconciliationBreakdown, fetchReconciliations, type ReconciliationBreakdown, type ReconciliationRow } from '@/lib/enterprise';
import { enterpriseStatus, RECONCILIATION_STATUS } from '@/lib/enterprise-status';
import { moneyTL, dateTR, sourceLabel } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Period = 'today' | 'yesterday' | 'week' | 'month';

export default function AdminReconciliationScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'difference' | 'matched' | 'closed'>(statusParam === 'difference' || statusParam === 'matched' || statusParam === 'closed' ? statusParam : 'all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<Period>('yesterday');
  const [source, setSource] = useState<'iyzico' | 'bank'>('iyzico');
  const [actual, setActual] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<{ row: ReconciliationRow; breakdown: ReconciliationBreakdown } | null>(null);
  const [closeTarget, setCloseTarget] = useState<ReconciliationRow | null>(null);
  const [closeNote, setCloseNote] = useState('');

  const visibleRows = rows.filter(row => statusFilter === 'all' || row.status === statusFilter);
  const load = useCallback(async () => {
    try { setRows(await fetchReconciliations()); }
    catch (e: any) { Alert.alert('Mutabakatlar alınamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setStatusFilter(statusParam === 'difference' || statusParam === 'matched' || statusParam === 'closed' ? statusParam : 'all'); }, [statusParam]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const dates = useMemo(() => {
    const end = new Date(); const start = new Date(end);
    if (period === 'today') start.setHours(0, 0, 0, 0);
    if (period === 'yesterday') { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999); }
    if (period === 'week') start.setDate(start.getDate() - 7);
    if (period === 'month') start.setDate(start.getDate() - 30);
    return { start, end };
  }, [period]);

  const create = async () => {
    const cents = parseTLToCents(actual);
    if (cents === null) { Alert.alert('Geçersiz tutar', 'Sağlayıcı tutarını gir. Örnek: 1.250,50'); return; }
    setBusy(true);
    try { await createReconciliation({ periodStart: dates.start.toISOString(), periodEnd: dates.end.toISOString(), actualCents: cents, source, reference, note }); setActual(''); setReference(''); setNote(''); await load(); }
    catch (e: any) { Alert.alert('Mutabakat oluşturulamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };
  const openDetail = async (row: ReconciliationRow) => {
    try { setDetail({ row, breakdown: await fetchReconciliationBreakdown(row.id) }); }
    catch (e: any) { Alert.alert('Kırılım alınamadı', e?.message ?? 'Lütfen tekrar dene.'); }
  };
  const close = async () => {
    if (!closeTarget) return;
    if (closeNote.trim().length < 5) { Alert.alert('Açıklama gerekli', 'Farkı açıklayan en az 5 karakterlik bir not gir.'); return; }
    const row = closeTarget; setCloseTarget(null); setBusy(true);
    try { await closeReconciliation(row.id, closeNote.trim()); setCloseNote(''); await load(); }
    catch (e: any) { Alert.alert('Kapatılamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };


  return (
    <View style={st.safe}>
      <TopBar title="Ödeme mutabakatı" subtitle="Beklenen, gerçek ve fark" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
        <View style={st.metrics}>
          <MetricCard label="Farklı dönem" value={String(rows.filter(r => r.status === 'difference').length)} icon="git-compare-outline" variant={rows.some(r => r.status === 'difference') ? 'danger' : 'accent'} />
          <MetricCard label="Toplam fark" value={moneyTL(rows.filter(r => r.status === 'difference').reduce((sum, r) => sum + Math.abs(r.difference_cents), 0), true)} icon="alert-circle-outline" />
        </View>
        <SectionHeader title="Yeni mutabakat" subtitle="Sağlayıcı tutarını ve referansı kaydet" />
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <Text style={st.label}>Dönem</Text>
          <SegmentedControl options={[{ value: 'today', label: 'Bugün' }, { value: 'yesterday', label: 'Dün' }, { value: 'week', label: 'Son 7 gün' }, { value: 'month', label: 'Son 30 gün' }]} value={period} onChange={setPeriod} />
          <Text style={st.label}>Kaynak</Text>
          <SegmentedControl options={[{ value: 'iyzico', label: 'iyzico' }, { value: 'bank', label: 'Banka' }]} value={source} onChange={setSource} />
          <Input label="Sağlayıcı tutarı (TL)" value={actual} onChangeText={setActual} keyboardType="decimal-pad" placeholder="0,00" />
          <Input label="Referans" value={reference} onChangeText={setReference} placeholder="Banka veya sağlayıcı referansı" />
          <Input label="Not (isteğe bağlı)" value={note} onChangeText={setNote} placeholder="Dönemle ilgili kısa açıklama" multiline />
          <Button label="Mutabakat oluştur" onPress={create} loading={busy} fullWidth />
        </View>
        <SectionHeader title="Mutabakat geçmişi" subtitle="Farkı olan dönemleri incele ve açıkla" />
        <SegmentedControl options={[{ value: 'all', label: 'Tümü' }, { value: 'difference', label: 'Farklı' }, { value: 'matched', label: 'Eşleşen' }, { value: 'closed', label: 'Kapatılan' }]} value={statusFilter} onChange={setStatusFilter} />
        {visibleRows.length === 0 ? <EmptyState title="Mutabakat yok" description="Seçili durumda uygun mutabakat bulunmuyor." icon="git-compare-outline" /> : visibleRows.map(row => {
          const status = enterpriseStatus(RECONCILIATION_STATUS, row.status);
          return <Pressable key={row.id} onPress={() => openDetail(row)} style={[st.card, { backgroundColor: t.surface }]} accessibilityRole="button" accessibilityLabel={`${sourceLabel(row.source)} mutabakatı, ${status.label}`}>
            <View style={st.rowHead}><Text style={[st.title, { color: t.text }]}>{sourceLabel(row.source)} · {dateTR(row.period_start)} – {dateTR(row.period_end)}</Text><StatusPill label={status.label} variant={status.variant} /></View>
            <Text style={[st.meta, { color: t.textSecondary }]}>Beklenen {moneyTL(row.expected_cents)} · Gerçek {moneyTL(row.actual_cents)}</Text>
            <Text style={[st.difference, { color: row.difference_cents === 0 ? t.success : t.danger }]}>Fark {moneyTL(row.difference_cents)}</Text>
            {row.reference ? <Text style={[st.meta, { color: t.textMuted }]}>Ref: {row.reference}</Text> : null}
          </Pressable>;
        })}
        <View style={{ height: 32 }} />
      </ScrollView>}
      {detailModal(detail, t, st, () => setDetail(null), () => { if (detail) { setCloseTarget(detail.row); setDetail(null); } })}
      {closeModal(closeTarget, closeNote, setCloseNote, busy, t, st, () => setCloseTarget(null), close)}
    </View>
  );
}

// Türkçe tutar biçimini okur: 1.250,50 · 1250,50 · 1250.50 · 1.250 → kuruş. Boş veya geçersizse null.
function parseTLToCents(input: string): number | null {
  let v = input.replace(/\s|₺|TL/gi, '');
  if (!v) return null;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

function detailModal(detail: { row: ReconciliationRow; breakdown: ReconciliationBreakdown } | null, t: ThemeColors, st: ReturnType<typeof createStyles>, close: () => void, openClose: () => void) {
  return <Modal visible={!!detail} transparent animationType="slide" onRequestClose={close}><View style={st.modalBack}><View style={[st.sheet, { backgroundColor: t.surface }]}>
    <View style={st.sheetHead}><Text accessibilityRole="header" style={[st.sheetTitle, { color: t.heading }]}>Mutabakat kırılımı</Text><Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat"><Text style={[st.close, { color: t.textSecondary }]}>Kapat</Text></Pressable></View>
    {detail ? <>
      <Text style={[st.meta, { color: t.textSecondary }]}>{sourceLabel(detail.row.source)} · {dateTR(detail.row.period_start)} – {dateTR(detail.row.period_end)}</Text>
      <View style={[st.summary, { backgroundColor: t.background }]}>
        <DetailRow label="Brüt satış" value={moneyTL(detail.breakdown.gross_sales_cents)} />
        <DetailRow label="İadeler" value={`-${moneyTL(detail.breakdown.refunds_cents)}`} tone="danger" />
        {detail.breakdown.refund_pending_cents > 0 ? <DetailRow label="İadesi bekleyen (nette dahil)" value={moneyTL(detail.breakdown.refund_pending_cents)} /> : null}
        <DetailRow label="Beklenen net" value={moneyTL(detail.breakdown.net_cents)} tone="success" />
        <DetailRow label="Sağlayıcı tutarı" value={moneyTL(detail.breakdown.actual_cents)} />
        <DetailRow label="Kalan fark" value={moneyTL(detail.breakdown.difference_cents)} tone={detail.breakdown.difference_cents === 0 ? 'success' : 'danger'} />
      </View>
      <Text style={st.label}>Dönem içi satırlar</Text>
      {detail.breakdown.items.length === 0 ? <Text style={[st.meta, { color: t.textSecondary }]}>Bu dönemde satır kaydı yok.</Text> : detail.breakdown.items.map((item, index) => <View key={`${item.name}-${index}`} style={st.itemRow}><Text style={[st.itemName, { color: t.text }]}>{item.quantity} × {item.name}</Text><Text style={[st.itemAmount, { color: t.text }]}>{moneyTL(item.line_total_cents)}</Text></View>)}
      {detail.row.status !== 'closed' ? <Button label="Farkı açıkla ve kapat" onPress={openClose} fullWidth /> : null}
    </> : null}
  </View></View></Modal>;
}

function closeModal(target: ReconciliationRow | null, note: string, setNote: (value: string) => void, busy: boolean, t: ThemeColors, st: ReturnType<typeof createStyles>, cancel: () => void, confirm: () => void) {
  return <Modal visible={!!target} transparent animationType="fade" onRequestClose={cancel}><View style={st.modalBack}><View style={[st.closeModal, { backgroundColor: t.surface }]}><Text accessibilityRole="header" style={[st.sheetTitle, { color: t.heading }]}>Farkı açıkla ve kapat</Text><Text style={[st.meta, { color: t.textSecondary }]}>Kapatma nedeni kalıcı kayıtta saklanır.</Text><Input label="Açıklama" value={note} onChangeText={setNote} placeholder="Örn. banka ertesi gün hesaba geçirmiş" multiline /><View style={st.modalActions}><Button label="Vazgeç" variant="outline" onPress={cancel} /><Button label="Kapat" onPress={confirm} loading={busy} /></View></View></View></Modal>;
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: 16, gap: 12 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { borderRadius: 16, padding: 14, gap: 9 }, rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: t.text }, meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular }, label: { fontSize: 12, fontFamily: fonts.semibold, color: t.textSecondary },
  difference: { fontSize: 14, fontFamily: fonts.bold }, modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 }, sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontFamily: fonts.display }, close: { fontSize: 14, fontFamily: fonts.semibold }, summary: { borderRadius: 12, paddingHorizontal: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 38, borderBottomWidth: 1, borderBottomColor: t.divider },
  itemName: { flex: 1, fontSize: 13, fontFamily: fonts.regular }, itemAmount: { fontSize: 13, fontFamily: fonts.semibold }, closeModal: { width: '100%', maxWidth: 500, alignSelf: 'center', borderRadius: 18, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});

