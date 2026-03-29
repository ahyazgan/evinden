import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
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
import { useCart } from '@/lib/cart-context';
import { useAddresses } from '@/lib/address-context';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { validateCoupon, type Coupon } from '@/lib/coupons';
import { useTheme } from '@/lib/theme-context';
import { shareOrder } from '@/lib/social-share';
import { fonts } from '@/lib/fonts';

const { width: SCREEN_W } = Dimensions.get('window');
const DELIVERY_FEE_CENTS = 1500; // ₺15 teslimat
const FREE_DELIVERY_THRESHOLD = 15000; // ₺150 üzeri ücretsiz

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Demo seller bilgisi ──────────────────────────────────────────────────────

const SELLER_INFO: Record<string, { name: string; emoji: string; bg: string; deliveryTime: string }> = {
  'demo-1': { name: "Ayşe'nin Ev Yemekleri", emoji: '🍲', bg: '#FFF3E0', deliveryTime: '25-35' },
  'demo-2': { name: 'Fatma Hanım Mutfağı', emoji: '🥟', bg: '#E8F5E9', deliveryTime: '30-40' },
  'demo-3': { name: 'Mehmet Usta Karadeniz', emoji: '🐟', bg: '#E3F2FD', deliveryTime: '20-30' },
  'demo-4': { name: 'Zeynep Pasta & Tatlı', emoji: '🎂', bg: '#FCE4EC', deliveryTime: '35-45' },
  'demo-5': { name: 'Hüseyin Bey Izgara', emoji: '🥩', bg: '#FBE9E7', deliveryTime: '25-35' },
  'demo-6': { name: 'Elif Anne Kahvaltı', emoji: '🍳', bg: '#FFFDE7', deliveryTime: '20-30' },
};

const ITEM_EMOJIS: Record<string, string> = {
  'm1-1': '🍜', 'm1-2': '🍚', 'm1-3': '🍖', 'm1-4': '🥗',
  'm2-1': '🥬', 'm2-2': '🥐', 'm2-3': '🌿',
  'm3-1': '🐟', 'm3-2': '🧀', 'm3-3': '🌽', 'm3-4': '🍵',
  'm4-1': '🎂', 'm4-2': '🍪', 'm4-3': '🍮',
  'm5-1': '🥩', 'm5-2': '🍗', 'm5-3': '🍽️',
  'm6-1': '🍳', 'm6-2': '🫓', 'm6-3': '🧈',
};

// ─── Payment Method ───────────────────────────────────────────────────────────

type PaymentMethod = 'cash' | 'card_door' | 'online';

const PAYMENT_OPTIONS: { id: PaymentMethod; label: string; icon: string; desc: string }[] = [
  { id: 'cash', label: 'Nakit', icon: '💵', desc: 'Kapıda nakit ödeme' },
  { id: 'card_door', label: 'Kapıda Kart', icon: '💳', desc: 'Kapıda kredi/banka kartı' },
  { id: 'online', label: 'Online Ödeme', icon: '📱', desc: 'Yakında aktif olacak' },
];

// ─── Success Modal ────────────────────────────────────────────────────────────

function SuccessModal({ visible, onDone, onShare }: { visible: boolean; onDone: () => void; onShare: () => void }) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.5);
      opacity.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[st.modalOverlay, { opacity }]}>
        <Animated.View style={[st.modalCard, { transform: [{ scale }] }]}>
          <Text style={st.modalEmoji}>🎉</Text>
          <Text style={st.modalTitle}>Sipariş Alındı!</Text>
          <Text style={st.modalBody}>
            Siparişiniz satıcıya iletildi. Hazırlanma durumunu siparişler sayfasından takip edebilirsiniz.
          </Text>
          <View style={st.modalSteps}>
            <View style={st.modalStep}>
              <View style={[st.modalStepDot, st.modalStepDotActive]} />
              <Text style={st.modalStepText}>Sipariş alındı</Text>
            </View>
            <View style={st.modalStepLine} />
            <View style={st.modalStep}>
              <View style={st.modalStepDot} />
              <Text style={st.modalStepText}>Hazırlanıyor</Text>
            </View>
            <View style={st.modalStepLine} />
            <View style={st.modalStep}>
              <View style={st.modalStepDot} />
              <Text style={st.modalStepText}>Yolda</Text>
            </View>
            <View style={st.modalStepLine} />
            <View style={st.modalStep}>
              <View style={st.modalStepDot} />
              <Text style={st.modalStepText}>Teslim</Text>
            </View>
          </View>
          <Pressable style={st.modalBtn} onPress={onDone}>
            <Text style={st.modalBtnText}>Siparişi Takip Et</Text>
          </Pressable>
          <Pressable style={st.modalShareBtn} onPress={onShare}>
            <Text style={st.modalShareText}>📱 Paylaş</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Cart Item Row ────────────────────────────────────────────────────────────

