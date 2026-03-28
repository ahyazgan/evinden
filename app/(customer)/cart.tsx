import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { supabase } from '@/lib/supabase';

const DELIVERY_FEE = 0; // ücretsiz teslimat

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function CartScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const { sellerId, items, totalCents, incrementItem, decrementItem, clearCart } = useCart();

  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const placeOrder = async () => {
    if (!profile || !sellerId) return;
    if (items.length === 0) return;
    if (!address.trim()) {
      Alert.alert('Adres gerekli', 'Lütfen teslimat adresinizi girin.');
      return;
    }

    setLoading(true);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: profile.id,
        seller_id: sellerId,
        status: 'pending',
        subtotal_cents: totalCents,
        delivery_fee_cents: DELIVERY_FEE,
        total_cents: totalCents + DELIVERY_FEE,
        currency: 'TRY',
        delivery_address: address.trim(),
        notes: notes.trim() || null,
      })
      .select()
      .single();

    if (orderError || !order) {
      setLoading(false);
      Alert.alert('Hata', 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.');
      return;
    }

    const orderItems = items.map(item => ({
      order_id: order.id,
      menu_item_id: item.menuItemId,
      title_snapshot: item.title,
      unit_price_cents: item.priceCents,
      quantity: item.quantity,
      line_total_cents: item.priceCents * item.quantity,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    setLoading(false);

    if (itemsError) {
      Alert.alert('Hata', 'Sipariş kalemleri kaydedilemedi. Lütfen tekrar deneyin.');
      return;
    }

    clearCart();
    Alert.alert(
      'Sipariş Alındı! 🎉',
      'Siparişiniz satıcıya iletildi. Durumu siparişler sekmesinden takip edebilirsiniz.',
      [{ text: 'Tamam', onPress: () => router.replace('/(customer)/orders') }],
    );
  };

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sepet</Text>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <Text style={styles.emptyTitle}>Sepetiniz boş</Text>
          <Text style={styles.emptyBody}>
            Bir satıcı profiline gidip ürün ekleyerek başlayın.
          </Text>
          <Pressable
            style={styles.browseBtn}
            onPress={() => router.push('/(customer)')}
          >
            <Text style={styles.browseBtnText}>Satıcılara Göz At</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sepet</Text>
        <Pressable onPress={() => Alert.alert('Sepeti Temizle', 'Tüm ürünler silinecek.', [
          { text: 'İptal', style: 'cancel' },
          { text: 'Temizle', style: 'destructive', onPress: clearCart },
        ])}>
          <Text style={styles.clearText}>Temizle</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Ürünler */}
          <View style={styles.section}>
            {items.map(item => (
              <View key={item.menuItemId} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemPrice}>{priceTL(item.priceCents)}</Text>
                </View>
                <View style={styles.qtyRow}>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => decrementItem(item.menuItemId)}
                    hitSlop={8}
                  >
                    <Text style={styles.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyNum}>{item.quantity}</Text>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => incrementItem(item.menuItemId)}
                    hitSlop={8}
                  >
                    <Text style={styles.qtyBtnText}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.itemTotal}>
                  {priceTL(item.priceCents * item.quantity)}
                </Text>
              </View>
            ))}
          </View>

          {/* Adres */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Teslimat Adresi</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={address}
              onChangeText={setAddress}
              placeholder="Mahalle, sokak, bina no, daire..."
              placeholderTextColor="#AAAAAA"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Not */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Sipariş Notu (isteğe bağlı)</Text>
            <TextInput
              style={styles.input}
              value={notes}
              onChangeText={setNotes}
              placeholder="Satıcıya not bırakın..."
              placeholderTextColor="#AAAAAA"
            />
          </View>

          {/* Özet */}
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Ara toplam</Text>
              <Text style={styles.summaryValue}>{priceTL(totalCents)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Teslimat</Text>
              <Text style={[styles.summaryValue, { color: colors.success }]}>Ücretsiz</Text>
            </View>
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Toplam</Text>
              <Text style={styles.totalValue}>{priceTL(totalCents + DELIVERY_FEE)}</Text>
            </View>
          </View>

          {/* Sipariş butonu */}
          <Pressable
            style={[styles.orderBtn, loading && styles.btnDisabled]}
            onPress={placeOrder}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.orderBtnText}>Sipariş Ver · {priceTL(totalCents + DELIVERY_FEE)}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE3',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.secondary },
  clearText: { fontSize: 14, color: '#999', fontWeight: '600' },

  scroll: { padding: 20, paddingBottom: 40 },

  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    gap: 8,
  },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: colors.secondary, marginBottom: 2 },
  itemPrice: { fontSize: 13, color: '#888' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 16, fontWeight: '700', color: colors.secondary },
  qtyNum: { fontSize: 15, fontWeight: '800', color: colors.secondary, minWidth: 16, textAlign: 'center' },
  itemTotal: { fontSize: 14, fontWeight: '800', color: colors.primary, minWidth: 56, textAlign: 'right' },

  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
  },
  inputMulti: { height: 80, paddingTop: 12 },

  summaryBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    gap: 10,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14, color: '#888' },
  summaryValue: { fontSize: 14, fontWeight: '600', color: colors.secondary },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#F0EBE3',
    paddingTop: 10,
    marginTop: 2,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: colors.secondary },
  totalValue: { fontSize: 16, fontWeight: '800', color: colors.primary },

  orderBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  orderBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 64, lineHeight: 72 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.secondary, marginTop: 16 },
  emptyBody: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  browseBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  browseBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
