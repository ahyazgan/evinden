import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LogoLoader } from '@/components/shared/Logo';
import { StatusPill } from '@/components/ui/Enterprise';
import { fetchBillingProfile, saveBillingProfile, type BillingProfile } from '@/lib/enterprise';
import {
  fetchMyInvoiceRequests, ORDER_INVOICE_STATUS, orderInvoiceUrl, requestOrderInvoice, type OrderInvoiceRequest,
} from '@/lib/invoicing';
import { supabase } from '@/lib/supabase';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const money = (cents: number) => `₺${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const DAY = 24 * 60 * 60 * 1000;
type EligibleOrder = { id: string; total_cents: number; created_at: string; status: string; delivered_at: string | null; seller_name: string };

const STATUS_HINT: Record<OrderInvoiceRequest['status'], string> = {
  requested: 'Restoran faturanı kendi sistemi üzerinden kesecek; kesince numarası burada görünür.',
  issued: 'Faturan restoran tarafından kesildi.',
  correction_required: 'Sipariş iade edildi; restoran faturayı iptal edecek veya iade faturası isteyecek.',
  corrected: 'Fatura iade sonrası düzeltildi.',
  cancelled: 'Sipariş iptal edildiği için fatura kesilmedi.',
};

export default function CustomerInvoicesScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [orders, setOrders] = useState<EligibleOrder[]>([]);
  const [requests, setRequests] = useState<OrderInvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ legal_title: '', tax_office: '', tax_number: '', address: '', email: '', phone: '' });

  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user.id;
      if (!uid) return;
      const [p, myRequests, orderRows] = await Promise.all([
        fetchBillingProfile(),
        fetchMyInvoiceRequests(uid),
        supabase.from('orders').select('id, total_cents, created_at, status, delivered_at, sellers(display_name)')
          .eq('customer_id', uid).neq('status', 'cancelled').neq('status', 'awaiting_payment')
          .or('refund_status.is.null,refund_status.not.in.(requested,approved)')
          .gte('created_at', new Date(Date.now() - 35 * DAY).toISOString())
          .order('created_at', { ascending: false }).limit(50),
      ]);
      if (orderRows.error) throw orderRows.error;
      setProfile(p);
      if (p) setForm({ legal_title: p.legal_title, tax_office: p.tax_office, tax_number: p.tax_number, address: p.address, email: p.email, phone: p.phone ?? '' });
      setRequests(myRequests);
      setOrders((orderRows.data ?? []).map((o: any) => ({
        id: o.id, total_cents: o.total_cents, created_at: o.created_at, status: o.status, delivered_at: o.delivered_at,
        seller_name: o.sellers?.display_name ?? 'Restoran',
      })).filter(o => o.status !== 'delivered' || !o.delivered_at || Date.now() - new Date(o.delivered_at).getTime() < 30 * DAY));
    } catch { Alert.alert('Veriler alınamadı', 'İnternet bağlantını kontrol edip tekrar dene.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await saveBillingProfile({ ...form, phone: form.phone || null, is_default: true });
      await load(); Alert.alert('Kaydedildi', 'Kurumsal fatura bilgilerin güncellendi.');
    } catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Bilgileri kontrol edip tekrar dene.'); }
    finally { setSaving(false); }
  };
  const request = async (orderId: string) => {
    setBusy(orderId);
    try { await requestOrderInvoice(orderId); await load(); Alert.alert('Talep restorana iletildi', 'Restoran faturanı kesince numarası burada görünür.'); }
    catch (e: any) { Alert.alert('Talep oluşturulamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(null); }
  };
  const openDocument = async (path: string) => {
    try { await Linking.openURL(await orderInvoiceUrl(path)); }
    catch { Alert.alert('Belge açılamadı', 'Lütfen tekrar dene.'); }
  };
  const requested = new Set(requests.map(r => r.order_id));
  const eligible = orders.filter(o => !requested.has(o.id));

  return (
    <View style={st.safe}>
      <TopBar title="Kurumsal fatura" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : <ScrollView contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
        <Text style={st.lead}>Faturayı siparişi hazırlayan restoran kendi adına keser. Bilgilerini bir kez kaydet; sipariş verirken veya teslimden sonraki 30 gün içinde fatura isteyebilirsin.</Text>
        <Text style={st.sectionTitle}>Fatura bilgilerin</Text>
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <Input label="Şirket unvanı" value={form.legal_title} onChangeText={v => setForm({ ...form, legal_title: v })} />
          <Input label="Vergi dairesi" value={form.tax_office} onChangeText={v => setForm({ ...form, tax_office: v })} />
          <Input label="Vergi numarası (VKN veya TCKN)" value={form.tax_number} onChangeText={v => setForm({ ...form, tax_number: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={11} />
          <Input label="Fatura adresi" value={form.address} onChangeText={v => setForm({ ...form, address: v })} multiline />
          <Input label="Fatura e-postası" value={form.email} onChangeText={v => setForm({ ...form, email: v })} keyboardType="email-address" autoCapitalize="none" />
          <Input label="Telefon (isteğe bağlı)" value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
          <Button label="Bilgileri kaydet" onPress={save} loading={saving} fullWidth />
        </View>

        {requests.length ? <Text style={st.sectionTitle}>Faturaların</Text> : null}
        {requests.map(row => {
          const status = ORDER_INVOICE_STATUS[row.status];
          return <View key={row.order_id} style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.head}><Text style={st.title}>Sipariş #{row.order_id.slice(0, 8)}</Text><StatusPill label={status.label} variant={status.variant} /></View>
            {row.invoice_number ? <Text style={st.sub}>Fatura no: {row.invoice_number}</Text> : null}
            <Text style={st.hint}>{STATUS_HINT[row.status]}</Text>
            {row.document_path ? <Button label="Faturayı aç" variant="outline" size="sm" onPress={() => openDocument(row.document_path!)} /> : null}
          </View>;
        })}

        <Text style={st.sectionTitle}>Fatura istenebilecek siparişler</Text>
        {eligible.length === 0 ? <Text style={st.sub}>Son 30 günde fatura istenebilecek siparişin yok.</Text> : eligible.map(order => (
          <View key={order.id} style={[st.card, { backgroundColor: t.surface }]}>
            <Text style={st.title}>{order.seller_name} · {money(order.total_cents)}</Text>
            <Text style={st.sub}>#{order.id.slice(0, 8)} · {new Date(order.created_at).toLocaleDateString('tr-TR')}</Text>
            <Button label="Fatura iste" size="sm" disabled={!profile} loading={busy === order.id} onPress={() => request(order.id)} />
          </View>
        ))}
        {!profile ? <Text style={st.hint}>Fatura isteyebilmek için önce yukarıdaki bilgileri kaydet.</Text> : null}
        <View style={{ height: 32 }} />
      </ScrollView>}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 }, sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: t.heading, marginTop: 4 },
  lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: t.textSecondary },
  card: { borderRadius: 16, padding: 14, gap: 8 }, title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: t.textSecondary }, hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.textSecondary },
});
