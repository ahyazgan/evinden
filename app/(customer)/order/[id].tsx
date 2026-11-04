import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { CourierLocationCard } from '@/components/shared/CourierLocationCard';
import { CourierMap } from '@/components/shared/CourierMap';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { cancelOrder, fetchCustomerOrders, fetchSellersByIds, type OrderWithItems, type SellerRow } from '@/lib/db';
import { fetchConversations } from '@/lib/messages';
import { courierStatusLine } from '@/lib/courier-format';
import { useCourierLocation, useDeliveryPoint } from '@/lib/courier-location';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { useResponsive } from '@/lib/responsive';
import { coordsDistanceKm, nearbyPoint } from '@/lib/geo';

/** Ekrandaki dört adım: alındı, ocakta, yolda, teslim */
const PROGRESS_ICONS: (keyof typeof Ionicons.glyphMap)[] = ['receipt-outline', 'flame-outline', 'bicycle-outline', 'checkmark'];

/** Sipariş durumunun kaçıncı adımda olduğu; ödeme bekleyen ve iptal edilen siparişte adım yok */
const PROGRESS_STEP: Record<string, number> = { pending: 0, accepted: 0, preparing: 1, ready: 1, out_for_delivery: 2, delivered: 3 };

/** Haritanın üstündeki geri ve yardım düğmelerinin kapladığı yükseklik */
const TOP_BUTTONS_HEIGHT = 60;

/** Kurye yola çıkmadan önce üst alanda gösterilen durum; rota gibi görünmez. */
const STATUS_HERO: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  awaiting_payment: { icon: 'card-outline', label: 'Ödeme bekleniyor' },
  pending: { icon: 'receipt-outline', label: 'Onay bekleniyor' },
  accepted: { icon: 'receipt-outline', label: 'Sipariş alındı' },
  preparing: { icon: 'flame-outline', label: 'Hazırlanıyor' },
  ready: { icon: 'bag-check-outline', label: 'Hazır, yola çıkmak üzere' },
  delivered: { icon: 'checkmark', label: 'Teslim edildi' },
  cancelled: { icon: 'close', label: 'İptal edildi' },
};

/** Temadaki karşılığı olmayan, onaylı tasarımdan gelen renkler */
const STEP_PENDING_LINE = '#59605B';
const STEP_PENDING_ICON = '#8B938D';

