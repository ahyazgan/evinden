import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { cancelOrder, fetchCustomerOrders, fetchSellersByIds, type OrderWithItems, type SellerRow } from '@/lib/db';
import { fetchConversations } from '@/lib/messages';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { NAV_HEIGHT, useResponsive } from '@/lib/responsive';

const STEPS = ['pending', 'accepted', 'preparing', 'ready', 'delivered'];

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

/** Temsili rota: canlı konum göstermez. */
function RouteIllustration({ height }: { height: number }) {
  return (
    <Svg width="100%" height={height} viewBox="0 0 390 480" preserveAspectRatio="xMidYMid slice">
      <Rect width="390" height="480" fill="#E3E6DE" />
      <G fill="#DEDBD6">
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
      <G stroke="#FFFFFF" strokeWidth="12" fill="none">
        <Path d="M133 0v480M253 0v480" />
        <Path d="M0 222h390M0 356h116M116 356h154M270 376h120" />
      </G>
      <Path d="M253 112V222H133V356" fill="none" stroke="#2C312E" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="133" cy="356" r="9" fill="#151A16" stroke="#FFFFFF" strokeWidth="3" />
      <Path d="M253 118s-18-20-18-34a18 18 0 1 1 36 0c0 14-18 34-18 34Z" fill="#2C312E" stroke="#FFFFFF" strokeWidth="2" />
      <Circle cx="253" cy="84" r="6.5" fill="#FFFFFF" />
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

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: t.background }]}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.center, { backgroundColor: t.background }]}>
        <Text style={[s.emptyTitle, { color: t.heading }]}>Sipariş bulunamadı</Text>
        <Pressable style={s.emptyBtn} onPress={() => router.replace('/(customer)/orders' as any)}>
          <Text style={s.emptyBtnText}>Siparişlerime dön</Text>
        </Pressable>
      </View>
    );
  }

  const stepIndex = STEPS.indexOf(order.status);
  const closed = order.status === 'delivered' || order.status === 'cancelled';
  const minutes = remainingMinutes(order, seller);
  const name = seller?.display_name ?? 'Satıcı';

  return (
    <View style={[s.root, isDesktop && s.rootDesktop, { backgroundColor: '#E3E6DE' }]}>
      <View style={isDesktop ? s.mapDesktop : s.map}>
        <RouteIllustration height={isDesktop ? desktopHeight : 480} />
      </View>

      <View style={[s.top, { top: insets.top + 8 }, isDesktop && s.topDesktop]}>
        <Pressable style={s.topBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <View style={s.mapTag}>
          <Text style={s.mapTagText}>Temsili rota</Text>
        </View>
        <Pressable style={s.helpBtn} onPress={() => Linking.openURL('mailto:destek@evinden.app')} accessibilityRole="button">
          <Text style={s.helpText}>Yardım</Text>
        </Pressable>
      </View>

      <View style={[isDesktop ? s.sheetDesktop : s.sheet, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <View style={[s.handle, { backgroundColor: t.surfaceBorder }]} />
          <View style={s.etaWrap}>
            <Text style={[s.etaLabel, { color: t.textSecondary }]}>
              {closed ? 'Sipariş durumu' : 'Tahmini teslimat süresi'}
            </Text>
            <Text style={[s.etaValue, { color: t.text }]}>
              {order.status === 'delivered' ? 'Teslim edildi' : order.status === 'cancelled' ? 'İptal edildi' : minutes > 0 ? `${minutes} dk` : 'Az kaldı'}
            </Text>
          </View>

          {order.status !== 'cancelled' ? (
            <View style={s.steps} accessibilityRole="progressbar" accessibilityLabel={`Sipariş durumu: 5 adımın ${Math.max(stepIndex + 1, 0)}. adımı`}>
              {STEPS.map((step, i) => (
                <View key={step} style={[s.step, { backgroundColor: i <= stepIndex ? t.primary : t.surfaceBorder }]} />
              ))}
            </View>
          ) : null}
          <Text style={[s.message, { color: t.text }]}>{MESSAGES[order.status] ?? ''}</Text>

          <View style={[s.sellerRow, { borderTopColor: t.divider }]}>
            <View style={s.sellerAvatar}>
              <Text style={s.sellerAvatarText}>{name.charAt(0).toLocaleUpperCase('tr')}</Text>
            </View>
            <View style={s.sellerBody}>
              <Text style={[s.sellerLabel, { color: t.textSecondary }]}>Teslim edecek</Text>
              <Text style={[s.sellerName, { color: t.text }]} numberOfLines={1}>{name}</Text>
            </View>
            {seller && seller.rating_count > 0 ? (
              <View style={s.rating}>
                <Ionicons name="star" size={15} color="#2C312E" />
                <Text style={[s.ratingText, { color: t.text }]}>{Number(seller.rating_avg).toFixed(1).replace('.', ',')}</Text>
              </View>
            ) : null}
          </View>

          <Pressable style={[s.chatBtn, { borderColor: t.surfaceBorder }]} onPress={openChat} accessibilityRole="button">
            <Ionicons name="chatbubble-outline" size={20} color={t.text} />
            <Text style={[s.chatText, { color: t.text }]}>Mesaj gönder</Text>
          </Pressable>

          <Pressable style={s.detailsRow} onPress={() => setShowDetails(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }}>
            <Text style={[s.detailsText, { color: t.text }]}>Sipariş detayları</Text>
            <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={20} color={t.text} />
          </Pressable>

          {showDetails ? (
            <View style={s.details}>
              {order.order_items.map(item => (
                <View key={item.id} style={s.itemRow}>
                  <Text style={[s.itemText, { color: t.text }]} numberOfLines={2}>{item.quantity}× {item.title_snapshot}</Text>
                  <Text style={[s.itemPrice, { color: t.text }]}>{priceTL(item.unit_price_cents * item.quantity)}</Text>
                </View>
              ))}
              <View style={[s.itemRow, s.totalRow, { borderTopColor: t.divider }]}>
                <Text style={[s.totalText, { color: t.text }]}>Toplam</Text>
                <Text style={[s.totalText, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
              </View>
              {order.delivery_address ? (
                <Text style={[s.address, { color: t.textSecondary }]}>{order.delivery_address}</Text>
              ) : null}
              {['pending', 'accepted'].includes(order.status) ? (
                <Pressable style={s.cancelBtn} onPress={confirmCancel} disabled={cancelling} accessibilityRole="button">
                  <Text style={s.cancelText}>{cancelling ? 'İptal ediliyor…' : 'Siparişi iptal et'}</Text>
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
  emptyBtn: { height: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: '#2C312E', alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.bold },
  map: { position: 'absolute', top: 0, left: 0, right: 0, height: 480 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  mapTag: { height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  mapTagText: { fontSize: 12, fontFamily: fonts.semibold, color: '#56605A' },
  helpBtn: { height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  helpText: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '72%', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingHorizontal: 16, shadowColor: '#151A16', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 16 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  etaWrap: { alignItems: 'center' },
  etaLabel: { fontSize: 14, fontFamily: fonts.regular },
  etaValue: { fontSize: 26, lineHeight: 32, fontFamily: fonts.extrabold, marginTop: 2 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 12 },
  step: { flex: 1, height: 5, borderRadius: 3 },
  message: { textAlign: 'center', fontSize: 14, fontFamily: fonts.regular, marginTop: 10 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  sellerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2C312E', alignItems: 'center', justifyContent: 'center' },
  sellerAvatarText: { fontSize: 20, fontFamily: fonts.extrabold, color: '#fff' },
  sellerBody: { flex: 1, minWidth: 0 },
  sellerLabel: { fontSize: 12, fontFamily: fonts.regular },
  sellerName: { fontSize: 15, fontFamily: fonts.bold },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 14, fontFamily: fonts.bold },
  chatBtn: { height: 48, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 12 },
  chatText: { fontSize: 14, fontFamily: fonts.medium },
  detailsRow: { minHeight: 44, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsText: { fontSize: 16, fontFamily: fonts.bold },
  details: { gap: 8, paddingBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemText: { flex: 1, fontSize: 14, fontFamily: fonts.regular },
  itemPrice: { fontSize: 14, fontFamily: fonts.semibold },
  totalRow: { borderTopWidth: 1, paddingTop: 8 },
  totalText: { fontSize: 14, fontFamily: fonts.bold },
  address: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  cancelBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontFamily: fonts.bold, color: '#C62828' },
  rootDesktop: { flexDirection: 'row' },
  mapDesktop: { flex: 1, overflow: 'hidden' },
  topDesktop: { right: 436 },
  sheetDesktop: { width: 420, paddingTop: 16, paddingHorizontal: 16 },
});
