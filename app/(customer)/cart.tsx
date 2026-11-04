import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useCart } from '@/lib/cart-context';
import { useAddresses } from '@/lib/address-context';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { validateCoupon, type Coupon } from '@/lib/coupons';
import { useTheme } from '@/lib/theme-context';
import { shareOrder } from '@/lib/social-share';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import FoodImage from '@/components/shared/FoodImage';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { SALES_TERMS_VERSION } from '@/constants/business';
import { PhoneVerifyModal, phoneVerificationNeeded } from '@/components/shared/PhoneVerifyModal';
import { createOrder, fetchOnlinePaymentEnabled, fetchOrderPricing, fetchSellerById, fetchSellerHours, ORDER_TOTAL_CHANGED, PHONE_NOT_VERIFIED, type SellerHourRow, type SellerRow } from '@/lib/db';
import { DEFAULT_ORDER_PRICING, deliveryFeeFor, orderTotalCents, parseTLToCents, sellerPricing } from '@/lib/pricing';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { mapsUrl, MAX_TIP_CENTS, mealCardLabels, paymentLabel, sellerAddress, TIP_PRESETS_CENTS, type Fulfillment, type PaymentMethod } from '@/lib/order-options';
import { plannedLabel, scheduleDays } from '@/lib/schedule-slots';
import { sellerHasLocation } from '@/lib/geo';
import { resolveDeliveryCoords } from '@/lib/delivery-location';
import { payOrderOnline } from '@/lib/online-payment';
import { trackOrderAndMaybeReview } from '@/lib/app-review';

const { width: SCREEN_W } = Dimensions.get('window');

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Payment Method ───────────────────────────────────────────────────────────

const PAYMENT_OPTIONS: { id: PaymentMethod; icon: keyof typeof Ionicons.glyphMap; desc: string }[] = [
  { id: 'cash', icon: 'cash-outline', desc: 'Kapıda nakit ödeme' },
  { id: 'card_door', icon: 'card-outline', desc: 'Kapıda kredi veya banka kartı' },
  { id: 'meal_card_door', icon: 'restaurant-outline', desc: 'Kapıda yemek kartı' },
  { id: 'online', icon: 'phone-portrait-outline', desc: 'Kredi kartı ile güvenli ödeme' },
];

/** Hazır bahşiş tutarları veya elle yazılan tutar */
type TipChoice = number | 'custom';

