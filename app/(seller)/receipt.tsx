import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrders } from '@/lib/db';
import { fonts } from '@/lib/fonts';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

type ReceiptData = {
  orderId: string;
  date: string;
  customer: string;
  phone: string;
  address: string;
  seller: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  note: string;
};

const EMPTY_RECEIPT: ReceiptData = {
  orderId: '-',
  date: '-',
  customer: '-',
  phone: '-',
  address: '-',
  seller: '-',
  items: [],
  subtotal: 0,
  deliveryFee: 0,
  discount: 0,
  total: 0,
  paymentMethod: '-',
  note: '',
};

const PAYMENT_LABELS: Record<string, string> = { cash: 'Nakit', card_door: 'Kapıda kart', online: 'Online ödeme' };

export default function ReceiptScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [r, setR] = useState<ReceiptData>(EMPTY_RECEIPT);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (!seller) return;
        const orders = await fetchSellerOrders(seller.id);
        const latest = orders[0];
        if (!latest) return;
        const d = new Date(latest.created_at);
        setR({
          orderId: latest.id.slice(0, 12).toUpperCase(),
          date: d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
          customer: latest.customer_id ? latest.customer_id.slice(0, 8) + '...' : 'Silinmiş kullanıcı',
          phone: '-',
          address: latest.delivery_address ?? '-',
          seller: seller.display_name,
          items: latest.order_items.map(i => ({ name: i.title_snapshot, qty: i.quantity, price: i.unit_price_cents })),
          subtotal: latest.subtotal_cents,
          deliveryFee: latest.delivery_fee_cents,
          discount: latest.discount_cents ?? 0,
          total: latest.total_cents,
          paymentMethod: PAYMENT_LABELS[latest.payment_method ?? 'cash'] ?? 'Nakit',
          note: latest.notes ?? '',
        });
      } catch {}
    })();
  }, [profile?.id]);

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <Text style={st.headerTitle}>Sipariş Fişi</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <View style={st.receipt}>
          {/* Logo */}
          <View style={st.receiptHeader}>
            <Text style={st.receiptLogo}>🍲</Text>
            <Text style={st.receiptSellerName}>{r.seller}</Text>
            <Text style={st.receiptSub}>Sipariş Fişi</Text>
          </View>

          <View style={st.dottedLine} />

          {/* Order info */}
          <View style={st.infoSection}>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Sipariş No</Text>
              <Text style={st.infoValue}>{r.orderId}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Tarih</Text>
              <Text style={st.infoValue}>{r.date}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Müşteri</Text>
              <Text style={st.infoValue}>{r.customer}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Telefon</Text>
              <Text style={st.infoValue}>{r.phone}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Adres</Text>
              <Text style={[st.infoValue, { maxWidth: '55%', textAlign: 'right' }]}>{r.address}</Text>
            </View>
          </View>

          <View style={st.dottedLine} />

          {/* Items */}
          <View style={st.itemsSection}>
            <View style={st.itemsHeader}>
              <Text style={[st.itemsHeaderText, { flex: 1 }]}>Ürün</Text>
              <Text style={[st.itemsHeaderText, { width: 30, textAlign: 'center' }]}>Ad.</Text>
              <Text style={[st.itemsHeaderText, { width: 70, textAlign: 'right' }]}>Tutar</Text>
            </View>
            {r.items.map((item, i) => (
              <View key={i} style={st.itemRow}>
                <Text style={[st.itemName, { flex: 1 }]}>{item.name}</Text>
                <Text style={[st.itemQty, { width: 30, textAlign: 'center' }]}>{item.qty}</Text>
                <Text style={[st.itemPrice, { width: 70, textAlign: 'right' }]}>{priceTL(item.price * item.qty)}</Text>
              </View>
            ))}
          </View>

          <View style={st.dottedLine} />

          {/* Totals */}
          <View style={st.totalsSection}>
            <View style={st.totalRow}>
              <Text style={st.totalLabel}>Ara Toplam</Text>
              <Text style={st.totalValue}>{priceTL(r.subtotal)}</Text>
            </View>
            <View style={st.totalRow}>
              <Text style={st.totalLabel}>Teslimat</Text>
              <Text style={st.totalValue}>{r.deliveryFee === 0 ? 'Ücretsiz' : priceTL(r.deliveryFee)}</Text>
            </View>
            {r.discount > 0 && (
              <View style={st.totalRow}>
                <Text style={[st.totalLabel, { color: '#2E7D32' }]}>İndirim</Text>
                <Text style={[st.totalValue, { color: '#2E7D32' }]}>-{priceTL(r.discount)}</Text>
              </View>
            )}
            <View style={st.grandTotalRow}>
              <Text style={st.grandTotalLabel}>TOPLAM</Text>
              <Text style={st.grandTotalValue}>{priceTL(r.total)}</Text>
            </View>
          </View>

          <View style={st.dottedLine} />

          {/* Payment & Note */}
          <View style={st.footerSection}>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Ödeme</Text>
              <Text style={st.infoValue}>{r.paymentMethod}</Text>
            </View>
            {r.note ? (
              <View style={st.noteBox}>
                <Text style={st.noteLabel}>Not:</Text>
                <Text style={st.noteText}>{r.note}</Text>
              </View>
            ) : null}
          </View>

          <View style={st.dottedLine} />

          <Text style={st.thanksText}>Bizi tercih ettiğiniz için teşekkürler!</Text>
          <Text style={st.brandText}>evinden</Text>
        </View>

        {/* Actions */}
        <View style={st.actions}>
          <Pressable style={st.printBtn}>
            <Text style={st.printBtnText}>Yazdır</Text>
          </Pressable>
          <Pressable style={st.shareBtn}>
            <Text style={st.shareBtnText}>Paylaş</Text>
          </Pressable>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  scroll: { padding: 16 },

  receipt: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  receiptHeader: { alignItems: 'center', marginBottom: 16, gap: 4 },
  receiptLogo: { fontFamily: fonts.regular, fontSize: 40 },
  receiptSellerName: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  receiptSub: { fontSize: 12, color: '#6B766F', fontFamily: fonts.semibold },

  dottedLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
    borderStyle: 'dashed',
    marginVertical: 14,
  },

  infoSection: { gap: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#6B766F', fontFamily: fonts.semibold },
  infoValue: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16' },

  itemsSection: { gap: 8 },
  itemsHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EDEFE8', paddingBottom: 6 },
  itemsHeaderText: { fontSize: 11, fontFamily: fonts.bold, color: '#6B766F', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  itemName: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  itemQty: { fontFamily: fonts.regular, fontSize: 13, color: '#56605A' },
  itemPrice: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16' },

  totalsSection: { gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
  totalValue: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E3E6DE',
  },
  grandTotalLabel: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16' },
  grandTotalValue: { fontSize: 18, fontFamily: fonts.display, color: colors.primary },

  footerSection: { gap: 10 },
  noteBox: { backgroundColor: '#FFF8E1', borderRadius: 10, padding: 10, gap: 4 },
  noteLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#F57F17' },
  noteText: { fontFamily: fonts.regular, fontSize: 13, color: '#56605A' },

  thanksText: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', marginTop: 12 },
  brandText: { textAlign: 'center', fontSize: 18, fontFamily: fonts.display, color: colors.primary, marginTop: 4 },

  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  printBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#17402F', alignItems: 'center' },
  printBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },
  shareBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#E3E6DE' },
  shareBtnText: { color: '#151A16', fontSize: 14, fontFamily: fonts.bold },
});
