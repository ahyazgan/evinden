import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DetailRow, SectionHeader, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { fetchInvoiceDetail, queueInvoice, releaseInvoice, retryInvoice, submitInvoice, type InvoiceDetail } from '@/lib/enterprise';
import { enterpriseStatus, INVOICE_STATUS } from '@/lib/enterprise-status';
import { moneyTL, dateTR } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

export default function AdminInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseNote, setReleaseNote] = useState('');
  const load = useCallback(async () => {
    if (!id) return;
    try { setInvoice(await fetchInvoiceDetail(String(id))); setLoadError(null); }
    catch (e: any) { setLoadError(e?.message ?? 'Fatura bulunamadı.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const retry = async () => {
    if (!invoice) return;
    setBusy(true);
    try { await retryInvoice(invoice.id); await load(); }
    catch (e: any) { Alert.alert('Yeniden gönderilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!invoice) return;
    setBusy(true);
    try { if (invoice.status === 'draft') await queueInvoice(invoice.id); await submitInvoice(invoice.id); await load(); }
    catch (e: any) { Alert.alert('Fatura gönderilemedi', e?.message ?? 'Lütfen tekrar dene.'); await load(); }
    finally { setBusy(false); }
  };
  const release = async () => {
    if (!invoice) return;
    setBusy(true);
    try { await releaseInvoice(invoice.id, releaseNote.trim()); setReleaseOpen(false); setReleaseNote(''); await load(); }
    catch (e: any) { Alert.alert('Kuyruğa alınamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };
  const confirmSend = () => {
    if (!invoice) return;
    Alert.alert(
      invoice.status === 'draft' ? 'Faturayı gönder?' : 'Faturayı tekrar gönder?',
      `${invoice.invoice_number} numaralı fatura ${moneyTL(invoice.total_cents)} tutarındadır. Fatura e-fatura sağlayıcısına gönderilecek.`,
      [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Onayla ve gönder', onPress: send }],
    );
  };
  return <View style={st.safe}>
    <TopBar title="Fatura detayı" subtitle={invoice?.invoice_number} back />
    {loading ? <View style={st.center}><LogoLoader /></View> : invoice ? (
      <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <View style={st.head}><Text style={[st.number, { color: t.heading }]}>{invoice.invoice_number}</Text><StatusPill {...enterpriseStatus(INVOICE_STATUS, invoice.status)} /></View>
          <Text style={[st.meta, { color: t.textSecondary }]}>Sipariş #{invoice.order_id.slice(0, 8)}</Text>
          {invoice.error ? <Text accessibilityLiveRegion="polite" style={[st.error, { color: t.danger }]}>{invoice.error}</Text> : null}
        </View>
        <SectionHeader title="Fatura satırları" subtitle="Ürün, teslimat ve vergi özeti" />
        <View style={[st.card, { backgroundColor: t.surface }]}>
          {invoice.lines.map((line, index) => <View key={`${line.name}-${index}`} style={st.line}><View style={st.grow}><Text style={[st.lineName, { color: t.text }]}>{line.quantity} × {line.name}</Text>{line.kind === 'discount' ? null : <Text style={[st.meta, { color: t.textSecondary }]}>{moneyTL(line.unitPriceCents)} birim</Text>}</View><Text style={[st.lineAmount, { color: t.text }]}>{moneyTL(line.lineTotalCents)}</Text></View>)}
          <DetailRow label="KDV hariç toplam" value={moneyTL(invoice.subtotal_cents)} />
          <DetailRow label="KDV" value={moneyTL(invoice.tax_cents)} />
          <DetailRow label="Genel toplam" value={moneyTL(invoice.total_cents)} tone="success" />
        </View>
        <SectionHeader title="Alıcı ve satıcı" subtitle="Fatura anındaki resmî bilgiler" />
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <Text style={[st.company, { color: t.heading }]}>{invoice.buyer_snapshot.title ?? 'Alıcı'}</Text>
          <DetailRow label="Vergi dairesi" value={invoice.buyer_snapshot.taxOffice ?? '—'} />
          <DetailRow label="Vergi numarası" value={invoice.buyer_snapshot.taxNumber ?? '—'} />
          <DetailRow label="Adres" value={invoice.buyer_snapshot.address ?? '—'} />
          <DetailRow label="E-posta" value={invoice.buyer_snapshot.email ?? '—'} />
          <Text style={[st.company, { color: t.heading }]}>{invoice.seller_snapshot.title ?? 'Satıcı'}</Text>
          <DetailRow label="Satıcı vergi no" value={invoice.seller_snapshot.taxNumber ?? '—'} />
        </View>
        <SectionHeader title="Gönderim geçmişi" subtitle="Sağlayıcı ve GİB durumu" />
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <DetailRow label="Oluşturuldu" value={dateTR(invoice.created_at, true)} />
          <DetailRow label="Gönderildi" value={dateTR(invoice.submitted_at, true)} />
          <DetailRow label="Kabul edildi" value={dateTR(invoice.accepted_at, true)} />
          <DetailRow label="Sağlayıcı" value={invoice.provider} />
          <DetailRow label="Sağlayıcı referansı" value={invoice.provider_id ?? '—'} />
        </View>
        {['draft', 'queued'].includes(invoice.status) ? <Button label={invoice.status === 'draft' ? 'Onayla ve sağlayıcıya gönder' : 'Sağlayıcıya gönder'} onPress={confirmSend} loading={busy} fullWidth /> : null}
        {invoice.status === 'rejected' ? <Button label="Yeniden gönderim için kuyruğa al" onPress={retry} loading={busy} fullWidth /> : null}
        {invoice.status === 'sending' ? <>
          <Text style={[st.meta, { color: t.textSecondary }]}>Fatura gönderimde. Sonuç gelmediyse önce sağlayıcı panelinde bu numarayı ara; fatura orada yoksa kuyruğa geri al ve yeniden gönder.</Text>
          <Button label="Sağlayıcıda yok, kuyruğa geri al" variant="outline" onPress={() => setReleaseOpen(true)} fullWidth />
        </> : null}
        <View style={{ height: 32 }} />
      </ScrollView>
    ) : <View style={st.center}><Text style={[st.meta, { color: t.textSecondary }]}>{loadError ?? 'Fatura bulunamadı.'}</Text><Button label="Tekrar dene" variant="outline" size="sm" onPress={() => { setLoading(true); void load(); }} /></View>}
    <Modal visible={releaseOpen} transparent animationType="fade" onRequestClose={() => setReleaseOpen(false)}>
      <View style={st.modalBack}><View style={[st.modal, { backgroundColor: t.surface }]}>
        <Text accessibilityRole="header" style={[st.number, { color: t.heading }]}>Kuyruğa geri al</Text>
        <Text style={[st.meta, { color: t.textSecondary }]}>Faturanın sağlayıcıya ulaşmadığını kontrol ettiysen kısa bir not yaz. Fatura sağlayıcıda varsa geri alma; yeniden göndermek aynı faturayı ikinci kez keser.</Text>
        <Input value={releaseNote} onChangeText={setReleaseNote} placeholder="Ör. Sağlayıcı panelinde bu numara yok" />
        <View style={st.modalActions}><Button label="Vazgeç" variant="outline" onPress={() => setReleaseOpen(false)} /><Button label="Kuyruğa al" onPress={release} loading={busy} disabled={releaseNote.trim().length < 5} /></View>
      </View></View>
    </Modal>
  </View>;
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, list: { padding: 16, gap: 12 },
  card: { borderRadius: 16, padding: 14, gap: 9 }, head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, number: { flex: 1, fontSize: 17, fontFamily: fonts.bold },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular }, error: { fontSize: 13, lineHeight: 19, fontFamily: fonts.semibold }, line: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: t.divider },
  modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modal: { width: '100%', maxWidth: 460, borderRadius: 18, padding: 20, gap: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1 }, lineName: { fontSize: 14, fontFamily: fonts.semibold }, lineAmount: { fontSize: 14, fontFamily: fonts.bold }, company: { fontSize: 15, fontFamily: fonts.bold, marginTop: 6 },
});