/** Seçim çipi: etkin olan limon (TASARIM) */
function OptionChip({ label, on, disabled, onPress, icon }: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors: t } = useTheme();
  return (
    <Pressable
      style={[st.optionChip, { backgroundColor: on ? t.accent : t.background }, disabled && st.optionChipOff]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={2}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled: !!disabled }}
    >
      {icon ? <Ionicons name={icon} size={16} color={on ? t.onAccent : t.text} /> : null}
      <Text style={[st.optionChipText, { color: on ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Success Modal ────────────────────────────────────────────────────────────

function SuccessModal({ visible, pickup, onDone, onShare }: { visible: boolean; pickup: boolean; onDone: () => void; onShare: () => void }) {
  const { colors: t } = useTheme();
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
        <Animated.View style={[st.modalCard, { backgroundColor: t.surface, transform: [{ scale }] }]}>
          <Ionicons name="checkmark-circle" size={64} color={t.success} style={{ marginBottom: 12 }} />
          <Text style={[st.modalTitle, { color: t.heading }]}>Siparişin alındı</Text>
          <Text style={[st.modalBody, { color: t.textSecondary }]}>
            Siparişin restorana ulaştı. Nerede olduğunu Siparişlerim'den izle.
          </Text>
          <View style={st.modalSteps}>
            <View style={st.modalStep}>
              <View style={[st.modalStepDot, { backgroundColor: t.primary }]} />
              <Text style={[st.modalStepText, { color: t.textSecondary }]}>Sipariş alındı</Text>
            </View>
            <View style={[st.modalStepLine, { backgroundColor: t.divider }]} />
            <View style={st.modalStep}>
              <View style={[st.modalStepDot, { backgroundColor: t.divider }]} />
              <Text style={[st.modalStepText, { color: t.textSecondary }]}>Hazırlanıyor</Text>
            </View>
            <View style={[st.modalStepLine, { backgroundColor: t.divider }]} />
            <View style={st.modalStep}>
              <View style={[st.modalStepDot, { backgroundColor: t.divider }]} />
              <Text style={[st.modalStepText, { color: t.textSecondary }]}>{pickup ? 'Hazır' : 'Yolda'}</Text>
            </View>
            <View style={[st.modalStepLine, { backgroundColor: t.divider }]} />
            <View style={st.modalStep}>
              <View style={[st.modalStepDot, { backgroundColor: t.divider }]} />
              <Text style={[st.modalStepText, { color: t.textSecondary }]}>{pickup ? 'Aldın' : 'Teslim'}</Text>
            </View>
          </View>
          <Button label="Siparişi takip et" size="lg" fullWidth onPress={onDone} />
          <Pressable style={st.modalShareBtn} onPress={onShare} accessibilityRole="button">
            <Text style={[st.modalShareText, { color: t.textSecondary }]}>Paylaş</Text>
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
    <View style={[st.cartItem, { backgroundColor: t.surface }]}>
      <FoodImage imageUrl={imageUrl} size={72} borderRadius={36} />
      <View style={st.cartItemInfo}>
        <Text style={[st.cartItemTitle, { color: t.text }]} numberOfLines={2}>{title}</Text>
        <View style={st.cartItemFoot}>
          <View style={[st.stepper, { backgroundColor: t.background }]}>
            <Pressable style={st.stepBtn} onPress={onDecrement} accessibilityRole="button" accessibilityLabel={quantity === 1 ? 'Sepetten çıkar' : 'Azalt'}>
              <Ionicons name={quantity === 1 ? 'trash-outline' : 'remove'} size={16} color={t.text} />
            </Pressable>
            <Text style={[st.stepNum, { color: t.text }]}>{quantity}</Text>
            <Pressable style={st.stepBtn} onPress={onIncrement} accessibilityRole="button" accessibilityLabel="Artır">
              <Ionicons name="add" size={16} color={t.text} />
            </Pressable>
          </View>
          <Text style={[st.cartItemTotal, { color: t.text }]}>{priceTL(priceCents * quantity)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CartScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const [editingAddress, setEditingAddress] = useState(false);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [phoneModal, setPhoneModal] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponFreeDelivery, setCouponFreeDelivery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [platformPricing, setPlatformPricing] = useState(DEFAULT_ORDER_PRICING);
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('delivery');
  const [timeMode, setTimeMode] = useState<'now' | 'later'>('now');
  const [scheduledIso, setScheduledIso] = useState<string | null>(null);
  const [scheduleDayKey, setScheduleDayKey] = useState<string | null>(null);
  const [hours, setHours] = useState<SellerHourRow[]>([]);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [tipChoice, setTipChoice] = useState<TipChoice>(0);
  const [customTip, setCustomTip] = useState('');

  useEffect(() => {
    fetchOrderPricing().then(setPlatformPricing).catch(() => {});
    fetchOnlinePaymentEnabled().then(setOnlineEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sellerId) return;
    fetchSellerById(sellerId).then(setSeller).catch(() => {});
    setHoursLoaded(false);
    fetchSellerHours(sellerId)
      .then(rows => { setHours(rows); setHoursLoaded(true); })
      .catch(() => {});
  }, [sellerId]);

  // Geçen saatler listeden düşsün.
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const sellerInfo = seller
    ? { name: seller.display_name, deliveryTime: `${seller.delivery_time_min ?? 25}-${seller.delivery_time_max ?? 40}` }
    : null;
  const pricing = sellerPricing(seller, platformPricing);
  const belowMinimum = totalCents < pricing.minOrderCents;
  const pickup = fulfillment === 'pickup';
  const deliveryFee = pickup ? 0 : deliveryFeeFor(totalCents, pricing, couponFreeDelivery);
  const isFreeDelivery = deliveryFee === 0;
  const discountCents = couponDiscount;

  const customTipCents = parseTLToCents(customTip);
  const tipInvalid = !pickup && tipChoice === 'custom'
    && (customTipCents === undefined || (customTipCents ?? 0) > MAX_TIP_CENTS);
  const tipCents = pickup || tipInvalid ? 0 : tipChoice === 'custom' ? customTipCents ?? 0 : tipChoice;
  const grandTotal = orderTotalCents({ subtotalCents: totalCents, deliveryFeeCents: deliveryFee, discountCents, tipCents });

  const acceptedCards = mealCardLabels(seller?.meal_cards);
  const paymentOptions = PAYMENT_OPTIONS.filter(opt =>
    (opt.id !== 'online' || onlineEnabled) && (opt.id !== 'meal_card_door' || acceptedCards.length > 0));
  const paymentWide = paymentOptions.length > 3 || pickup;

  const pickupAvailable = !!seller?.pickup_enabled;
  const scheduleAvailable = !!seller?.accepts_scheduled;
  const openNow = !hoursLoaded || isOpenAt(hours, istanbulClock(clock));
  const days = useMemo(
    () => (scheduleAvailable && hoursLoaded ? scheduleDays(at => isOpenAt(hours, istanbulClock(at)), clock) : []),
    [scheduleAvailable, hoursLoaded, hours, clock],
  );
  const selectedDay = days.find(d => d.dateKey === scheduleDayKey) ?? days[0];

  // Satıcı ayarı değiştiyse ya da sepet başka satıcıya geçtiyse geçersiz seçim kalmaz.
  useEffect(() => {
    if (seller && !pickupAvailable) setFulfillment('delivery');
  }, [seller, pickupAvailable]);
  useEffect(() => {
    if (!paymentOptions.some(opt => opt.id === paymentMethod)) setPaymentMethod('cash');
  }, [paymentOptions.length, paymentMethod]);
  useEffect(() => {
    if (seller && !scheduleAvailable) setTimeMode('now');
    // Restoran kapalıysa yalnızca ileri bir saat seçilebilir.
    else if (scheduleAvailable && !openNow) setTimeMode('later');
  }, [seller, scheduleAvailable, openNow]);
  useEffect(() => {
    if (scheduledIso && !days.some(d => d.slots.some(slot => slot.iso === scheduledIso))) setScheduledIso(null);
  }, [days, scheduledIso]);

  const scheduledFor = timeMode === 'later' ? scheduledIso : null;

  const chooseFulfillment = (next: Fulfillment) => {
    setFulfillment(next);
    if (next === 'pickup' && couponFreeDelivery) {
      removePromo();
      Alert.alert('Kupon kaldırıldı', 'Ücretsiz teslimat kuponu gelip almada geçerli değil.');
    }
  };

  const applyPromo = async () => {
    try {
      const result = await validateCoupon(promoCode, totalCents, sellerId);
      if (result.valid && result.freeDelivery && pickup) {
        Alert.alert('Geçersiz kod', 'Ücretsiz teslimat kuponu gelip almada geçerli değil.');
      } else if (result.valid) {
        setAppliedCoupon(result.coupon);
        setCouponDiscount(result.discountCents);
        setCouponFreeDelivery(result.freeDelivery);
      } else {
        Alert.alert('Geçersiz kod', result.error);
      }
    } catch {
      Alert.alert('Hata', 'Kupon doğrulanırken bir hata oluştu. Tekrar dene.');
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

  // Onay o anki tutar ve ürünler içindir: sepet değişirse yeniden istenir.
  useEffect(() => { setTermsAccepted(false); }, [grandTotal, paymentMethod, fulfillment]);

  const placeOrder = async (expectedTotalCents: number = grandTotal) => {
    if (!requireAuth()) return;
    if (!sellerId || items.length === 0) return;
    if (!termsAccepted) {
      Alert.alert('Onay gerekli', 'Sipariş için ön bilgilendirmeyi ve satış sözleşmesini onayla.');
      return;
    }
    if (!pickup && !address.trim()) {
      Alert.alert('Adres gerekli', 'Teslimat adresini yaz.');
      return;
    }
    if (timeMode === 'later' && !scheduledFor) {
      Alert.alert('Saat seç', 'Siparişin için bir gün ve saat seç.');
      return;
    }
    if (tipInvalid) {
      Alert.alert('Bahşiş tutarı', `Bahşişi 15 veya 15,50 biçiminde, en çok ${priceTL(MAX_TIP_CENTS)} olarak yaz.`);
      return;
    }

    setLoading(true);
    try {
      if (await phoneVerificationNeeded()) {
        setPhoneModal(true);
        return;
      }
      // Satıcı ayarları sepet açıkken değişmiş olabilir: kararlar güncel kayıtla verilir.
      const currentSeller = (await fetchSellerById(sellerId).catch(() => null)) ?? seller;
      if (currentSeller) setSeller(currentSeller);
      const currentMinimum = sellerPricing(currentSeller, platformPricing).minOrderCents;
      if (totalCents < currentMinimum) {
        Alert.alert('Minimum sipariş tutarı', `Bu satıcıdan en az ${priceTL(currentMinimum)} sipariş verebilirsin.`);
        return;
      }

      // Sipariş sunucuda oluşturulur: fiyat, teslimat ücreti, kupon, stok ve komisyon
      // `place_order` içinde hesaplanır. İstemci yalnızca seçimleri gönderir.
      if (session?.userId) {
        // Gelip almada adresi sunucu yazar, burada gönderilen yok sayılır.
        const fullAddress = pickup ? '' : addressFloor ? `${address.trim()}, ${addressFloor.trim()}` : address.trim();
        let deliveryCoords = null;
        if (!pickup && currentSeller && sellerHasLocation(currentSeller)) {
          deliveryCoords = await resolveDeliveryCoords(address.trim(), currentSeller);
          if (!deliveryCoords) {
            Alert.alert(
              'Adres bulunamadı',
              'Teslimat alanını kontrol edebilmemiz için adresini daha açık yaz veya konum izni ver.',
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
          termsVersion: SALES_TERMS_VERSION,
          fulfillment,
          scheduledFor,
          tipCents,
        });

        if (paymentMethod === 'online') {
          const payment = await payOrderOnline(order.id);
          if (payment === 'unknown') {
            // Sonuç bilinmiyor: sepet durursa müşteri tekrar sipariş verip iki kez ödeyebilir.
            Alert.alert('Ödeme doğrulanamadı', 'Ödemenin sonucunu şu an göremiyoruz. Siparişlerim ekranından kontrol et.');
            clearCart();
            router.replace('/(customer)/orders');
            return;
          }
          if (payment === 'not_paid') {
            Alert.alert(
              'Ödeme tamamlanmadı',
              'Ödemen onaylanmadı ve siparişin iptal edildi. Kartından çekim yapıldıysa otomatik olarak iade sürecine alınır.',
            );
            return;
          }
        }

        // Track order count and maybe prompt for app review
        trackOrderAndMaybeReview();
      }
      setShowSuccess(true);
    } catch (err: any) {
      if (err?.code === PHONE_NOT_VERIFIED) {
        setPhoneModal(true);
        return;
      }
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
      Alert.alert('Sipariş hatası', err?.message ?? 'Sipariş oluşturulamadı. Tekrar dene.');
    } finally {
      setLoading(false);
    }
  };

  const handleSuccessDone = () => {
    setShowSuccess(false);
    clearCart();
    setFulfillment('delivery');
    setTimeMode('now');
    setScheduledIso(null);
    setTipChoice(0);
    setCustomTip('');
    router.replace('/(customer)/orders');
  };

  // ── Boş sepet
  if (items.length === 0 && !showSuccess) {
    return (
      <View style={[st.safe, { backgroundColor: t.background }]}>
        <TopBar title="Sepetin" back />
        <View style={st.emptyWrap}>
          <View style={[st.emptyCircle, { backgroundColor: t.surface }]}>
            <Ionicons name="bag-outline" size={40} color={t.heading} />
          </View>
          <Text style={[st.emptyTitle, { color: t.heading }]}>Sofra henüz boş</Text>
          <Text style={[st.emptySub, { color: t.textSecondary }]}>
            Yakınındaki restoranlara bak, menülere göz at.
          </Text>
          <View>
            <Button label="Restoranlara bak" size="lg" onPress={() => router.push('/(customer)')} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <SuccessModal
        visible={showSuccess}
        pickup={pickup}
        onDone={handleSuccessDone}
        onShare={() => {
          const name = sellerInfo?.name ?? 'Satıcı';
          const titles = items.map(i => i.title);
          shareOrder(name, titles);
        }}
      />

      <TopBar
        title="Sepetin"
        subtitle={sellerInfo ? (pickup ? `${sellerInfo.name} · Gelip al` : `${sellerInfo.name} · ${sellerInfo.deliveryTime} dk`) : undefined}
        back
        right={
          <TopIconButton
            icon="trash-outline"
            label="Sepeti temizle"
            onPress={() =>
              Alert.alert('Sepeti temizle', 'Tüm ürünler silinecek.', [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Temizle', style: 'destructive', onPress: clearCart },
              ])
            }
          />
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={isDesktop ? st.cols : undefined}>
          <View style={isDesktop ? st.colMain : undefined}>
          {/* ═══ ÜRÜNLER ═══ */}
          <View style={st.section}>
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
              style={st.addMoreBtn}
              onPress={() => sellerId && router.push(`/(customer)/seller/${sellerId}` as any)}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={t.text} />
              <Text style={[st.linkText, { color: t.text }]}>Daha fazla ürün ekle</Text>
            </Pressable>
          </View>

          {/* ═══ TESLİM ŞEKLİ ═══ */}
          {pickupAvailable ? (
            <View style={st.section}>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <Text style={[st.sectionTitle, st.paymentTitle, { color: t.text }]}>Teslim şekli</Text>
                <View style={st.chipRow} accessibilityRole="radiogroup">
                  <OptionChip label="Teslimat" icon="bicycle-outline" on={!pickup} onPress={() => chooseFulfillment('delivery')} />
                  <OptionChip label="Gelip al" icon="bag-handle-outline" on={pickup} onPress={() => chooseFulfillment('pickup')} />
                </View>
              </View>
            </View>
          ) : null}

          {/* ═══ TESLİMAT ADRESİ ═══ */}
          <View style={st.section}>
            {pickup ? (
              <View style={[st.addrCard, { backgroundColor: t.surface }]}>
                <Ionicons name="bag-handle-outline" size={20} color={t.text} />
                <View style={st.addrCardBody}>
                  <Text style={[st.addrCardLabel, { color: t.textSecondary }]}>Gelip alacağın restoran</Text>
                  <Text style={[st.addrCardValue, { color: t.text }]} numberOfLines={3}>
                    {sellerAddress(seller) || seller?.display_name || 'Restoran'}
                  </Text>
                </View>
                {mapsUrl(seller) ? (
                  <Pressable
                    style={st.link}
                    onPress={() => { Linking.openURL(mapsUrl(seller) as string).catch(() => {}); }}
                    accessibilityRole="link"
                    accessibilityLabel="Restoranı haritada aç"
                  >
                    <Text style={[st.linkText, { color: t.text }]}>Haritada aç</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : address.trim() && !editingAddress ? (
              <View style={[st.addrCard, { backgroundColor: t.surface }]}>
                <Ionicons name="location-outline" size={20} color={t.text} />
                <View style={st.addrCardBody}>
                  <Text style={[st.addrCardLabel, { color: t.textSecondary }]}>Teslimat adresi</Text>
                  <Text style={[st.addrCardValue, { color: t.text }]} numberOfLines={2}>
                    {address}{addressFloor ? ` · ${addressFloor}` : ''}
                  </Text>
                </View>
                <Pressable style={st.link} onPress={() => setEditingAddress(true)} accessibilityRole="button" accessibilityLabel="Teslimat adresini değiştir">
                  <Text style={[st.linkText, { color: t.text }]}>Değiştir</Text>
                </Pressable>
              </View>
            ) : (
            <View style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.addrHeaderRow}>
              <Text style={[st.sectionTitle, { color: t.text }]}>Teslimat adresi</Text>
              <Pressable style={st.link} onPress={() => router.push('/(customer)/addresses' as any)} accessibilityRole="button">
                <Text style={[st.linkText, { color: t.text }]}>Adreslerim</Text>
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
                      style={[st.addrChip, { backgroundColor: selected ? t.accent : t.background }]}
                      onPress={() => {
                        setAddress(addr.addressLine);
                        setAddressFloor(addr.floor || '');
                        setDefault(addr.id);
                        setEditingAddress(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${addr.label}, ${addr.addressLine}`}
                    >
                      <Ionicons name={addr.label === 'Ev' ? 'home-outline' : addr.label === 'İş' ? 'business-outline' : 'location-outline'} size={18} color={selected ? t.onAccent : t.text} />
                      <View style={st.addrChipInfo}>
                        <Text style={[st.addrChipLabel, { color: selected ? t.onAccent : t.text }]}>
                          {addr.label}
                        </Text>
                        <Text style={[st.addrChipAddr, { color: selected ? t.onAccent : t.textSecondary }]} numberOfLines={1}>
                          {addr.addressLine}
                        </Text>
                      </View>
                      {selected && <Ionicons name="checkmark" size={16} color={t.onAccent} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <TextInput
              style={[st.addressInput, { backgroundColor: t.background, color: t.text }]}
              onFocus={() => setEditingAddress(true)}
              value={address}
              onChangeText={setAddress}
              placeholder="Mahalle, sokak, bina no..."
              placeholderTextColor={t.textMuted}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              accessibilityLabel="Teslimat adresi"
            />
            <TextInput
              style={[st.floorInput, { backgroundColor: t.background, color: t.text }]}
              value={addressFloor}
              onChangeText={setAddressFloor}
              placeholder="Kat / Daire no (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Kat ve daire numarası"
            />
            {address.trim() ? (
              <Pressable style={st.addrDone} onPress={() => setEditingAddress(false)} accessibilityRole="button">
                <Text style={[st.linkText, { color: t.text }]}>Tamam</Text>
              </Pressable>
            ) : null}
            </View>
            )}
          </View>

          {/* ═══ NE ZAMAN ═══ */}
          {scheduleAvailable ? (
            <View style={st.section}>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <Text style={[st.sectionTitle, st.paymentTitle, { color: t.text }]}>Ne zaman?</Text>
                <View style={st.chipRow} accessibilityRole="radiogroup">
                  <OptionChip label="Şimdi" on={timeMode === 'now'} disabled={!openNow} onPress={() => setTimeMode('now')} />
                  <OptionChip label="İleri tarih" icon="calendar-outline" on={timeMode === 'later'} onPress={() => setTimeMode('later')} />
                </View>
                {!openNow ? (
                  <Text style={[st.optionHint, { color: t.textSecondary }]}>Restoran şu an kapalı, ileri bir saat seçebilirsin.</Text>
                ) : null}
                {timeMode === 'later' ? (
                  days.length === 0 ? (
                    <Text style={[st.optionHint, { color: t.textSecondary }]}>Şu an seçilebilecek bir saat yok.</Text>
                  ) : (
                    <>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.scheduleRow}>
                        {days.map(day => (
                          <OptionChip
                            key={day.dateKey}
                            label={day.label}
                            on={selectedDay?.dateKey === day.dateKey}
                            onPress={() => { setScheduleDayKey(day.dateKey); setScheduledIso(null); }}
                          />
                        ))}
                      </ScrollView>
                      <View style={st.slotGrid}>
                        {selectedDay?.slots.map(slot => (
                          <OptionChip
                            key={slot.iso}
                            label={slot.time}
                            on={scheduledIso === slot.iso}
                            onPress={() => setScheduledIso(slot.iso)}
                          />
                        ))}
                      </View>
                      <Text style={[st.optionHint, { color: t.textSecondary }]}>
                        Restoran siparişini 30 dakika içinde onaylar. Yanıt gelmezse sipariş iptal olur.
                      </Text>
                    </>
                  )
                ) : null}
              </View>
            </View>
          ) : null}

          {/* ═══ SİPARİŞ NOTU ═══ */}
          <View style={st.section}>
            <TextInput
              style={[st.noteInput, { backgroundColor: t.surface, color: t.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Satıcıya notun (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Satıcıya not"
            />
          </View>

          {/* ═══ ÖDEME YÖNTEMİ ═══ */}
          <View style={st.section}>
            <View style={[st.card, { backgroundColor: t.surface }]}>
              <Text style={[st.sectionTitle, st.paymentTitle, { color: t.text }]}>Ödeme yöntemi</Text>
              <View style={st.paymentList}>
                {paymentOptions.map((opt) => {
                  const active = paymentMethod === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      style={[st.paymentOption, paymentWide && st.paymentOptionWide, { backgroundColor: active ? t.accent : t.background }]}
                      onPress={() => setPaymentMethod(opt.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityHint={pickup && opt.id !== 'online' ? 'Restoranda kasada ödersin' : opt.desc}
                    >
                      <Ionicons name={opt.icon} size={16} color={active ? t.onAccent : t.text} />
                      <Text style={[st.paymentLabel, { color: active ? t.onAccent : t.text }, active && st.paymentLabelActive]} numberOfLines={2}>
                        {opt.id === 'online' ? 'Online' : paymentLabel(opt.id, fulfillment)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {acceptedCards.length > 0 ? (
                <Text style={[st.optionHint, { color: t.textSecondary }]}>Geçen yemek kartları: {acceptedCards.join(', ')}</Text>
              ) : null}
            </View>
          </View>

          {/* ═══ BAHŞİŞ ═══ */}
          {!pickup ? (
            <View style={st.section}>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <Text style={[st.sectionTitle, { color: t.text }]}>Bahşiş</Text>
                <Text style={[st.optionHint, st.tipSub, { color: t.textSecondary }]}>Tamamı restorana ve kuryeye kalır, komisyon alınmaz.</Text>
                <View style={st.chipRow} accessibilityRole="radiogroup">
                  <OptionChip label="Yok" on={tipChoice === 0} onPress={() => setTipChoice(0)} />
                  {TIP_PRESETS_CENTS.map(cents => (
                    <OptionChip key={cents} label={`₺${cents / 100}`} on={tipChoice === cents} onPress={() => setTipChoice(cents)} />
                  ))}
                  <OptionChip label="Diğer" on={tipChoice === 'custom'} onPress={() => setTipChoice('custom')} />
                </View>
                {tipChoice === 'custom' ? (
                  <>
                    <TextInput
                      style={[st.floorInput, st.tipInput, { backgroundColor: t.background, color: t.text }]}
                      value={customTip}
                      onChangeText={setCustomTip}
                      placeholder="Tutar (₺)"
                      placeholderTextColor={t.textMuted}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Bahşiş tutarı"
                    />
                    {tipInvalid ? (
                      <Text style={[st.optionHint, { color: t.danger }]}>Bahşiş en çok {priceTL(MAX_TIP_CENTS)} olabilir, 15 veya 15,50 biçiminde yaz.</Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* ═══ PROMOSYON KODU ═══ */}
          <View style={st.section}>
            {appliedCoupon ? (
              <View style={[st.promoRow, { backgroundColor: t.surface }]}>
                <Text style={[st.promoCode, { color: t.text }]} numberOfLines={1}>{appliedCoupon.code}</Text>
                <View style={[st.promoChip, { backgroundColor: t.accent }]}>
                  <Ionicons name="checkmark" size={16} color={t.onAccent} />
                  <Text style={[st.promoChipText, { color: t.onAccent }]} numberOfLines={1}>Kupon uygulandı</Text>
                </View>
                <Pressable style={st.promoRemove} onPress={removePromo} accessibilityRole="button" accessibilityLabel="Kuponu kaldır">
                  <Ionicons name="close" size={20} color={t.textSecondary} />
                </Pressable>
              </View>
            ) : (
              <View style={[st.promoRow, { backgroundColor: t.surface }]}>
                <TextInput
                  style={[st.promoInput, { color: t.text }]}
                  value={promoCode}
                  onChangeText={setPromoCode}
                  placeholder="Kupon kodu"
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="characters"
                  accessibilityLabel="Kupon kodu"
                />
                <Button label="Uygula" size="sm" onPress={applyPromo} disabled={!promoCode.trim()} />
              </View>
            )}
            <Pressable style={st.couponsLink} onPress={() => router.push('/(customer)/campaign' as any)} accessibilityRole="button">
              <Text style={[st.linkText, { color: t.text }]}>Kuponları gör</Text>
            </Pressable>
          </View>

          </View>
          <View style={isDesktop ? [st.colSide, { backgroundColor: t.surface }] : undefined}>
          {isDesktop ? <Text style={[st.sideTitle, { color: t.heading }]}>Sipariş özeti</Text> : null}
          {/* ═══ SİPARİŞ ÖZETİ ═══ */}
          <View style={[st.summaryCard, !isDesktop && [st.summaryCardPhone, { backgroundColor: t.surface }]]}>
            <View style={st.summaryRow}>
              <Text style={[st.summaryLabel, { color: t.textSecondary }]}>Ara toplam</Text>
              <Text style={[st.summaryValue, { color: t.text }]}>{priceTL(totalCents)}</Text>
            </View>
            <View style={st.summaryRow}>
              <Text style={[st.summaryLabel, { color: t.textSecondary }]}>{pickup ? 'Teslim' : 'Teslimat'}</Text>
              {pickup ? (
                <Text style={[st.summaryValue, { color: t.text }]}>Gelip alacaksın</Text>
              ) : isFreeDelivery ? (
                <View style={st.freeRow}>
                  {pricing.deliveryFeeCents > 0 && <Text style={[st.strikePrice, { color: t.textMuted }]}>{priceTL(pricing.deliveryFeeCents)}</Text>}
                  <Text style={[st.summaryValue, { color: t.success }]}>Ücretsiz</Text>
                </View>
              ) : (
                <Text style={[st.summaryValue, { color: t.text }]}>{priceTL(deliveryFee)}</Text>
              )}
            </View>
            {discountCents > 0 && (
              <View style={st.summaryRow}>
                <Text style={[st.summaryLabel, { color: t.textSecondary }]}>İndirim ({appliedCoupon?.code})</Text>
                <Text style={[st.summaryValue, { color: t.text }]}>-{priceTL(discountCents)}</Text>
              </View>
            )}
            {couponFreeDelivery && deliveryFee === 0 && (
              <View style={st.summaryRow}>
                <Text style={[st.summaryLabel, { color: t.textSecondary }]}>Ücretsiz teslimat</Text>
                <Text style={[st.summaryValue, { color: t.text }]}>Kupon ile</Text>
              </View>
            )}
            {tipCents > 0 && (
              <View style={st.summaryRow}>
                <Text style={[st.summaryLabel, { color: t.textSecondary }]}>Bahşiş</Text>
                <Text style={[st.summaryValue, { color: t.text }]}>{priceTL(tipCents)}</Text>
              </View>
            )}
            {scheduledFor && (
              <View style={st.summaryRow}>
                <Text style={[st.summaryLabel, { color: t.textSecondary }]}>Zaman</Text>
                <Text style={[st.summaryValue, { color: t.text }]}>{plannedLabel(scheduledFor, clock)}</Text>
              </View>
            )}
            {!pickup && !isFreeDelivery && pricing.freeDeliveryThresholdCents > totalCents && (
              <View style={[st.hint, { backgroundColor: t.background }]}>
                <Text style={[st.hintText, { color: t.text }]}>
                  {priceTL(pricing.freeDeliveryThresholdCents - totalCents)} daha ekle, teslimat bizden.
                </Text>
              </View>
            )}
            {belowMinimum && (
              <View style={[st.hint, { backgroundColor: t.background }]}>
                <Text style={[st.hintText, { color: t.text }]}>
                  Minimum sipariş {priceTL(pricing.minOrderCents)}: {priceTL(pricing.minOrderCents - totalCents)} daha ekle.
                </Text>
              </View>
            )}
            <View style={[st.totalRow, { borderTopColor: t.divider }]}>
              <Text style={[st.totalText, { color: t.text }]}>Toplam</Text>
              <Text style={[st.totalText, { color: t.text }]}>{priceTL(grandTotal)}</Text>
            </View>
          </View>

          <View style={[st.card, st.termsCard, { backgroundColor: t.surface }]}>
            <Text style={[st.termsTitle, { color: t.heading }]}>Ön bilgilendirme</Text>
            <Text style={[st.termsLine, { color: t.textSecondary }]}>
              Satıcı: {seller?.display_name ?? 'Satıcı'}{'\n'}
              Ürünler: {items.reduce((sum, i) => sum + i.quantity, 0)} adet, {pickup ? 'gelip alma, toplam' : tipCents > 0 ? 'teslimat ve bahşiş dahil' : 'teslimat dahil'} {priceTL(grandTotal)}{'\n'}
              {scheduledFor ? `${plannedLabel(scheduledFor, clock)}\n` : ''}
              Yemek çabuk bozulan bir ürün olduğu için cayma hakkı yok. Sorun olursa siparişten iade talebi açabilirsin.
            </Text>
            <Pressable
              style={st.termsRow}
              onPress={() => setTermsAccepted(v => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
              accessibilityLabel="Ön bilgilendirmeyi ve mesafeli satış sözleşmesini onaylıyorum"
            >
              <View style={[st.termsBox, { borderColor: termsAccepted ? t.primary : t.surfaceBorder, backgroundColor: termsAccepted ? t.primary : t.surface }]}>
                {termsAccepted ? <Ionicons name="checkmark" size={14} color={t.onBrand} /> : null}
              </View>
              <Text style={[st.termsLine, st.termsRowText, { color: t.text }]}>
                <Text style={st.termsLink} onPress={() => router.push('/(customer)/sales-terms' as any)} accessibilityRole="link">Ön bilgilendirmeyi ve mesafeli satış sözleşmesini</Text>
                {' okudum, onaylıyorum.'}
              </Text>
            </Pressable>
          </View>
          {isDesktop ? (
            <View style={st.sideOrder}>
              <Button label="Siparişi onayla" size="lg" fullWidth loading={loading} disabled={!termsAccepted} onPress={() => placeOrder()} />
            </View>
          ) : null}
          </View>
          </View>
        </ScrollView>

        {/* ═══ ALT ÇUBUK ═══ */}
        {!isDesktop ? (
        <View style={[st.bottomBar, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <View>
            <Text style={[st.bottomLabel, { color: t.textSecondary }]}>Toplam</Text>
            <Text style={[st.bottomTotal, { color: t.text }]}>{priceTL(grandTotal)}</Text>
          </View>
          <View style={st.bottomAction}>
            <Button label="Siparişi onayla" size="lg" fullWidth loading={loading} disabled={!termsAccepted} onPress={() => placeOrder()} />
          </View>
        </View>
        ) : null}
      </KeyboardAvoidingView>
      <PhoneVerifyModal
        visible={phoneModal}
        onClose={() => setPhoneModal(false)}
        onVerified={() => { setPhoneModal(false); placeOrder(); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  termsCard: { gap: 10 },
  termsTitle: { fontSize: 15, fontFamily: fonts.bold },
  termsLine: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44, paddingTop: 4 },
  termsRowText: { flex: 1 },
  termsLink: { fontFamily: fonts.semibold, textDecorationLine: 'underline' },
  termsBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  safe: { flex: 1 },

  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  section: { marginBottom: 10 },
  card: { borderRadius: 16, padding: 12 },
  sectionTitle: { fontSize: 14, fontFamily: fonts.bold },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 13, fontFamily: fonts.bold },

  // Cart items
  itemsList: { gap: 10 },
  cartItem: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12 },
  cartItemInfo: { flex: 1, minWidth: 0 },
  cartItemTitle: { fontSize: 14, fontFamily: fonts.bold },
  cartItemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  cartItemTotal: { fontSize: 15, fontFamily: fonts.extrabold },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 10 },
  // Görünen şerit 36, dokunma alanı 44 yüksekliğinde kalır.
  stepBtn: { width: 44, height: 44, marginVertical: -4, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 13, fontFamily: fonts.bold, minWidth: 16, textAlign: 'center' },

  addMoreBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 44, marginTop: 2 },

  // Address
  addrCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 12 },
  addrCardBody: { flex: 1, minWidth: 0 },
  addrCardLabel: { fontSize: 12, fontFamily: fonts.regular },
  addrCardValue: { fontSize: 14, fontFamily: fonts.semibold },
  addrHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  addrChipsRow: { gap: 8, marginBottom: 12 },
  addrChip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, minWidth: 140, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  addrChipInfo: { flexShrink: 1, maxWidth: 130 },
  addrChipLabel: { fontSize: 12, fontFamily: fonts.bold },
  addrChipAddr: { fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
  addressInput: { borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 14, minHeight: 60, marginBottom: 8 },
  floorInput: { borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 14 },
  addrDone: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },

  // Notes
  noteInput: { borderRadius: 16, paddingHorizontal: 14, minHeight: 48, fontFamily: fonts.regular, fontSize: 14 },

  // Payment
  paymentTitle: { marginBottom: 10 },
  paymentList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentOption: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  paymentOptionWide: { flex: 0, flexGrow: 1, flexBasis: '47%' },
  paymentLabel: { flexShrink: 1, fontSize: 13, fontFamily: fonts.semibold, textAlign: 'center' },
  paymentLabelActive: { fontFamily: fonts.bold },

  // Teslim şekli, zaman, bahşiş
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scheduleRow: { gap: 8, paddingTop: 10 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  optionChip: { height: 40, minWidth: 44, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  optionChipOff: { opacity: 0.5 },
  optionChipText: { fontSize: 13, fontFamily: fonts.bold },
  optionHint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 8 },
  tipSub: { marginTop: 2, marginBottom: 10 },
  tipInput: { marginTop: 8 },

  // Promo
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, paddingVertical: 6, paddingRight: 6, paddingLeft: 14, minHeight: 56 },
  promoInput: { flex: 1, minWidth: 0, minHeight: 44, padding: 0, fontFamily: fonts.regular, fontSize: 14 },
  promoCode: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.bold },
  promoChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 10 },
  promoChipText: { fontSize: 13, fontFamily: fonts.bold },
  promoRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  couponsLink: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },

  // Summary
  summaryCard: { gap: 8 },
  summaryCardPhone: { borderRadius: 16, padding: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryLabel: { flexShrink: 1, fontSize: 14, fontFamily: fonts.regular },
  summaryValue: { fontSize: 14, fontFamily: fonts.semibold },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  strikePrice: { fontFamily: fonts.regular, fontSize: 12, textDecorationLine: 'line-through' },
  hint: { borderRadius: 10, padding: 10, alignItems: 'center' },
  hintText: { fontSize: 12, fontFamily: fonts.semibold, textAlign: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingTop: 8 },
  totalText: { fontSize: 17, fontFamily: fonts.extrabold },
  disclaimer: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 11, marginTop: 12 },

  // Bottom bar
  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  bottomLabel: { fontSize: 12, fontFamily: fonts.regular },
  bottomTotal: { fontSize: 20, lineHeight: 25, fontFamily: fonts.extrabold },
  bottomAction: { flex: 1, minWidth: 0 },

  // Desktop
  cols: { flexDirection: 'row', alignItems: 'flex-start', gap: 32 },
  colMain: { flex: 1, minWidth: 0 },
  colSide: { width: 360, borderRadius: 16, padding: 16, position: 'sticky' as any, top: 16 },
  sideTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.4, marginBottom: 12 },
  sideOrder: { marginTop: 12 },

  // Empty state
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyCircle: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4, marginBottom: 6 },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center', marginBottom: 20 },

  // Success Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: Math.min(SCREEN_W - 48, 420), borderRadius: 24, padding: 28, alignItems: 'center' },
  modalTitle: { fontSize: 24, fontFamily: fonts.display, marginBottom: 8 },
  modalBody: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalSteps: { flexDirection: 'row', alignItems: 'center', marginBottom: 28, gap: 4 },
  modalStep: { alignItems: 'center', gap: 6 },
  modalStepDot: { width: 12, height: 12, borderRadius: 6 },
  modalStepText: { fontSize: 9, fontFamily: fonts.medium },
  modalStepLine: { width: 20, height: 2, marginBottom: 18 },
  modalShareBtn: { marginTop: 8, minHeight: 44, justifyContent: 'center' },
  modalShareText: { fontSize: 14, fontFamily: fonts.semibold },
});
