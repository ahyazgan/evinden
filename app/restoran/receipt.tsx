import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Logo, LogoMark } from '@/components/shared/Logo';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId, fetchSellerOrders } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { paymentLabel } from '@/lib/order-options';
import { plannedLabel } from '@/lib/schedule-slots';
import { useTheme } from '@/lib/theme-context';

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
  tip: number;
  total: number;
  paymentMethod: string;
  note: string;
  pickup: boolean;
  planned: string | null;
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
  tip: 0,
  total: 0,
  paymentMethod: '-',
  note: '',
  pickup: false,
  planned: null,
};

export default function ReceiptScreen() {
  const { colors: t } = useTheme();
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
          tip: latest.tip_cents ?? 0,
          total: latest.total_cents,
          paymentMethod: paymentLabel(latest.payment_method, latest.fulfillment),
          note: latest.notes ?? '',
          pickup: latest.fulfillment === 'pickup',
          planned: latest.scheduled_for ? plannedLabel(latest.scheduled_for) : null,
        });
      } catch {}
    })();
  }, [profile?.id]);

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar title="Sipariş fişi" back />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <View style={[st.receipt, { backgroundColor: t.surface }]}>
          {/* Logo */}
          <View style={st.receiptHeader}>
            <LogoMark size={40} />
            <Text style={[st.receiptSellerName, { color: t.text }]}>{r.seller}</Text>
            <Text style={[st.receiptSub, { color: t.textSecondary }]}>Sipariş fişi</Text>
          </View>

          <View style={[st.dottedLine, { borderBottomColor: t.divider }]} />

          {/* Order info */}
          <View style={st.infoSection}>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Sipariş no</Text>
              <Text style={[st.infoValue, { color: t.text }]}>{r.orderId}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Tarih</Text>
              <Text style={[st.infoValue, { color: t.text }]}>{r.date}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Müşteri</Text>
              <Text style={[st.infoValue, { color: t.text }]}>{r.customer}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Telefon</Text>
              <Text style={[st.infoValue, { color: t.text }]}>{r.phone}</Text>
            </View>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Adres</Text>
              <Text style={[st.infoValue, st.infoValueWrap, { color: t.text }]}>{r.address}</Text>
            </View>
            {r.planned ? (
              <View style={st.infoRow}>
                <Text style={[st.infoLabel, { color: t.textSecondary }]}>Zaman</Text>
                <Text style={[st.infoValue, { color: t.text }]}>{r.planned}</Text>
              </View>
            ) : null}
          </View>

          <View style={[st.dottedLine, { borderBottomColor: t.divider }]} />

          {/* Items */}
          <View style={st.itemsSection}>
            <View style={[st.itemsHeader, { borderBottomColor: t.divider }]}>
              <Text style={[st.itemsHeaderText, st.colName, { color: t.textSecondary }]}>Ürün</Text>
              <Text style={[st.itemsHeaderText, st.colQty, { color: t.textSecondary }]}>Ad.</Text>
              <Text style={[st.itemsHeaderText, st.colPrice, { color: t.textSecondary }]}>Tutar</Text>
            </View>
            {r.items.map((item, i) => (
              <View key={i} style={st.itemRow}>
                <Text style={[st.itemName, st.colName, { color: t.text }]}>{item.name}</Text>
                <Text style={[st.itemQty, st.colQty, { color: t.textSecondary }]}>{item.qty}</Text>
                <Text style={[st.itemPrice, st.colPrice, { color: t.text }]}>{priceTL(item.price * item.qty)}</Text>
              </View>
            ))}
          </View>

          <View style={[st.dottedLine, { borderBottomColor: t.divider }]} />

          {/* Totals */}
          <View style={st.totalsSection}>
            <View style={st.totalRow}>
              <Text style={[st.totalLabel, { color: t.textSecondary }]}>Ara toplam</Text>
              <Text style={[st.totalValue, { color: t.text }]}>{priceTL(r.subtotal)}</Text>
            </View>
            <View style={st.totalRow}>
              <Text style={[st.totalLabel, { color: t.textSecondary }]}>{r.pickup ? 'Teslim' : 'Teslimat'}</Text>
              <Text style={[st.totalValue, { color: t.text }]}>{r.pickup ? 'Gelip alacak' : r.deliveryFee === 0 ? 'Ücretsiz' : priceTL(r.deliveryFee)}</Text>
            </View>
            {r.discount > 0 && (
              <View style={st.totalRow}>
                <Text style={[st.totalLabel, { color: t.success }]}>İndirim</Text>
                <Text style={[st.totalValue, { color: t.success }]}>-{priceTL(r.discount)}</Text>
              </View>
            )}
            {r.tip > 0 && (
              <View style={st.totalRow}>
                <Text style={[st.totalLabel, { color: t.textSecondary }]}>Bahşiş</Text>
                <Text style={[st.totalValue, { color: t.text }]}>{priceTL(r.tip)}</Text>
              </View>
            )}
            <View style={[st.grandTotalRow, { borderTopColor: t.divider }]}>
              <Text style={[st.grandTotalLabel, { color: t.text }]}>TOPLAM</Text>
              <Text style={[st.grandTotalValue, { color: t.text }]}>{priceTL(r.total)}</Text>
            </View>
          </View>

          <View style={[st.dottedLine, { borderBottomColor: t.divider }]} />

          {/* Payment & Note */}
          <View style={st.footerSection}>
            <View style={st.infoRow}>
              <Text style={[st.infoLabel, { color: t.textSecondary }]}>Ödeme</Text>
              <Text style={[st.infoValue, { color: t.text }]}>{r.paymentMethod}</Text>
            </View>
            {r.note ? (
              <View style={[st.noteBox, { backgroundColor: t.background }]}>
                <Text style={[st.noteLabel, { color: t.text }]}>Not:</Text>
                <Text style={[st.noteText, { color: t.textSecondary }]}>{r.note}</Text>
              </View>
            ) : null}
          </View>

          <View style={[st.dottedLine, { borderBottomColor: t.divider }]} />

          <Text style={[st.thanksText, { color: t.textSecondary }]}>Bizi tercih ettiğin için teşekkürler!</Text>
          <View style={st.brand}>
            <Logo size={20} inline />
          </View>
        </View>

        {/* Actions */}
        <View style={st.actions}>
          {Platform.OS === 'web' ? (
            <View style={st.flex}>
              <Button label="Yazdır" fullWidth onPress={() => window.print()} />
            </View>
          ) : null}
          <View style={st.flex}>
            <Button
              label="Paylaş"
              variant="outline"
              fullWidth
              onPress={() => {
                const lines = r.items.map(i => `${i.qty}x ${i.name} ${priceTL(i.price)}`);
                Share.share({ message: [r.seller, `Sipariş ${r.orderId}`, r.date, ...(r.planned ? [r.planned] : []), ...lines, ...(r.tip > 0 ? [`Bahşiş ${priceTL(r.tip)}`] : []), `Toplam ${priceTL(r.total)}`].join('\n') }).catch(() => {});
              }}
            />
          </View>
        </View>

        <View style={st.bottomSpace} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  bottomSpace: { height: 20 },
  scroll: { padding: 16 },

  receipt: { borderRadius: 16, padding: 14 },
  receiptHeader: { alignItems: 'center', marginBottom: 2, gap: 4 },
  receiptSellerName: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display },
  receiptSub: { fontSize: 12, fontFamily: fonts.semibold },

  dottedLine: { borderBottomWidth: 1, borderStyle: 'dashed', marginVertical: 14 },

  infoSection: { gap: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  infoLabel: { fontSize: 12, fontFamily: fonts.semibold },
  infoValue: { flexShrink: 1, fontSize: 13, fontFamily: fonts.bold, textAlign: 'right' },
  infoValueWrap: { maxWidth: '70%' },

  itemsSection: { gap: 8 },
  itemsHeader: { flexDirection: 'row', borderBottomWidth: 1, paddingBottom: 6 },
  itemsHeaderText: { fontSize: 12, fontFamily: fonts.bold },
  colName: { flex: 1 },
  colQty: { width: 30, textAlign: 'center' },
  colPrice: { width: 76, textAlign: 'right' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  itemName: { fontSize: 13, fontFamily: fonts.semibold },
  itemQty: { fontSize: 13, fontFamily: fonts.regular },
  itemPrice: { fontSize: 13, fontFamily: fonts.bold },

  totalsSection: { gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, fontFamily: fonts.regular },
  totalValue: { fontSize: 13, fontFamily: fonts.semibold },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 1 },
  grandTotalLabel: { fontSize: 15, fontFamily: fonts.extrabold },
  grandTotalValue: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display },

  footerSection: { gap: 10 },
  noteBox: { borderRadius: 12, padding: 10, gap: 4 },
  noteLabel: { fontSize: 12, fontFamily: fonts.bold },
  noteText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },

  thanksText: { textAlign: 'center', fontSize: 13, fontFamily: fonts.regular },
  brand: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
