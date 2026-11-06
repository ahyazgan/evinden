import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import {
  closedMonths, generateCommissionInvoices, listCommissionInvoices, markCommissionInvoiced, monthLabel, type CommissionInvoice,
} from '@/lib/invoicing';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const MONTHS = closedMonths(3);

export default function AdminCommissionInvoicesScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [month, setMonth] = useState(MONTHS[0]);
  const [rows, setRows] = useState<CommissionInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<CommissionInvoice | null>(null);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listCommissionInvoices(month)); setLoadError(null); }
    catch (e: any) { setLoadError(e?.message ?? 'Liste alınamadı.'); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await generateCommissionInvoices(month); await load();
      Alert.alert('Döküm hazır', `${r.drafts} taslak, ${r.issued} kesilmiş fatura.`);
    } catch (e: any) { Alert.alert('Döküm oluşturulamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setGenerating(false); }
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try { await markCommissionInvoiced(editing.id, number.trim(), note.trim() || undefined); setEditing(null); await load(); }
    catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(false); }
  };

  const drafts = rows.filter(r => r.status === 'draft');
  const total = rows.reduce((sum, r) => sum + r.total_cents, 0);

  return (
    <View style={st.safe}>
      <TopBar title="Komisyon faturaları" subtitle="Restoranlara aylık hizmet faturası" back />
      <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
        <Text style={st.sub}>
          Ay kapanınca dökümü oluştur: her restoranın o ay teslim edilip iade edilmemiş siparişlerinin komisyonu ve üstüne KDV.
          Faturayı muhasebe/e-fatura sisteminden kes, numarasını burada işaretle; restoran panelinde görür. Kesilmiş ayda sonradan iade
          edilen siparişin komisyonu sonraki ayın dökümünden düşer.
        </Text>
        <SegmentedControl options={MONTHS.map(m => ({ value: m, label: monthLabel(m) }))} value={month} onChange={setMonth} />
        <Button label={rows.length ? 'Dökümü yeniden hesapla' : 'Dökümü oluştur'} onPress={generate} loading={generating} fullWidth />
        {loadError ? <Text accessibilityLiveRegion="polite" style={st.error}>{loadError}</Text> : null}
        {loading ? <View style={st.center}><LogoLoader /></View> : <>
          <View style={st.metrics}>
            <MetricCard label="Kesilecek" value={String(drafts.length)} icon="document-text-outline" variant={drafts.length ? 'warning' : 'accent'} />
            <MetricCard label="KDV dahil toplam" value={moneyTL(total)} icon="cash-outline" />
          </View>
          <SectionHeader title={monthLabel(month)} subtitle="Restoran bazında" />
          {rows.length === 0 ? <EmptyState title="Bu ay için döküm yok" description="Dökümü oluşturunca restoranlar burada listelenir." icon="receipt-outline" /> : rows.map(r => (
            <View key={r.id} style={[st.card, { backgroundColor: t.surface }]}>
              <View style={st.head}>
                <Text style={st.title}>{r.seller_name}</Text>
                <StatusPill label={r.status === 'issued' ? 'Kesildi' : r.status === 'cancelled' ? 'İptal' : 'Taslak'} variant={r.status === 'issued' ? 'success' : r.status === 'cancelled' ? 'muted' : 'amber'} />
              </View>
              <Text selectable style={st.sub}>{r.legal_title ?? 'Şirket bilgisi eksik'} · {r.tax_number ?? 'VKN yok'}</Text>
              <Text style={st.sub}>{r.order_count} sipariş · Komisyon {moneyTL(r.commission_cents)} + KDV %{(r.tax_rate_bps / 100).toFixed(0)} {moneyTL(r.tax_cents)}</Text>
              <Text style={st.amount}>Toplam {moneyTL(r.total_cents)}</Text>
              {r.commission_cents <= 0 && r.status === 'draft' ? <Text style={st.error}>Bu ay iadeler komisyonu aştı; fatura yerine iade faturası gerekir. Mali müşavire danış.</Text> : null}
              {r.invoice_number ? <Text style={st.sub}>Fatura no: {r.invoice_number}</Text> : null}
              {r.status === 'draft' && r.commission_cents > 0 ? <Button label="Kestim, numarayı gir" size="sm" onPress={() => { setEditing(r); setNumber(''); setNote(''); }} /> : null}
            </View>
          ))}
        </>}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={st.modalBack}><View style={[st.modal, { backgroundColor: t.surface }]}>
          <Text accessibilityRole="header" style={st.modalTitle}>{editing?.seller_name}</Text>
          <Text style={st.sub}>{editing ? `${monthLabel(editing.period_month)} · ${moneyTL(editing.total_cents)}` : ''}</Text>
          <Input label="Fatura numarası" value={number} onChangeText={setNumber} placeholder="Ör. AFY2026000000012" autoCapitalize="characters" />
          <Input label="Not (isteğe bağlı)" value={note} onChangeText={setNote} />
          <View style={st.actions}>
            <Button label="Vazgeç" variant="outline" onPress={() => setEditing(null)} />
            <Button label="Kaydet" onPress={save} loading={busy} disabled={number.trim().length < 3} />
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { paddingVertical: 32, alignItems: 'center' },
  list: { padding: 16, gap: 10 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  amount: { fontFamily: fonts.bold, fontSize: 14, color: t.text },
  error: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: t.danger },
  modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 460, borderRadius: 18, padding: 20, gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: fonts.bold, color: t.heading },
});