function CartItemRow({
  menuItemId,
  title,
  priceCents,
  quantity,
  onIncrement,
  onDecrement,
}: {
  menuItemId: string;
  title: string;
  priceCents: number;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors: t } = useTheme();
  const emoji = ITEM_EMOJIS[menuItemId] ?? '🍽️';

  return (
    <View style={[st.cartItem, { borderBottomColor: t.surfaceBorder }]}>
      <View style={[st.cartItemEmoji, { backgroundColor: t.background, borderColor: t.surfaceBorder }]}>
        <Text style={st.cartItemEmojiText}>{emoji}</Text>
      </View>
      <View style={st.cartItemInfo}>
        <Text style={[st.cartItemTitle, { color: t.text }]} numberOfLines={1}>{title}</Text>
        <Text style={[st.cartItemPrice, { color: t.textMuted }]}>{priceTL(priceCents)}</Text>
      </View>
      <View style={[st.cartItemQty, { backgroundColor: t.background }]}>
        <Pressable style={[st.qtyBtn, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]} onPress={onDecrement} hitSlop={8}>
          <Text style={[st.qtyBtnText, { color: t.text }]}>{quantity === 1 ? '🗑️' : '−'}</Text>
        </Pressable>
        <Text style={[st.qtyNum, { color: t.text }]}>{quantity}</Text>
        <Pressable style={[st.qtyBtn, st.qtyBtnAdd]} onPress={onIncrement} hitSlop={8}>
          <Text style={[st.qtyBtnText, st.qtyBtnAddText]}>+</Text>
        </Pressable>
      </View>
      <Text style={st.cartItemTotal}>{priceTL(priceCents * quantity)}</Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CartScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const { requireAuth } = useRequireAuth();
  const {
    sellerId,
    items,
    totalItems,
    totalCents,
    incrementItem,
    decrementItem,
    clearCart,
  } = useCart();
  const { addresses, defaultAddress, setDefault } = useAddresses();

  const [address, setAddress] = useState('');
  const [addressFloor, setAddressFloor] = useState('');

  useEffect(() => {
    if (defaultAddress) {
      setAddress(defaultAddress.addressLine);
      setAddressFloor(defaultAddress.floor || '');
    }
  }, [defaultAddress]);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [promoCode, setPromoCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponFreeDelivery, setCouponFreeDelivery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const sellerInfo = sellerId ? SELLER_INFO[sellerId] : null;
  const isFreeDelivery = totalCents >= FREE_DELIVERY_THRESHOLD || couponFreeDelivery;
  const deliveryFee = isFreeDelivery ? 0 : DELIVERY_FEE_CENTS;
  const discountCents = couponDiscount;
  const grandTotal = totalCents + deliveryFee - discountCents;

  const applyPromo = () => {
    const result = validateCoupon(promoCode, totalCents);
    if (result.valid) {
      setAppliedCoupon(result.coupon);
      setCouponDiscount(result.discountCents);
      setCouponFreeDelivery(result.freeDelivery);
    } else {
      Alert.alert('Geçersiz Kod', result.error);
    }
  };

  const removePromo = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponFreeDelivery(false);
    setPromoCode('');
  };

  const placeOrder = async () => {
    if (!requireAuth()) return;
    if (!sellerId || items.length === 0) return;
    if (!address.trim()) {
      Alert.alert('Adres gerekli', 'Lütfen teslimat adresinizi girin.');
      return;
    }
    if (paymentMethod === 'online') {
      Alert.alert('Yakında', 'Online ödeme henüz aktif değil. Lütfen başka bir yöntem seçin.');
      return;
    }

    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    setShowSuccess(true);
  };

  const handleSuccessDone = () => {
    setShowSuccess(false);
    clearCart();
    router.replace('/(customer)/orders');
  };

  // ── Boş sepet
  if (items.length === 0 && !showSuccess) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={[st.navBar, { backgroundColor: t.surface, borderBottomColor: t.surfaceBorder }]}>
          <Text style={[st.navTitle, { color: t.text }]}>Sepet</Text>
        </View>
        <View style={st.emptyWrap}>
          <View style={[st.emptyCircle, { backgroundColor: t.surface }]}>
            <Text style={st.emptyEmoji}>🛒</Text>
          </View>
          <Text style={[st.emptyTitle, { color: t.text }]}>Sepetiniz boş</Text>
          <Text style={[st.emptySub, { color: t.textMuted }]}>
            Lezzetli ev yemeklerini keşfedin ve sepetinize ekleyin
          </Text>
          <Pressable style={st.emptyBtn} onPress={() => router.push('/(customer)')}>
            <Text style={st.emptyBtnText}>Satıcıları Keşfet</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SuccessModal
        visible={showSuccess}
        onDone={handleSuccessDone}
        onShare={() => {
          const name = sellerInfo?.name ?? 'Satıcı';
          const titles = items.map(i => i.title);
          shareOrder(name, titles);
        }}
      />

      {/* ═══ NAV BAR ═══ */}
      <View style={[st.navBar, { backgroundColor: t.surface, borderBottomColor: t.surfaceBorder }]}>
        <Pressable style={[st.navBack, { backgroundColor: t.background }]} onPress={() => router.back()} hitSlop={12}>
          <Text style={[st.navBackIcon, { color: t.text }]}>‹</Text>
        </Pressable>
        <Text style={[st.navTitle, { color: t.text }]}>Sepet</Text>
        <Pressable
          onPress={() =>
            Alert.alert('Sepeti Temizle', 'Tüm ürünler silinecek.', [
              { text: 'İptal', style: 'cancel' },
              { text: 'Temizle', style: 'destructive', onPress: clearCart },
            ])
          }
        >
          <Text style={[st.navClear, { color: t.textMuted }]}>Temizle</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ═══ SATICI BİLGİSİ ═══ */}
          {sellerInfo && (
            <View style={[st.sellerBar, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              <View style={[st.sellerEmoji, { backgroundColor: sellerInfo.bg }]}>
                <Text style={st.sellerEmojiText}>{sellerInfo.emoji}</Text>
              </View>
              <View style={st.sellerInfo}>
                <Text style={[st.sellerName, { color: t.text }]}>{sellerInfo.name}</Text>
                <Text style={[st.sellerDelivery, { color: t.textMuted }]}>🕐 Tahmini {sellerInfo.deliveryTime} dk</Text>
              </View>
            </View>
          )}

          {/* ═══ ÜRÜNLER ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Siparişiniz</Text>
            <View style={st.itemsList}>
              {items.map((item) => (
                <CartItemRow
                  key={item.menuItemId}
                  menuItemId={item.menuItemId}
                  title={item.title}
                  priceCents={item.priceCents}
                  quantity={item.quantity}
                  onIncrement={() => incrementItem(item.menuItemId)}
                  onDecrement={() => decrementItem(item.menuItemId)}
                />
              ))}
            </View>
            <Pressable
              style={[st.addMoreBtn, { borderTopColor: t.surfaceBorder }]}
              onPress={() => sellerId && router.push(`/(customer)/seller/${sellerId}` as any)}
            >
              <Text style={st.addMoreIcon}>+</Text>
              <Text style={st.addMoreText}>Daha fazla ürün ekle</Text>
            </Pressable>
          </View>

          {/* ═══ TESLİMAT ADRESİ ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <View style={st.addrHeaderRow}>
              <Text style={[st.sectionTitle, { marginBottom: 0, color: t.text }]}>📍 Teslimat Adresi</Text>
              <Pressable onPress={() => router.push('/(customer)/addresses' as any)}>
                <Text style={st.addrManageLink}>Yönet</Text>
              </Pressable>
            </View>

            {/* Saved address chips */}
            {addresses.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={st.addrChipsRow}
              >
                {addresses.map((addr) => {
                  const selected = address === addr.addressLine;
                  return (
                    <Pressable
                      key={addr.id}
                      style={[st.addrChip, selected && st.addrChipActive]}
                      onPress={() => {
                        setAddress(addr.addressLine);
                        setAddressFloor(addr.floor || '');
                        setDefault(addr.id);
                      }}
                    >
                      <Text style={st.addrChipIcon}>
                        {addr.label === 'Ev' ? '🏠' : addr.label === 'İş' ? '🏢' : '📍'}
                      </Text>
                      <View style={st.addrChipInfo}>
                        <Text style={[st.addrChipLabel, selected && st.addrChipLabelActive]}>
                          {addr.label}
                        </Text>
                        <Text style={[st.addrChipAddr, selected && st.addrChipAddrActive]} numberOfLines={1}>
                          {addr.addressLine}
                        </Text>
                      </View>
                      {selected && <Text style={st.addrChipCheck}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <TextInput
              style={[st.addressInput, { backgroundColor: t.background, borderColor: t.surfaceBorder, color: t.text }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Mahalle, sokak, bina no..."
              placeholderTextColor={t.textMuted}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <TextInput
              style={[st.floorInput, { backgroundColor: t.background, borderColor: t.surfaceBorder, color: t.text }]}
              value={addressFloor}
              onChangeText={setAddressFloor}
              placeholder="Kat / Daire no (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
            />
          </View>

          {/* ═══ SİPARİŞ NOTU ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>📝 Sipariş Notu</Text>
            <TextInput
              style={[st.noteInput, { backgroundColor: t.background, borderColor: t.surfaceBorder, color: t.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Satıcıya notunuz... (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
            />
          </View>

          {/* ═══ ÖDEME YÖNTEMİ ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>💳 Ödeme Yöntemi</Text>
            <View style={st.paymentList}>
              {PAYMENT_OPTIONS.map((opt) => {
                const active = paymentMethod === opt.id;
                const disabled = opt.id === 'online';
                return (
                  <Pressable
                    key={opt.id}
                    style={[st.paymentOption, { borderColor: t.surfaceBorder, backgroundColor: t.background }, active && st.paymentOptionActive, disabled && st.paymentOptionDisabled]}
                    onPress={() => !disabled && setPaymentMethod(opt.id)}
                  >
                    <Text style={st.paymentIcon}>{opt.icon}</Text>
                    <View style={st.paymentInfo}>
                      <Text style={[st.paymentLabel, { color: t.text }, active && st.paymentLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={[st.paymentDesc, { color: t.textMuted }]}>{opt.desc}</Text>
                    </View>
                    <View style={[st.radio, active && st.radioActive]}>
                      {active && <View style={st.radioInner} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ═══ PROMOSYON KODU ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>🎁 Promosyon Kodu</Text>
            {appliedCoupon ? (
              <View style={st.promoApplied}>
                <Text style={st.promoAppliedIcon}>✓</Text>
                <Text style={st.promoAppliedText}>{appliedCoupon.code} — {appliedCoupon.title}</Text>
                <Pressable onPress={removePromo} hitSlop={8}>
                  <Text style={st.promoRemove}>Kaldır</Text>
                </Pressable>
              </View>
            ) : (
              <View style={st.promoRow}>
                <TextInput
                  style={[st.promoInput, { backgroundColor: t.background, borderColor: t.surfaceBorder, color: t.text }]}
                  value={promoCode}
                  onChangeText={setPromoCode}
                  placeholder="Kodu girin..."
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="characters"
                />
                <Pressable
                  style={[st.promoBtn, !promoCode.trim() && st.promoBtnDisabled]}
                  onPress={applyPromo}
                  disabled={!promoCode.trim()}
                >
                  <Text style={st.promoBtnText}>Uygula</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* ═══ SİPARİŞ ÖZETİ ═══ */}
          <View style={[st.summaryCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.summaryTitle, { color: t.text }]}>Sipariş Özeti</Text>
            <View style={st.summaryRow}>
              <Text style={[st.summaryLabel, { color: t.textMuted }]}>Ara toplam ({totalItems} ürün)</Text>
              <Text style={[st.summaryValue, { color: t.text }]}>{priceTL(totalCents)}</Text>
            </View>
            <View style={st.summaryRow}>
              <Text style={[st.summaryLabel, { color: t.textMuted }]}>Teslimat ücreti</Text>
              {isFreeDelivery ? (
                <View style={st.freeRow}>
                  <Text style={st.strikePrice}>{priceTL(DELIVERY_FEE_CENTS)}</Text>
                  <Text style={st.freeText}>Ücretsiz</Text>
                </View>
              ) : (
                <Text style={[st.summaryValue, { color: t.text }]}>{priceTL(deliveryFee)}</Text>
              )}
            </View>
            {discountCents > 0 && (
              <View style={st.summaryRow}>
                <Text style={st.discountLabel}>İndirim ({appliedCoupon?.code})</Text>
                <Text style={st.discountValue}>-{priceTL(discountCents)}</Text>
              </View>
            )}
            {couponFreeDelivery && deliveryFee === 0 && (
              <View style={st.summaryRow}>
                <Text style={st.discountLabel}>Ücretsiz Teslimat</Text>
                <Text style={st.discountValue}>Kupon ile</Text>
              </View>
            )}
            <View style={[st.summaryDivider, { backgroundColor: t.surfaceBorder }]} />
            <View style={st.summaryRow}>
              <Text style={[st.totalLabel, { color: t.text }]}>Toplam</Text>
              <Text style={st.totalValue}>{priceTL(grandTotal)}</Text>
            </View>

            {!isFreeDelivery && (
              <View style={st.freeDeliveryHint}>
                <Text style={st.freeDeliveryText}>
                  🚀 {priceTL(FREE_DELIVERY_THRESHOLD - totalCents)} daha ekleyin, teslimat ücretsiz!
                </Text>
              </View>
            )}
          </View>

          {/* ═══ SİPARİŞ VER BUTONU ═══ */}
          <Pressable
            style={[st.orderBtn, loading && st.orderBtnDisabled]}
            onPress={placeOrder}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={st.orderBtnText}>Sipariş Ver</Text>
                <View style={st.orderBtnDivider} />
                <Text style={st.orderBtnPrice}>{priceTL(grandTotal)}</Text>
              </>
            )}
          </Pressable>

          <Text style={[st.disclaimer, { color: t.textMuted }]}>
            Sipariş vererek kullanım koşullarını kabul etmiş olursunuz.
          </Text>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F2ED' },

  // Nav
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  navClear: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },

  scroll: { padding: 16, paddingBottom: 20 },

  // Seller bar
  sellerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  sellerEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerEmojiText: { fontSize: 22 },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  sellerDelivery: { fontSize: 12, color: '#8A7E72', marginTop: 2 },

  // Section cards
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208', marginBottom: 12 },

  // Cart items
  itemsList: { gap: 8 },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F7F3EE',
  },
  cartItemEmoji: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  cartItemEmojiText: { fontSize: 20 },
  cartItemInfo: { flex: 1 },
  cartItemTitle: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  cartItemPrice: { fontSize: 12, color: '#8A7E72', marginTop: 1 },
  cartItemQty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F3EE',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  qtyBtnAdd: { backgroundColor: colors.primary, borderColor: colors.primary },
  qtyBtnText: { fontSize: 15, fontWeight: '700', color: '#1A1208', lineHeight: 18 },
  qtyBtnAddText: { color: '#fff' },
  qtyNum: { fontSize: 13, fontWeight: '800', color: '#1A1208', minWidth: 20, textAlign: 'center' },
  cartItemTotal: { fontSize: 14, fontWeight: '800', color: colors.primary, minWidth: 52, textAlign: 'right' },

  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F7F3EE',
  },
  addMoreIcon: { fontSize: 16, color: colors.primary, fontWeight: '700' },
  addMoreText: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  // Address
  addressInput: {
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#1A1208',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    marginBottom: 8,
  },
  floorInput: {
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#1A1208',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },

  // Notes
  noteInput: {
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#1A1208',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },

  // Payment
  paymentList: { gap: 8 },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F0ECE6',
    backgroundColor: '#FAFAFA',
  },
  paymentOptionActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF5F2',
  },
  paymentOptionDisabled: { opacity: 0.45 },
  paymentIcon: { fontSize: 24 },
  paymentInfo: { flex: 1 },
  paymentLabel: { fontSize: 14, fontWeight: '600', color: '#1A1208' },
  paymentLabelActive: { color: colors.primary },
  paymentDesc: { fontSize: 11, color: '#8A7E72', marginTop: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D0C8BC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },

  // Promo
  promoRow: { flexDirection: 'row', gap: 8 },
  promoInput: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#1A1208',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  promoBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoBtnDisabled: { backgroundColor: '#D0C8BC' },
  promoBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 10,
  },
  promoAppliedIcon: { fontSize: 14, color: '#2E7D32', fontWeight: '700' },
  promoAppliedText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#2E7D32' },
  promoRemove: { fontSize: 12, color: '#C62828', fontWeight: '600' },

  // Summary
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208', marginBottom: 14 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: { fontSize: 13, color: '#8A7E72' },
  summaryValue: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  strikePrice: { fontSize: 12, color: '#B8AFA4', textDecorationLine: 'line-through' },
  freeText: { fontSize: 13, fontWeight: '700', color: '#2E7D32' },
  discountLabel: { fontSize: 13, color: '#2E7D32', fontWeight: '500' },
  discountValue: { fontSize: 13, fontWeight: '700', color: '#2E7D32' },
  summaryDivider: { height: 1, backgroundColor: '#F0ECE6', marginVertical: 6 },
  totalLabel: { fontSize: 16, fontWeight: '800', color: '#1A1208' },
  totalValue: { fontSize: 18, fontWeight: '800', color: colors.primary },
  freeDeliveryHint: {
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  freeDeliveryText: { fontSize: 12, color: '#F57F17', fontWeight: '600', textAlign: 'center' },

  // Order button
  orderBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  orderBtnDisabled: { opacity: 0.7 },
  orderBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  orderBtnDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.4)' },
  orderBtnPrice: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disclaimer: {
    textAlign: 'center',
    fontSize: 11,
    color: '#B8AFA4',
    marginTop: 12,
  },

  // Empty state
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F7F3EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  emptySub: { fontSize: 14, color: '#8A7E72', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  emptyBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Success Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: SCREEN_W - 48,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
  },
  modalEmoji: { fontSize: 56, marginBottom: 12 },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', marginBottom: 8 },
  modalBody: { fontSize: 14, color: '#8A7E72', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    gap: 4,
  },
  modalStep: { alignItems: 'center', gap: 6 },
  modalStepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E8E2DA',
    borderWidth: 2,
    borderColor: '#E8E2DA',
  },
  modalStepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalStepText: { fontSize: 9, color: '#8A7E72', fontWeight: '500' },
  modalStepLine: { width: 20, height: 2, backgroundColor: '#E8E2DA', marginBottom: 18 },
  modalBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalShareBtn: { marginTop: 8, paddingVertical: 10 },
  modalShareText: { fontSize: 14, color: '#8A7E72', fontWeight: '600' },

  // Address chips
  addrHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addrManageLink: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  addrChipsRow: { gap: 8, marginBottom: 12 },
  addrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF7F2',
    borderRadius: 12,
    padding: 10,
    paddingRight: 14,
    borderWidth: 1.5,
    borderColor: '#F0ECE6',
    minWidth: 140,
  },
  addrChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF5F2',
  },
  addrChipIcon: { fontSize: 18 },
  addrChipInfo: { flexShrink: 1, maxWidth: 130 },
  addrChipLabel: { fontSize: 12, fontWeight: '700', color: '#1A1208' },
  addrChipLabelActive: { color: colors.primary },
  addrChipAddr: { fontSize: 11, color: '#8A7E72', marginTop: 1 },
  addrChipAddrActive: { color: colors.primary },
  addrChipCheck: { fontSize: 14, color: colors.primary, fontWeight: '800', marginLeft: 4 },
});
