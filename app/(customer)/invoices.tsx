import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LogoLoader } from '@/components/shared/Logo';
import { StatusPill } from '@/components/ui/Enterprise';
import { enterpriseStatus, INVOICE_STATUS } from '@/lib/enterprise-status';
import { fetchBillingProfile, fetchMyInvoices, requestInvoice, saveBillingProfile, type BillingProfile, type InvoiceRow } from '@/lib/enterprise';
import { supabase } from '@/lib/supabase';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const money = (cents: number) => `₺${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
type DeliveredOrder = { id: string; total_cents: number; created_at: string; seller_id: string };

export default function CustomerInvoicesScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [orders, setOrders] = useState<DeliveredOrder[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ legal_title: '', tax_office: '', tax_number: '', address: '', email: '', phone: '' });

  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user.id;
      if (!uid) return;
      const [p, myInvoices, orderRows] = await Promise.all([
        fetchBillingProfile(), fetchMyInvoices(),
        supabase.from('orders').select('id, total_cents, created_at, seller_id')
          .eq('customer_id', uid).eq('status', 'delivered')
          .not('refund_status', 'in', '(requested,approved)')
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (orderRows.error) throw orderRows.error;
      setProfile(p);
      if (p) setForm({ legal_title: p.legal_title, tax_office: p.tax_office, tax_number: p.tax_number, address: p.address, email: p.email, phone: p.phone ?? '' });
      setInvoices(myInvoices);
      setOrders((orderRows.data ?? []) as DeliveredOrder[]);
    } catch (e: any) { Alert.alert('Veriler alınamadı', 'İnternet bağlantını kontrol edip tekrar dene.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await saveBillingProfile({ ...form, phone: form.phone || null, is_default: true });
      await load(); Alert.alert('Kaydedildi', 'Kurumsal fatura bilgilerin güncellendi.');
    } catch (e: any) { Alert.alert('Kaydedilemedi', e?.message); }
    finally { setSaving(false); }
  };
  const request = async (orderId: string) => {
    try { await requestInvoice(orderId); await load(); Alert.alert('Talep alındı', 'Faturan kontrol edilip e-fatura olarak kesilecek.'); }
    catch (e: any) { Alert.alert('Talep oluşturulamadı', e?.message); }
  };
  const invoicedOrders = new Set(invoices.map(row => row.order_id));

  return (
    <View style={st.safe}>
      <TopBar title="Kurumsal fatura" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : <ScrollView contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
        <Text style={st.sectionTitle}>Fatura profili</Text>
        <View style={[st.card, { backgroundColor: t.surface }]}>
          <Input label="Şirket unvanı" value={form.legal_title} onChangeText={v => setForm({ ...form, legal_title: v })} />
          <Input label="Vergi dairesi" value={form.tax_office} onChangeText={v => setForm({ ...form, tax_office: v })} />
          <Input label="Vergi numarası" value={form.tax_number} onChangeText={v => setForm({ ...form, tax_number: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={11} />
          <Input label="Fatura adresi" value={form.address} onChangeText={v => setForm({ ...form, address: v })} multiline />
          <Input label="Fatura e-postası" value={form.email} onChangeText={v => setForm({ ...form, email: v })} keyboardType="email-address" autoCapitalize="none" />
          <Input label="Telefon (isteğe bağlı)" value={form.phone} onChangeText={v => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
          <Button label="Profili kaydet" onPress={save} loading={saving} fullWidth />
        </View>
        <Text style={st.sectionTitle}>Fatura talepleri</Text>
        {orders.filter(order => !invoicedOrders.has(order.id)).map(order => (
          <View key={order.id} style={[st.card, { backgroundColor: t.surface }]}>
            <Text style={st.title}>#{order.id.slice(0, 8)} · {money(order.total_cents)}</Text>
            <Text style={st.sub}>{new Date(order.created_at).toLocaleDateString('tr-TR')}</Text>
            <Button label="Fatura talep et" size="sm" disabled={!profile} onPress={() => request(order.id)} />
          </View>
        ))}
        {invoices.map(row => {
          const status = enterpriseStatus(INVOICE_STATUS, row.status);
          return <View key={row.id} style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.invoiceHead}><Text style={st.title}>{row.invoice_number}</Text><StatusPill label={status.label} variant={status.variant} /></View>
            <Text style={st.sub}>{money(row.total_cents)} · {new Date(row.created_at).toLocaleDateString('tr-TR')}</Text>
            <Text style={st.statusHint}>{row.status === 'accepted' ? 'Faturan kesildi.' : row.status === 'rejected' ? 'Fatura kesilemedi. Destek ekibimiz inceliyor.' : row.status === 'submitted' || row.status === 'sending' ? 'Faturan gönderildi, onay bekliyor.' : 'Faturan kontrol edilmek üzere hazırlanıyor.'}</Text>
          </View>;
        })}
        <View style={{ height: 32 }} />
      </ScrollView>}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 }, sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: t.heading, marginTop: 4 },
  card: { borderRadius: 16, padding: 14, gap: 8 }, title: { fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, color: t.textSecondary }, error: { fontFamily: fonts.regular, fontSize: 12, color: t.danger },
  invoiceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, statusHint: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
});
