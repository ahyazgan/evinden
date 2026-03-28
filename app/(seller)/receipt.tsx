import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// Demo order data (would come from route params or context in production)
const DEMO_RECEIPT = {
  orderId: 'EVD-20260328-001',
  date: '28 Mart 2026, 14:32',
  customer: 'Ahmet Bey',
  phone: '0532 *** ** 45',
  address: 'Moda Cad. 42, Kadıköy',
  seller: "Ayşe'nin Ev Yemekleri",
  items: [
    { name: 'Kuru Fasulye + Pilav', qty: 1, price: 8000 },
    { name: 'Mercimek Çorbası', qty: 2, price: 4500 },
    { name: 'Karışık Salata', qty: 1, price: 3500 },
  ],
  subtotal: 20500,
  deliveryFee: 1500,
  discount: 0,
  total: 22000,
  paymentMethod: 'Nakit',
  note: 'Acı olmasın lütfen',
};

export default function ReceiptScreen() {
  const router = useRouter();
  const r = DEMO_RECEIPT;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.backIcon}>‹</Text>
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
                <Text style={st.noteLabel}>📝 Not:</Text>
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
            <Text style={st.printBtnText}>🖨️ Yazdır</Text>
          </Pressable>
          <Pressable style={st.shareBtn}>
            <Text style={st.shareBtnText}>📤 Paylaş</Text>
          </Pressable>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDE8E2',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  scroll: { padding: 16 },

  receipt: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  receiptHeader: { alignItems: 'center', marginBottom: 16, gap: 4 },
  receiptLogo: { fontSize: 40 },
  receiptSellerName: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  receiptSub: { fontSize: 12, color: '#8A7E72', fontWeight: '600' },

  dottedLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
    borderStyle: 'dashed',
    marginVertical: 14,
  },

  infoSection: { gap: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: '#8A7E72', fontWeight: '600' },
  infoValue: { fontSize: 13, fontWeight: '700', color: '#1A1208' },

  itemsSection: { gap: 8 },
  itemsHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0ECE6', paddingBottom: 6 },
  itemsHeaderText: { fontSize: 11, fontWeight: '700', color: '#8A7E72', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  itemName: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  itemQty: { fontSize: 13, color: '#6B5E50' },
  itemPrice: { fontSize: 13, fontWeight: '700', color: '#1A1208' },

  totalsSection: { gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, color: '#8A7E72' },
  totalValue: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EDE8E2',
  },
  grandTotalLabel: { fontSize: 15, fontWeight: '800', color: '#1A1208' },
  grandTotalValue: { fontSize: 18, fontWeight: '900', color: colors.primary },

  footerSection: { gap: 10 },
  noteBox: { backgroundColor: '#FFF8E1', borderRadius: 10, padding: 10, gap: 4 },
  noteLabel: { fontSize: 11, fontWeight: '700', color: '#F57F17' },
  noteText: { fontSize: 13, color: '#6B5E50' },

  thanksText: { textAlign: 'center', fontSize: 13, color: '#8A7E72', marginTop: 12 },
  brandText: { textAlign: 'center', fontSize: 18, fontWeight: '900', color: colors.primary, marginTop: 4 },

  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  printBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1A1208', alignItems: 'center' },
  printBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  shareBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#EDE8E2' },
  shareBtnText: { color: '#1A1208', fontSize: 14, fontWeight: '700' },
});
