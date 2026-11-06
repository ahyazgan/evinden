import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId } from '@/lib/db';
import { fetchSellerSlaViolations, type SellerSlaRow } from '@/lib/enterprise';
import {
  fetchMyCommissionInvoices, fetchSellerInvoiceRequests, markInvoiceCorrected, markOrderInvoiced, monthLabel,
  ORDER_INVOICE_STATUS, orderInvoiceUrl, pickAndUploadOrderInvoice, type CommissionInvoice, type OrderInvoiceRequest,
} from '@/lib/invoicing';
import { enterpriseStatus, SLA_STATUS } from '@/lib/enterprise-status';
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
  const { profile } = useAuth();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === 'invoices' ? 'invoices' : 'sla');
  const [violations, setViolations] = useState<SellerSlaRow[]>([]);
  const [requests, setRequests] = useState<OrderInvoiceRequest[]>([]);
  const [commission, setCommission] = useState<CommissionInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Fatura işleme penceresi
  const [editing, setEditing] = useState<OrderInvoiceRequest | null>(null);
  const [number, setNumber] = useState('');
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<OrderInvoiceRequest | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (tabParam === 'invoices') setTab('invoices'); }, [tabParam]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const seller = await fetchSellerByUserId(profile.id);
      if (!seller) { setLoading(false); return; }
      const [v, r, c] = await Promise.all([
        fetchSellerSlaViolations(), fetchSellerInvoiceRequests(seller.id), fetchMyCommissionInvoices(seller.id),
      ]);
      setViolations(v); setRequests(r); setCommission(c); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [profile?.id]);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const last30 = violations.filter(v => Date.now() - new Date(v.occurred_at).getTime() < 30 * DAY);
  const openPenalty = violations.filter(v => v.status === 'open').reduce((sum, v) => sum + v.penalty_cents, 0);
  const todo = requests.filter(r => r.status === 'requested' || r.status === 'correction_required');
  const done = requests.filter(r => r.status !== 'requested' && r.status !== 'correction_required');

  const openEditor = (row: OrderInvoiceRequest) => { setEditing(row); setNumber(row.invoice_number ?? ''); setDocumentPath(null); };
  const upload = async () => {
    if (!editing || !profile?.id) return;
    setUploading(true);
    try { const path = await pickAndUploadOrderInvoice(profile.id, editing.order_id); if (path) setDocumentPath(path); }
    catch (e: any) { Alert.alert('Belge yüklenemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setUploading(false); }
  };
  const saveInvoice = async () => {
    if (!editing) return;
    setBusy(true);
    try { await markOrderInvoiced(editing.order_id, number.trim(), documentPath); setEditing(null); await load(); }
    catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };
  const saveCorrection = async () => {
    if (!correcting) return;
    setBusy(true);
    try { await markInvoiceCorrected(correcting.order_id, correctionNote.trim()); setCorrecting(null); setCorrectionNote(''); await load(); }
    catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };
  const openDocument = async (path: string) => {
    try { await Linking.openURL(await orderInvoiceUrl(path)); }
    catch { Alert.alert('Belge açılamadı', 'Lütfen tekrar dene.'); }
  };

  const requestCard = (row: OrderInvoiceRequest) => {
    const status = ORDER_INVOICE_STATUS[row.status];
    return <View key={row.order_id} style={[st.card, { backgroundColor: t.surface }]}>
      <View style={st.head}><Text style={st.title}>{row.buyer.title}</Text><StatusPill label={status.label} variant={status.variant} /></View>
      <Text style={st.sub}>Sipariş #{row.order_id.slice(0, 8)} · {dateTR(row.created_at, true)}</Text>
      {row.status === 'requested' ? <>
        <Text selectable style={st.note}>VKN/TCKN: {row.buyer.taxNumber} · {row.buyer.taxOffice}{'\n'}{row.buyer.address}{'\n'}{row.buyer.email}</Text>
        <Button label="Faturayı kestim" size="sm" onPress={() => openEditor(row)} />
      </> : null}
      {row.status === 'correction_required' ? <>
        <Text style={st.error}>Sipariş iade edildi. {row.invoice_number} numaralı faturayı iptal et; alıcı e-fatura kullanıcısıysa ondan iade faturası iste.</Text>
        <Button label="Düzeltmeyi yaptım" size="sm" onPress={() => { setCorrecting(row); setCorrectionNote(''); }} />
      </> : null}
      {row.invoice_number && row.status !== 'correction_required' ? <Text style={st.sub}>Fatura no: {row.invoice_number}</Text> : null}
      {row.correction_note ? <Text style={st.sub}>Düzeltme: {row.correction_note}</Text> : null}
      {row.status === 'issued' ? <View style={st.actions}>
        {row.document_path ? <Button label="Belgeyi aç" variant="outline" size="sm" onPress={() => openDocument(row.document_path!)} /> : null}
        <Button label="Düzenle" variant="outline" size="sm" onPress={() => openEditor(row)} />
      </View> : null}
    </View>;
  };

  return (
    <View style={st.safe}>
      <TopBar title="Gecikme ve fatura" subtitle="Hizmet kaydın ve faturaların" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
          {loadError ? (
            <View style={[st.card, { backgroundColor: t.surface }]}>
              <Text accessibilityLiveRegion="polite" style={st.error}>Kayıtlar alınamadı. Bağlantını kontrol edip tekrar dene.</Text>
              <Button label="Tekrar dene" variant="outline" size="sm" onPress={() => { setLoading(true); void load(); }} />
            </View>
          ) : null}
          <SegmentedControl options={[{ value: 'sla', label: 'Gecikmeler' }, { value: 'invoices', label: todo.length ? `Faturalar (${todo.length})` : 'Faturalar' }]} value={tab} onChange={setTab} />

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
            <Text style={st.sub}>Kurumsal müşteri fatura istediğinde bilgileri burada görünür. Faturayı kendi e-fatura/e-arşiv sisteminden kes, numarasını yaz; istersen PDF'ini de ekle. Müşteri numarayı ve belgeyi uygulamada görür.</Text>
            <SectionHeader title="Yapılacaklar" subtitle="Kesilecek ve düzeltilecek faturalar" />
            {todo.length === 0 ? <EmptyState title="Bekleyen fatura yok" description="Yeni fatura talebi gelince bildirim alırsın." icon="checkmark-circle-outline" /> : todo.map(requestCard)}
            {done.length ? <SectionHeader title="Geçmiş" subtitle="Kesilen ve kapanan talepler" /> : null}
            {done.map(requestCard)}
            <SectionHeader title="Platformun komisyon faturaları" subtitle="Her ay kesilen hizmet faturası" />
            {commission.length === 0 ? <EmptyState title="Henüz komisyon faturası yok" description="Ay kapanınca o ayın komisyon faturası burada görünür." icon="receipt-outline" /> : commission.map(c => (
              <View key={c.id} style={[st.card, { backgroundColor: t.surface }]}>
                <View style={st.head}><Text style={st.title}>{monthLabel(c.period_month)}</Text><Text style={st.amount}>{moneyTL(c.total_cents)}</Text></View>
                <Text style={st.sub}>{c.order_count} sipariş · Komisyon {moneyTL(c.commission_cents)} + KDV {moneyTL(c.tax_cents)}</Text>
                {c.invoice_number ? <Text style={st.sub}>Fatura no: {c.invoice_number}</Text> : null}
              </View>
            ))}
          </>}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={st.modalBack}><View style={[st.modal, { backgroundColor: t.surface }]}>
          <Text accessibilityRole="header" style={st.modalTitle}>Fatura bilgisi</Text>
          <Text style={st.sub}>{editing?.buyer.title} · Sipariş #{editing?.order_id.slice(0, 8)}</Text>
          <Input label="Fatura numarası" value={number} onChangeText={setNumber} placeholder="Ör. ABC2026000000123" autoCapitalize="characters" />
          <Button label={documentPath ? 'Belge eklendi, değiştir' : 'PDF veya fotoğraf ekle (isteğe bağlı)'} variant="outline" onPress={upload} loading={uploading} fullWidth />
          <View style={st.actions}>
            <Button label="Vazgeç" variant="outline" onPress={() => setEditing(null)} />
            <Button label="Kaydet" onPress={saveInvoice} loading={busy} disabled={number.trim().length < 3 || uploading} />
          </View>
        </View></View>
      </Modal>
      <Modal visible={correcting !== null} transparent animationType="fade" onRequestClose={() => setCorrecting(null)}>
        <View style={st.modalBack}><View style={[st.modal, { backgroundColor: t.surface }]}>
          <Text accessibilityRole="header" style={st.modalTitle}>Düzeltme</Text>
          <Text style={st.sub}>Ne yaptığını kısaca yaz: fatura iptal edildi veya alıcının iade faturası numarası.</Text>
          <Input label="Açıklama" value={correctionNote} onChangeText={setCorrectionNote} placeholder="Ör. e-Arşiv fatura iptal edildi" />
          <View style={st.actions}>
            <Button label="Vazgeç" variant="outline" onPress={() => setCorrecting(null)} />
            <Button label="Kaydet" onPress={saveCorrection} loading={busy} disabled={correctionNote.trim().length < 5} />
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.text },
  amount: { fontFamily: fonts.bold, fontSize: 14, color: t.text },
  error: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: t.danger },
  modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 460, borderRadius: 18, padding: 20, gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: t.heading },
});
