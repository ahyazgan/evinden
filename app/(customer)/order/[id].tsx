import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { cancelOrder, fetchCustomerOrders, fetchSellersByIds, type OrderWithItems, type SellerRow } from '@/lib/db';
import { fetchConversations } from '@/lib/messages';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { NAV_HEIGHT, useResponsive } from '@/lib/responsive';

/** Ekrandaki dört adım: alındı, ocakta, yolda, teslim */
const PROGRESS_ICONS: (keyof typeof Ionicons.glyphMap)[] = ['receipt-outline', 'flame-outline', 'bicycle-outline', 'checkmark'];

/** Sipariş durumunun kaçıncı adımda olduğu; ödeme bekleyen ve iptal edilen siparişte adım yok */
const PROGRESS_STEP: Record<string, number> = { pending: 0, accepted: 0, preparing: 1, ready: 2, delivered: 3 };

/** Temadaki karşılığı olmayan, onaylı tasarımdan gelen renkler */
const MAP_BASE = '#E9EAE6';
const MAP_BLOCK = '#DDDFD9';
const STEP_PENDING_LINE = '#59605B';
const STEP_PENDING_ICON = '#8B938D';

const STEP_DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const MESSAGES: Record<string, string> = {
  awaiting_payment: 'Ödemen bekleniyor.',
  pending: 'Siparişin mutfağa ulaştı. Onay bekliyor.',
  accepted: 'Mutfak siparişini aldı.',
  preparing: 'Yemeğin ocakta. Hazır olunca yola çıkacak.',
  ready: 'Yemeğin yola çıktı, sofrayı kur.',
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

/** Temsili rota: canlı konum göstermez. */
function RouteIllustration({ height }: { height: number }) {
  const { colors: t } = useTheme();
  return (
    <Svg width="100%" height={height} viewBox="0 0 390 600" preserveAspectRatio="xMidYMid slice">
      <Rect width="390" height="600" fill={MAP_BASE} />
      <G fill={MAP_BLOCK}>
        <Rect x="20" y="118" width="96" height="86" rx="6" />
        <Rect x="150" y="96" width="86" height="108" rx="6" />
        <Rect x="270" y="130" width="110" height="74" rx="6" />
        <Rect x="-10" y="240" width="126" height="98" rx="6" />
        <Rect x="150" y="240" width="86" height="60" rx="6" />
        <Rect x="270" y="240" width="110" height="118" rx="6" />
        <Rect x="20" y="372" width="96" height="110" rx="6" />
        <Rect x="150" y="334" width="86" height="148" rx="6" />
        <Rect x="270" y="392" width="110" height="90" rx="6" />
      </G>
      <G stroke={t.surface} strokeWidth="12" fill="none">
        <Path d="M133 0v600M253 0v600" />
        <Path d="M0 222h390M0 356h116M116 356h154M270 376h120" />
      </G>
      <Path d="M253 150V222H133V356" fill="none" stroke={t.brand} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="133" cy="356" r="11" fill={t.accent} stroke={t.onAccent} strokeWidth="5" />
      <Circle cx="253" cy="136" r="19" fill={t.surface} stroke={t.brand} strokeWidth="5" />
      <Path d="m245 136 8-6 8 6v9h-16v-9Z" fill={t.brand} />
    </Svg>
  );
}

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { colors: t } = useTheme();
  const { isDesktop, height } = useResponsive();
  const focused = useIsFocused();
  const desktopHeight = height - NAV_HEIGHT;
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

  return (
    <View style={[s.root, isDesktop && s.rootDesktop, { backgroundColor: MAP_BASE }]}>
      {statusBar}
      <View
        style={isDesktop ? s.mapDesktop : s.map}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Mutfaktan adresine giden temsili rota"
      >
        <RouteIllustration height={isDesktop ? desktopHeight : MAP_HEIGHT} />
      </View>

      <View style={[s.top, { top: insets.top + 8 }, isDesktop && s.topDesktop]}>
        <Pressable style={[s.backBtn, { backgroundColor: t.brand }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={18} color={t.onBrand} />
          <Text style={[s.backText, { color: t.onBrand }]}>Geri</Text>
        </Pressable>
        <View style={[s.mapTag, { backgroundColor: t.surface }]}>
          <Text style={[s.mapTagText, { color: t.textSecondary }]}>Temsili rota</Text>
        </View>
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

const MAP_HEIGHT = 600;

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyTitle: { fontSize: 22, fontFamily: fonts.display },
  map: { position: 'absolute', top: 0, left: 0, right: 0, height: MAP_HEIGHT },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  backBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { fontSize: 14, fontFamily: fonts.semibold },
  mapTag: { height: 28, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mapTagText: { fontSize: 12, fontFamily: fonts.semibold },
  helpBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  helpText: { fontSize: 14, fontFamily: fonts.semibold },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '72%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 16 },
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
  mapDesktop: { flex: 1, overflow: 'hidden' },
  topDesktop: { right: 436 },
  sheetDesktop: { width: 420, borderTopLeftRadius: 24, paddingTop: 20, paddingHorizontal: 16 },
});