const STEP_DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const MESSAGES: Record<string, string> = {
  awaiting_payment: 'Ödemen bekleniyor.',
  pending: 'Siparişin restorana ulaştı. Onay bekliyor.',
  accepted: 'Restoran siparişini aldı.',
  preparing: 'Yemeğin ocakta. Hazır olunca yola çıkacak.',
  ready: 'Yemeğin hazır, birazdan yola çıkacak.',
  out_for_delivery: 'Yemeğin yola çıktı, sofrayı kur.',
  delivered: 'Teslim edildi. Afiyet olsun.',
  cancelled: 'Bu sipariş iptal edildi.',
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

/** Sipariş anından, satıcının en uzun teslimat süresine göre kalan dakika */
function remainingMinutes(order: OrderWithItems, seller: SellerRow | null): number {
  const total = seller?.delivery_time_max ?? 40;
  const passed = (Date.now() - new Date(order.created_at).getTime()) / 60000;
  return Math.max(0, Math.ceil(total - passed));
}

/** Sipariş anından, satıcının en uzun teslimat süresine göre tahmini saat */
function etaClock(order: OrderWithItems, seller: SellerRow | null): string {
  const total = seller?.delivery_time_max ?? 40;
  const eta = new Date(new Date(order.created_at).getTime() + total * 60000);
  return eta.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const focused = useIsFocused();
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!session?.userId || !id) { setLoading(false); return; }
    try {
      const orders = await fetchCustomerOrders(session.userId);
      const found = orders.find(o => o.id === id) ?? null;
      setOrder(found);
      if (found) {
        const sellers = await fetchSellersByIds([found.seller_id]).catch(() => []);
        setSeller(sellers[0] ?? null);
      }
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [session?.userId, id]);

  useEffect(() => { load(); }, [load]);

  const onTheRoad = order?.status === 'out_for_delivery';
  const courier = useCourierLocation(id, onTheRoad && focused);
  const deliveryPoint = useDeliveryPoint(order?.delivery_address, onTheRoad);

  useRealtimeOrders(session?.userId, 'customer', (payload) => {
    if (payload.eventType === 'UPDATE' && payload.new.id === id) {
      setOrder(prev => (prev ? { ...prev, status: payload.new.status } : prev));
    }
  });

  const openChat = async () => {
    if (!order) return;
    try {
      const conversations = await fetchConversations('customer');
      const existing = conversations.find(c => c.seller_id === order.seller_id);
      if (existing) { router.push(`/chat/${existing.id}` as any); return; }
    } catch {
      // Satıcı sayfasından yeni mesaj başlatılabilir.
    }
    router.push(`/(customer)/seller/${order.seller_id}` as any);
  };

  const confirmCancel = () => {
    if (!order) return;
    Alert.alert('Siparişi iptal et', 'Bu siparişi iptal etmek istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal et',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await cancelOrder(order.id);
            await load();
          } catch (err: any) {
            Alert.alert('İptal edilemedi', err?.message ?? 'Lütfen tekrar dene.');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  // Sekmeler bağlı kaldığı için koyu durum çubuğu yalnızca bu ekran açıkken geçerli.
  const statusBar = focused ? <StatusBar style="dark" /> : null;

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: t.background }]}>
        {statusBar}
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.center, { backgroundColor: t.background }]}>
        {statusBar}
        <Text style={[s.emptyTitle, { color: t.heading }]}>Sipariş bulunamadı</Text>
        <View>
          <Button label="Siparişlerime dön" size="lg" onPress={() => router.replace('/(customer)/orders' as any)} />
        </View>
      </View>
    );
  }

  const progress = PROGRESS_STEP[order.status] ?? -1;
  const minutes = remainingMinutes(order, seller);
  const name = seller?.display_name ?? 'Satıcı';

  const topInset = insets.top + TOP_BUTTONS_HEIGHT;
  const hero = STATUS_HERO[order.status];
  const liveLocation = courier.location && !courier.stale ? courier.location : null;
  const courierCoords = liveLocation ? { latitude: liveLocation.latitude, longitude: liveLocation.longitude } : null;
  // Adres yanlış yere çözüldüyse teslimat noktası da mesafe de gösterilmez.
  const destination = courierCoords ? nearbyPoint(courierCoords, deliveryPoint) : null;
  const courierKm = courierCoords && destination ? coordsDistanceKm(courierCoords, destination) : null;
  const courierLine = courierStatusLine(courier.location, courierKm, courier.now);

  return (
    <View style={[s.root, isDesktop && s.rootDesktop, { backgroundColor: t.background }]}>
      {statusBar}
      <View style={s.mapArea}>
        {onTheRoad && courierCoords ? (
          <CourierMap
            courier={courierCoords}
            destination={destination}
            line={courierLine}
            topInset={topInset}
          />
        ) : onTheRoad ? (
          <View style={[s.hero, { paddingTop: topInset }]}>
            <CourierLocationCard line={courierLine} />
          </View>
        ) : hero ? (
          <View style={[s.hero, { paddingTop: topInset }]}>
            <View style={[s.heroIcon, { backgroundColor: t.surface }]}>
              <Ionicons name={hero.icon} size={32} color={t.text} />
            </View>
            <Text style={[s.heroLabel, { color: t.heading }]}>{hero.label}</Text>
          </View>
        ) : null}
      </View>

      <View style={[s.top, { top: insets.top + 8 }, isDesktop && s.topDesktop]} pointerEvents="box-none">
        <Pressable style={[s.backBtn, { backgroundColor: t.brand }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={18} color={t.onBrand} />
          <Text style={[s.backText, { color: t.onBrand }]}>Geri</Text>
        </Pressable>
        <Pressable style={[s.helpBtn, { backgroundColor: t.surface }]} onPress={() => router.push({ pathname: '/(customer)/help', params: { orderId: String(id) } } as any)} accessibilityRole="button">
          <Text style={[s.helpText, { color: t.text }]}>Yardım</Text>
        </Pressable>
      </View>

      <View style={[isDesktop ? s.sheetDesktop : s.sheet, { backgroundColor: t.brand, paddingBottom: Math.max(insets.bottom, 26) + 8 }]}>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <Text style={[s.statusTitle, { color: t.onBrand }]} accessibilityRole="header">
            {order.status === 'delivered' ? 'Teslim edildi' : order.status === 'cancelled' ? 'İptal edildi' : minutes > 0 ? `Tahmini teslimat ${etaClock(order, seller)}` : 'Az kaldı'}
          </Text>
          <Text style={[s.message, { color: t.onBrandSoft }]}>{MESSAGES[order.status] ?? ''}</Text>

          {order.status !== 'cancelled' ? (
            <View
              style={[s.steps, { borderColor: t.panel }]}
              accessibilityRole="progressbar"
              accessibilityLabel={`Sipariş durumu: 4 adımın ${progress + 1}. adımı`}
            >
              {PROGRESS_ICONS.map((icon, i) => (
                <View key={icon} style={[s.stepItem, i < PROGRESS_ICONS.length - 1 && s.stepItemGrow]}>
                  <View style={s.stepIcon}>
                    <Ionicons name={icon} size={24} color={i <= progress ? t.accent : STEP_PENDING_ICON} />
                  </View>
                  {i < PROGRESS_ICONS.length - 1 ? (
                    <View style={s.stepLine}>
                      {STEP_DOTS.map(dot => (
                        <View key={dot} style={[s.stepDot, { backgroundColor: i < progress ? t.accent : STEP_PENDING_LINE }]} />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <View style={s.sellerRow}>
            <View style={[s.sellerAvatar, { backgroundColor: t.accent }]}>
              <Text style={[s.sellerAvatarText, { color: t.onAccent }]}>{name.charAt(0).toLocaleUpperCase('tr')}</Text>
            </View>
            <View style={s.sellerBody}>
              <Text style={[s.sellerName, { color: t.onBrand }]} numberOfLines={1}>{name}</Text>
              <Text style={[s.sellerLabel, { color: t.onBrandSoft }]}>Teslim edecek</Text>
            </View>
            {seller && seller.rating_count > 0 ? (
              <View style={s.rating}>
                <Ionicons name="star" size={15} color={t.accent} />
                <Text style={[s.ratingText, { color: t.onBrand }]}>{Number(seller.rating_avg).toFixed(1).replace('.', ',')}</Text>
              </View>
            ) : null}
            <Pressable style={[s.chatBtn, { backgroundColor: t.accent }]} onPress={openChat} accessibilityRole="button" accessibilityLabel="Mesaj gönder">
              <Ionicons name="chatbubble-outline" size={22} color={t.onAccent} />
            </Pressable>
          </View>

          <Pressable style={s.detailsRow} onPress={() => setShowDetails(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }}>
            <Text style={[s.detailsText, { color: t.onBrand }]}>Sipariş detayları</Text>
            <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={20} color={t.onBrandSoft} />
          </Pressable>

          {showDetails ? (
            <View style={s.details}>
              {order.order_items.map(item => (
                <View key={item.id} style={s.itemRow}>
                  <Text style={[s.itemText, { color: t.onBrand }]} numberOfLines={2}>{item.quantity}× {item.title_snapshot}</Text>
                  <Text style={[s.itemPrice, { color: t.onBrand }]}>{priceTL(item.unit_price_cents * item.quantity)}</Text>
                </View>
              ))}
              <View style={[s.itemRow, s.totalRow, { borderTopColor: t.panel }]}>
                <Text style={[s.totalText, { color: t.onBrand }]}>Toplam</Text>
                <Text style={[s.totalText, { color: t.onBrand }]}>{priceTL(order.total_cents)}</Text>
              </View>
              {order.delivery_address ? (
                <Text style={[s.address, { color: t.onBrandSoft }]}>{order.delivery_address}</Text>
              ) : null}
              {['pending', 'accepted'].includes(order.status) ? (
                <Pressable style={[s.cancelBtn, { backgroundColor: t.surface }]} onPress={confirmCancel} disabled={cancelling} accessibilityRole="button">
                  <Text style={[s.cancelText, { color: t.danger }]}>{cancelling ? 'İptal ediliyor…' : 'Siparişi iptal et'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyTitle: { fontSize: 22, fontFamily: fonts.display },
  mapArea: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 32 },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, textAlign: 'center' },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  backBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { fontSize: 14, fontFamily: fonts.semibold },
  helpBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  helpText: { fontSize: 14, fontFamily: fonts.semibold },
  sheet: { maxHeight: '72%', marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 16 },
  statusTitle: { textAlign: 'center', fontSize: 20, lineHeight: 26, fontFamily: fonts.display },
  message: { textAlign: 'center', fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, marginTop: 4 },
  steps: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1 },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepItemGrow: { flex: 1 },
  stepIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 },
  stepDot: { width: 3, height: 3, borderRadius: 1.5 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  sellerAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sellerAvatarText: { fontSize: 20, fontFamily: fonts.extrabold },
  sellerBody: { flex: 1, minWidth: 0 },
  sellerName: { fontSize: 15, fontFamily: fonts.bold },
  sellerLabel: { fontSize: 12, fontFamily: fonts.regular },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 14, fontFamily: fonts.bold },
  chatBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  detailsRow: { minHeight: 44, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsText: { fontSize: 14, fontFamily: fonts.bold },
  details: { gap: 8, paddingBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemText: { flex: 1, fontSize: 14, fontFamily: fonts.regular },
  itemPrice: { fontSize: 14, fontFamily: fonts.semibold },
  totalRow: { borderTopWidth: 1, paddingTop: 8 },
  totalText: { fontSize: 14, fontFamily: fonts.bold },
  address: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  cancelBtn: { minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelText: { fontSize: 14, fontFamily: fonts.bold },
  rootDesktop: { flexDirection: 'row' },
  topDesktop: { right: 436 },
  sheetDesktop: { width: 420, borderTopLeftRadius: 24, paddingTop: 20, paddingHorizontal: 16 },
});
