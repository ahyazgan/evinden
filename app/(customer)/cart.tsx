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
import { Ionicons } from '@expo/vector-icons';
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
import FoodImage from '@/components/shared/FoodImage';
import { createOrder, fetchOnlinePaymentEnabled, fetchOrderPricing, fetchSellerById, ORDER_TOTAL_CHANGED, type SellerRow } from '@/lib/db';
import { DEFAULT_ORDER_PRICING, deliveryFeeFor, sellerPricing } from '@/lib/pricing';
import { sellerHasLocation } from '@/lib/geo';
import { resolveDeliveryCoords } from '@/lib/delivery-location';
import { payOrderOnline } from '@/lib/online-payment';
import { trackOrderAndMaybeReview } from '@/lib/app-review';

const { width: SCREEN_W } = Dimensions.get('window');

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Payment Method ───────────────────────────────────────────────────────────

type PaymentMethod = 'cash' | 'card_door' | 'online';

const PAYMENT_OPTIONS: { id: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap; desc: string }[] = [
  { id: 'cash', label: 'Nakit', icon: 'cash-outline', desc: 'Kapıda nakit ödeme' },
  { id: 'card_door', label: 'Kapıda Kart', icon: 'card-outline', desc: 'Kapıda kredi/banka kartı' },
  { id: 'online', label: 'Online Ödeme', icon: 'phone-portrait-outline', desc: 'Kredi kartı ile güvenli ödeme' },
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
          <Ionicons name="checkmark-circle" size={64} color={colors.secondary} style={{ marginBottom: 12 }} />
          <Text style={st.modalTitle}>Siparişin alındı</Text>
          <Text style={st.modalBody}>
            Siparişin mutfağa ulaştı. Nerede olduğunu Siparişlerim'den izle.
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
            <Text style={st.modalShareText}>Paylaş</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Cart Item Row ────────────────────────────────────────────────────────────

function CartItemRow({
  title,
  imageUrl,
  priceCents,
  quantity,
  onIncrement,
  onDecrement,
}: {
  title: string;
  imageUrl?: string | null;
  priceCents: number;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors: t } = useTheme();

  return (
    <View style={[st.cartItem, { borderBottomColor: t.surfaceBorder }]}>
      <FoodImage imageUrl={imageUrl} size={48} borderRadius={12} />
      <View style={st.cartItemInfo}>
        <Text style={[st.cartItemTitle, { color: t.text }]} numberOfLines={1}>{title}</Text>
        <Text style={[st.cartItemPrice, { color: t.textMuted }]}>{priceTL(priceCents)}</Text>
      </View>
      <View style={[st.cartItemQty, { backgroundColor: t.background }]}>
        <Pressable style={[st.qtyBtn, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]} onPress={onDecrement} hitSlop={8}>
          {quantity === 1
            ? <Ionicons name="trash-outline" size={15} color={t.text} />
            : <Text style={[st.qtyBtnText, { color: t.text }]}>−</Text>}
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
  const { requireAuth, session } = useRequireAuth();
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
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [platformPricing, setPlatformPricing] = useState(DEFAULT_ORDER_PRICING);
  const [onlineEnabled, setOnlineEnabled] = useState(false);

  useEffect(() => {
    fetchOrderPricing().then(setPlatformPricing).catch(() => {});
    fetchOnlinePaymentEnabled().then(setOnlineEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sellerId) return;
    fetchSellerById(sellerId).then(setSeller).catch(() => {});
  }, [sellerId]);
  const sellerInfo = seller
    ? { name: seller.display_name, deliveryTime: `${seller.delivery_time_min ?? 25}-${seller.delivery_time_max ?? 40}` }
    : null;
  const pricing = sellerPricing(seller, platformPricing);
  const belowMinimum = totalCents < pricing.minOrderCents;
  const deliveryFee = deliveryFeeFor(totalCents, pricing, couponFreeDelivery);
  const isFreeDelivery = deliveryFee === 0;
  const discountCents = couponDiscount;
  const grandTotal = totalCents + deliveryFee - discountCents;

  const applyPromo = async () => {
    try {
      const result = await validateCoupon(promoCode, totalCents, sellerId);
      if (result.valid) {
        setAppliedCoupon(result.coupon);
        setCouponDiscount(result.discountCents);
        setCouponFreeDelivery(result.freeDelivery);
      } else {
        Alert.alert('Geçersiz Kod', result.error);
      }
    } catch {
      Alert.alert('Hata', 'Kupon doğrulanırken bir hata oluştu. Lütfen tekrar deneyin.');
    }
  };

  const removePromo = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponFreeDelivery(false);
    setPromoCode('');
  };

  // Sepet başka satıcıya geçince önceki satıcının kuponu geçersiz olur.
  useEffect(() => {
    if (appliedCoupon?.sellerId && appliedCoupon.sellerId !== sellerId) removePromo();
  }, [sellerId, appliedCoupon?.sellerId]);

  const placeOrder = async (expectedTotalCents: number = grandTotal) => {
    if (!requireAuth()) return;
    if (!sellerId || items.length === 0) return;
    if (!address.trim()) {
      Alert.alert('Adres gerekli', 'Lütfen teslimat adresinizi girin.');
      return;
    }

    setLoading(true);
    try {
      // Satıcı ayarları sepet açıkken değişmiş olabilir: kararlar güncel kayıtla verilir.
      const currentSeller = (await fetchSellerById(sellerId).catch(() => null)) ?? seller;
      if (currentSeller) setSeller(currentSeller);
      const currentMinimum = sellerPricing(currentSeller, platformPricing).minOrderCents;
      if (totalCents < currentMinimum) {
        Alert.alert('Minimum sipariş tutarı', `Bu satıcıdan en az ${priceTL(currentMinimum)} sipariş verebilirsiniz.`);
        return;
      }

      // Sipariş sunucuda oluşturulur: fiyat, teslimat ücreti, kupon, stok ve komisyon
      // `place_order` içinde hesaplanır. İstemci yalnızca seçimleri gönderir.
      if (session?.userId) {
        const fullAddress = addressFloor ? `${address.trim()}, ${addressFloor.trim()}` : address.trim();
        let deliveryCoords = null;
        if (currentSeller && sellerHasLocation(currentSeller)) {
          deliveryCoords = await resolveDeliveryCoords(address.trim(), currentSeller);
          if (!deliveryCoords) {
            Alert.alert(
              'Adres bulunamadı',
              'Teslimat alanını kontrol edebilmemiz için adresinizi daha açık yazın veya konum izni verin.',
            );
            return;
          }
        }
        const order = await createOrder({
          sellerId,
          items: items.map(item => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            variantId: item.variantId,
            portionId: item.portionId,
            extraIds: item.extraIds,
          })),
          deliveryAddress: fullAddress,
          notes: notes.trim() || undefined,
          paymentMethod,
          couponCode: appliedCoupon?.code ?? null,
          expectedTotalCents,
          deliveryCoords,
        });

        if (paymentMethod === 'online') {
          const payment = await payOrderOnline(order.id);
          if (payment === 'unknown') {
            // Sonuç bilinmiyor: sepet durursa müşteri tekrar sipariş verip iki kez ödeyebilir.
            Alert.alert('Ödeme doğrulanamadı', 'Ödemenizin sonucunu şu an göremiyoruz. Lütfen Siparişlerim ekranından kontrol edin.');
            clearCart();
            router.replace('/(customer)/orders');
            return;
          }
          if (payment === 'not_paid') {
            Alert.alert(
              'Ödeme tamamlanmadı',
              'Ödemeniz onaylanmadı ve siparişiniz iptal edildi. Kartınızdan çekim yapıldıysa otomatik olarak iade sürecine alınır.',
            );
            return;
          }
        }

        // Track order count and maybe prompt for app review
        trackOrderAndMaybeReview();
      }
      setShowSuccess(true);
    } catch (err: any) {
      if (err?.code === ORDER_TOTAL_CHANGED) {
        const newTotal = Number(err.details);
        Alert.alert(
          'Tutar güncellendi',
          `Güncel fiyat ve indirimlerle sipariş tutarı ${priceTL(newTotal)} oldu (ekranda ${priceTL(expectedTotalCents)} görünüyordu).`,
          [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Yeni tutarla sipariş ver', onPress: () => placeOrder(newTotal) },
          ],
        );
        return;
      }
      Alert.alert('Sipariş Hatası', err?.message ?? 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
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
            <Ionicons name="bag-outline" size={40} color={t.heading} />
          </View>
          <Text style={[st.emptyTitle, { color: t.text }]}>Sofra henüz boş</Text>
          <Text style={[st.emptySub, { color: t.textMuted }]}>
            Yakınındaki mutfaklara bak, ne pişmiş gör.
          </Text>
          <Pressable style={st.emptyBtn} onPress={() => router.push('/(customer)')}>
            <Text style={st.emptyBtnText}>Mutfaklara bak</Text>
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
          <Ionicons name="chevron-back" size={20} color={t.text} />
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
              <View style={[st.sellerEmoji, { backgroundColor: colors.secondary }]}>
                <Text style={st.sellerEmojiText}>{sellerInfo.name.charAt(0).toLocaleUpperCase('tr')}</Text>
              </View>
              <View style={st.sellerInfo}>
                <Text style={[st.sellerName, { color: t.text }]}>{sellerInfo.name}</Text>
                <Text style={[st.sellerDelivery, { color: t.textMuted }]}>Tahmini {sellerInfo.deliveryTime} dk</Text>
              </View>
            </View>
          )}

          {/* ═══ ÜRÜNLER ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Siparişin</Text>
            <View style={st.itemsList}>
              {items.map((item) => (
                <CartItemRow
                  key={item.lineKey}
                  title={item.title}
                  imageUrl={item.imageUrl}
                  priceCents={item.priceCents}
                  quantity={item.quantity}
                  onIncrement={() => incrementItem(item.lineKey)}
                  onDecrement={() => decrementItem(item.lineKey)}
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
              <Text style={[st.sectionTitle, { marginBottom: 0, color: t.text }]}>Teslimat Adresi</Text>
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
            <Text style={[st.sectionTitle, { color: t.text }]}>Sipariş Notu</Text>
            <TextInput
              style={[st.noteInput, { backgroundColor: t.background, borderColor: t.surfaceBorder, color: t.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Satıcıya notun (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
            />
          </View>

          {/* ═══ ÖDEME YÖNTEMİ ═══ */}
          <View style={[st.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Ödeme Yöntemi</Text>
            <View style={st.paymentList}>
              {PAYMENT_OPTIONS.map((opt) => {
                const active = paymentMethod === opt.id;
                const disabled = opt.id === 'online' && !onlineEnabled;
                return (
                  <Pressable
                    key={opt.id}
                    style={[st.paymentOption, { borderColor: t.surfaceBorder, backgroundColor: t.background }, active && st.paymentOptionActive, disabled && st.paymentOptionDisabled]}
                    onPress={() => !disabled && setPaymentMethod(opt.id)}
                  >
                    <Ionicons name={opt.icon} size={22} color={t.heading} />
                    <View style={st.paymentInfo}>
                      <Text style={[st.paymentLabel, { color: t.text }, active && st.paymentLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={[st.paymentDesc, { color: t.textMuted }]}>{disabled ? 'Yakında' : opt.desc}</Text>
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
            <Text style={[st.sectionTitle, { color: t.text }]}>Promosyon Kodu</Text>
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
                  {pricing.deliveryFeeCents > 0 && <Text style={st.strikePrice}>{priceTL(pricing.deliveryFeeCents)}</Text>}
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
                  🚀 {priceTL(pricing.freeDeliveryThresholdCents - totalCents)} daha ekleyin, teslimat ücretsiz!
                </Text>
              </View>
            )}
            {belowMinimum && (
              <View style={st.freeDeliveryHint}>
                <Text style={st.freeDeliveryText}>
                  Minimum sipariş {priceTL(pricing.minOrderCents)}: {priceTL(pricing.minOrderCents - totalCents)} daha ekleyin.
                </Text>
              </View>
            )}
          </View>

          {/* ═══ SİPARİŞ VER BUTONU ═══ */}
          <Pressable
            style={[st.orderBtn, loading && st.orderBtnDisabled]}
            onPress={() => placeOrder()}
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
            Sipariş vererek kullanım koşullarını kabul etmiş olursun.
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
    borderBottomColor: '#EDEFE8',
  },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  navTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  navClear: { fontSize: 13, fontFamily: fonts.semibold, color: '#6B766F' },

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
    borderColor: '#EDEFE8',
  },
  sellerEmoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerEmojiText: { fontFamily: fonts.display, fontSize: 20, color: '#fff' },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  sellerDelivery: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 2 },

  // Section cards
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16', marginBottom: 12 },

  // Cart items
  itemsList: { gap: 8 },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F5EE',
  },
  cartItemInfo: { flex: 1 },
  cartItemTitle: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  cartItemPrice: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 1 },
  cartItemQty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F5EE',
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
    borderColor: '#E3E6DE',
  },
  qtyBtnAdd: { backgroundColor: colors.primary, borderColor: colors.primary },
  qtyBtnText: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16', lineHeight: 18 },
  qtyBtnAddText: { color: '#fff' },
  qtyNum: { fontSize: 13, fontFamily: fonts.extrabold, color: '#151A16', minWidth: 20, textAlign: 'center' },
  cartItemTotal: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary, minWidth: 52, textAlign: 'right' },

  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F5EE',
  },
  addMoreIcon: { fontSize: 16, color: colors.primary, fontFamily: fonts.bold },
  addMoreText: { fontSize: 13, color: colors.primary, fontFamily: fonts.semibold },

  // Address
  addressInput: {
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 14,
    fontFamily: fonts.regular, fontSize: 14,
    color: '#151A16',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#EDEFE8',
    marginBottom: 8,
  },
  floorInput: {
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 14,
    fontFamily: fonts.regular, fontSize: 14,
    color: '#151A16',
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },

  // Notes
  noteInput: {
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 14,
    fontFamily: fonts.regular, fontSize: 14,
    color: '#151A16',
    borderWidth: 1,
    borderColor: '#EDEFE8',
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
    borderColor: '#EDEFE8',
    backgroundColor: '#FAFAFA',
  },
  paymentOptionActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF4F1',
  },
  paymentOptionDisabled: { opacity: 0.45 },
  paymentInfo: { flex: 1 },
  paymentLabel: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  paymentLabelActive: { color: colors.primary },
  paymentDesc: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#C9CEC5',
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
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 14,
    fontFamily: fonts.regular, fontSize: 14,
    color: '#151A16',
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  promoBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoBtnDisabled: { backgroundColor: '#C9CEC5' },
  promoBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
  promoApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 10,
  },
  promoAppliedIcon: { fontSize: 14, color: '#2E7D32', fontFamily: fonts.bold },
  promoAppliedText: { flex: 1, fontSize: 13, fontFamily: fonts.semibold, color: '#2E7D32' },
  promoRemove: { fontSize: 12, color: '#C62828', fontFamily: fonts.semibold },

  // Summary
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  summaryTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16', marginBottom: 14 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
  summaryValue: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  strikePrice: { fontFamily: fonts.regular, fontSize: 12, color: '#A3ACA5', textDecorationLine: 'line-through' },
  freeText: { fontSize: 13, fontFamily: fonts.bold, color: '#2E7D32' },
  discountLabel: { fontSize: 13, color: '#2E7D32', fontFamily: fonts.medium },
  discountValue: { fontSize: 13, fontFamily: fonts.bold, color: '#2E7D32' },
  summaryDivider: { height: 1, backgroundColor: '#EDEFE8', marginVertical: 6 },
  totalLabel: { fontSize: 16, fontFamily: fonts.extrabold, color: '#151A16' },
  totalValue: { fontSize: 18, fontFamily: fonts.display, color: colors.primary },
  freeDeliveryHint: {
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  freeDeliveryText: { fontSize: 12, color: '#F57F17', fontFamily: fonts.semibold, textAlign: 'center' },

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
  orderBtnText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },
  orderBtnDivider: { width: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.4)' },
  orderBtnPrice: { color: '#fff', fontSize: 16, fontFamily: fonts.extrabold },
  disclaimer: {
    textAlign: 'center',
    fontFamily: fonts.regular, fontSize: 11,
    color: '#A3ACA5',
    marginTop: 12,
  },

  // Empty state
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F3F5EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, fontFamily: fonts.display, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F', textAlign: 'center', marginTop: 8, lineHeight: 20 },
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
  emptyBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.bold },

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
  modalTitle: { fontSize: 24, fontFamily: fonts.display, color: '#151A16', marginBottom: 8 },
  modalBody: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
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
    backgroundColor: '#DDE1D8',
    borderWidth: 2,
    borderColor: '#DDE1D8',
  },
  modalStepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modalStepText: { fontSize: 9, color: '#6B766F', fontFamily: fonts.medium },
  modalStepLine: { width: 20, height: 2, backgroundColor: '#DDE1D8', marginBottom: 18 },
  modalBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },
  modalShareBtn: { marginTop: 8, paddingVertical: 10 },
  modalShareText: { fontSize: 14, color: '#6B766F', fontFamily: fonts.semibold },

  // Address chips
  addrHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addrManageLink: { fontSize: 13, color: colors.primary, fontFamily: fonts.bold },
  addrChipsRow: { gap: 8, marginBottom: 12 },
  addrChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF8F2',
    borderRadius: 12,
    padding: 10,
    paddingRight: 14,
    borderWidth: 1.5,
    borderColor: '#EDEFE8',
    minWidth: 140,
  },
  addrChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF4F1',
  },
  addrChipIcon: { fontFamily: fonts.regular, fontSize: 18 },
  addrChipInfo: { flexShrink: 1, maxWidth: 130 },
  addrChipLabel: { fontSize: 12, fontFamily: fonts.bold, color: '#151A16' },
  addrChipLabelActive: { color: colors.primary },
  addrChipAddr: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 1 },
  addrChipAddrActive: { color: colors.primary },
  addrChipCheck: { fontSize: 14, color: colors.primary, fontFamily: fonts.extrabold, marginLeft: 4 },
});
