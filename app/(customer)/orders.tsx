import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hasRequiredGroup } from '@/lib/option-groups';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import FoodImage from '@/components/shared/FoodImage';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { sellerPhoto } from '@/lib/food-images';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { fetchMenuItemImages, fetchCustomerOrders, fetchMyReviewedOrderIds, fetchSellersByIds, fetchSellerWithMenu, createReview, orderEtaAt, requestRefund, type MenuItemWithOptions } from '@/lib/db';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';
import { plannedLabel } from '@/lib/schedule-slots';
import { LogoLoader } from '@/components/shared/Logo';

type OrderStatus = 'awaiting_payment' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_photo: string | null;
  delivery_time_max: number;
  item_images: Record<string, string | null>;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  items: { menu_item_id: string | null; title: string; quantity: number; price_cents: number }[];
  delivery_address: string;
  refund_status: string;
  payment_status: string;
  pickup: boolean;
  scheduled_for: string | null;
  tip_cents: number;
  eta_minutes: number | null;
  eta_updated_at: string | null;
  cancel_reason: string | null;
};

const REFUND_LABELS: Record<string, string> = {
  requested: 'İade talebin inceleniyor',
  approved: 'İade talebin onaylandı',
  rejected: 'İade talebin reddedildi',
};

const PAYMENT_LABELS: Record<string, string> = {
  refund_pending: 'Ödemen iade ediliyor',
  refunded: 'Ödemen iade edildi',
};


const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: 'Ödeme bekleniyor',
  pending: 'Bekliyor',
  accepted: 'Kabul edildi',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  out_for_delivery: 'Yolda',
  delivered: 'Teslim edildi',
  cancelled: 'İptal edildi',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Restoranın verdiği hazırlık süresine (yoksa en uzun teslimat süresine) göre tahmini saat; süre geçtiyse boş */
function etaClock(order: Pick<DemoOrder, 'created_at' | 'delivery_time_max' | 'eta_minutes' | 'eta_updated_at'>): string | null {
  const eta = orderEtaAt(order, order.delivery_time_max);
  if (eta.getTime() <= Date.now()) return null;
  return eta.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/** Porsiyon veya çeşit seçimi gereken ürün; tekrar siparişte seçimsiz sepete eklenmez. */
function needsChoice(item: MenuItemWithOptions): boolean {
  return (item.menu_item_portions ?? []).some(p => p.is_available !== false)
    || (item.menu_item_variants ?? []).some(v => v.is_available !== false);
}

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const ACTIVE_STATUSES: OrderStatus[] = ['awaiting_payment', 'pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

const ACTIVE_TITLES: Record<string, string> = {
  awaiting_payment: 'Ödeme bekleniyor',
  pending: 'Restoranın onayı bekleniyor',
  accepted: 'Sipariş alındı',
  preparing: 'Sipariş ocakta',
  ready: 'Yemeğin hazır',
  out_for_delivery: 'Yemeğin yola çıktı',
};

/** Siparişin durumu; gelip almada kurye ve yol sözcükleri geçmez. */
function activeTitle(order: { status: OrderStatus; pickup: boolean }): string {
  if (order.pickup && order.status === 'ready') return 'Yemeğin hazır, gelip al';
  return ACTIVE_TITLES[order.status];
}

function statusLabel(order: { status: OrderStatus; pickup: boolean }): string {
  if (order.pickup && order.status === 'delivered') return 'Teslim aldın';
  return STATUS_LABELS[order.status];
}

function FloatingIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const { colors: t } = useTheme();
  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 1200 }),
        withTiming(0, { duration: 1200 }),
      ),
      -1,
      true,
    );
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={52} color={t.textMuted} />
    </Animated.View>
  );
}

export default function CustomerOrdersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const { colors: t } = useTheme();
  const isLoggedIn = !!session;
  const { addItem, clearCart } = useCart();
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [ratingModal, setRatingModal] = useState<DemoOrder | null>(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [ratedOrders, setRatedOrders] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refundModal, setRefundModal] = useState<string | null>(null); // orderId
  const [refundReason, setRefundReason] = useState('');

  // Load orders from Supabase, fallback to demo
  const loadOrders = useCallback(async () => {
    if (!session?.userId) { setLoading(false); return; }
    try {
      const dbOrders = await fetchCustomerOrders(session.userId);
      // Enrich with seller names
      const sellerIds = [...new Set(dbOrders.map(o => o.seller_id))];
      const sellers = sellerIds.length > 0 ? await fetchSellersByIds(sellerIds).catch(() => []) : [];
      const sellerMap = new Map(sellers.map(s => [s.id, s]));
      const menuIds = [...new Set(dbOrders.flatMap(o => o.order_items.map(i => i.menu_item_id)).filter(Boolean))] as string[];
      const images = await fetchMenuItemImages(menuIds).catch(() => ({} as Record<string, string | null>));

      setOrders(dbOrders.map(o => ({
        id: o.id,
        seller_id: o.seller_id,
        seller_name: sellerMap.get(o.seller_id)?.display_name ?? 'Satıcı',
        seller_photo: sellerPhoto(sellerMap.get(o.seller_id) ?? {}),
        delivery_time_max: sellerMap.get(o.seller_id)?.delivery_time_max ?? 40,
        item_images: images,
        status: o.status as OrderStatus,
        created_at: o.created_at,
        total_cents: o.total_cents,
        items: o.order_items.map(i => ({
          menu_item_id: i.menu_item_id,
          title: i.title_snapshot,
          quantity: i.quantity,
          price_cents: i.unit_price_cents,
        })),
        delivery_address: o.delivery_address ?? '',
        refund_status: o.refund_status ?? 'none',
        payment_status: o.payment_status ?? 'pending',
        pickup: o.fulfillment === 'pickup',
        scheduled_for: o.scheduled_for ?? null,
        tip_cents: o.tip_cents ?? 0,
        eta_minutes: o.eta_minutes ?? null,
        eta_updated_at: o.eta_updated_at ?? null,
        cancel_reason: o.cancel_reason ?? null,
      })));
      // Değerlendirilmiş siparişlerde "Değerlendir" yeniden çıkmasın.
      const reviewed = await fetchMyReviewedOrderIds(session.userId).catch(() => null);
      if (reviewed) setRatedOrders(prev => new Set([...prev, ...reviewed]));
    } catch {
      // Keep demo orders as fallback
    } finally {
      setLoading(false);
    }
  }, [session?.userId]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Real-time order updates
  useRealtimeOrders(session?.userId, 'customer', (payload) => {
    if (payload.eventType === 'UPDATE') {
      setOrders(prev => prev.map(o =>
        o.id === payload.new.id
          ? {
            ...o,
            status: payload.new.status as OrderStatus,
            refund_status: payload.new.refund_status ?? o.refund_status,
            payment_status: payload.new.payment_status ?? o.payment_status,
            eta_minutes: payload.new.eta_minutes ?? o.eta_minutes,
            eta_updated_at: payload.new.eta_updated_at ?? o.eta_updated_at,
            cancel_reason: payload.new.cancel_reason ?? o.cancel_reason,
          }
          : o
      ));
    } else if (payload.eventType === 'INSERT') {
      // New order added, reload all
      loadOrders();
    }
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const reorderToCart = async (order: DemoOrder) => {
    let seller;
    try {
      seller = await fetchSellerWithMenu(order.seller_id);
    } catch {
      Alert.alert('Hata', 'Menü yüklenemedi. Tekrar dene.');
      return;
    }
    if (!seller || !seller.is_active) {
      Alert.alert('Satıcı kapalı', 'Bu satıcı şu an sipariş almıyor.');
      return;
    }

    // Seçenekli ürünlerin (porsiyon, ekstra) seçimleri siparişte saklanmıyor: başlık menüyle
    // aynı değilse yeniden seçilmesi gerekir. Fiyat her zaman güncel menüden gelir.
    const lines: { id: string; title: string; priceCents: number; quantity: number }[] = [];
    let skipped = 0;
    for (const item of order.items) {
      const current = seller.menu_items.find(m => m.id === item.menu_item_id);
      // Zorunlu seçimi olan ürün seçim yapılmadan sepete girmez, sipariş sunucuda reddedilir. Porsiyonu
      // veya çeşidi olan ürün de yeniden seçilir: seçimsiz eklenirse ana fiyattan sipariş verilirdi.
      if (current?.is_available && current.title === item.title && !hasRequiredGroup(current.menu_option_groups)
          && !needsChoice(current)) {
        lines.push({ id: current.id, title: current.title, priceCents: current.price_cents, quantity: item.quantity });
      } else {
        skipped += 1;
      }
    }
    if (lines.length === 0) {
      Alert.alert('Ürünler eklenemedi', 'Bu siparişteki ürünleri satıcının menüsünden yeniden seçmen gerekiyor.');
      return;
    }

    const addLines = () => {
      for (const line of lines) {
        for (let q = 0; q < line.quantity; q++) {
          addItem(order.seller_id, { menuItemId: line.id, title: line.title, priceCents: line.priceCents });
        }
      }
      Alert.alert(
        'Sepete eklendi',
        skipped > 0
          ? `${lines.length} ürün eklendi. ${skipped} ürünü menüden yeniden seçmen gerekiyor.`
          : `${lines.length} ürün sepete eklendi.`,
      );
    };

    // Sepette başka satıcı varsa önce sor; addItem çakışmada false döner.
    const first = lines[0];
    if (addItem(order.seller_id, { menuItemId: first.id, title: first.title, priceCents: first.priceCents })) {
      first.quantity -= 1;
      addLines();
      return;
    }
    Alert.alert(
      'Sepette başka satıcı var',
      'Sepetini temizleyip bu siparişi eklemek ister misin?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle ve ekle',
          style: 'destructive',
          onPress: () => {
            clearCart();
            addLines();
          },
        },
      ],
    );
  };

  const submitRating = async (order: DemoOrder) => {
    if (rating === 0) return;
    // Save review to Supabase
    if (session?.userId) {
      try {
        await createReview({
          order_id: order.id,
          seller_id: order.seller_id,
          customer_id: session.userId,
          rating,
          comment: review || undefined,
        });
      } catch (e: any) {
        if (e?.code === '23505') {
          setRatedOrders((prev) => new Set(prev).add(order.id));
          setRatingModal(null);
          Alert.alert('Zaten değerlendirildi', 'Bu sipariş için daha önce yorum yaptın.');
        } else {
          Alert.alert('Değerlendirme gönderilemedi', 'Tekrar dene.');
        }
        return;
      }
    }
    setRatedOrders((prev) => new Set(prev).add(order.id));
    setRatingModal(null);
    Alert.alert('Teşekkürler!', 'Değerlendirmen gönderildi.');
  };


  const sorted = [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const active = sorted.filter(o => ACTIVE_STATUSES.includes(o.status));
  const past = sorted.filter(o => !ACTIVE_STATUSES.includes(o.status));

  if (!isLoggedIn) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <TopBar title="Siparişlerim" back />
        <Animated.View entering={FadeIn.duration(500)} style={styles.empty}>
          <FloatingIcon name="receipt-outline" />
          <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[styles.emptyTitle, { color: t.heading }]}>Giriş yap</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[styles.emptySub, { color: t.textSecondary }]}>Siparişlerini görmek için giriş yap.</Animated.Text>
          <View style={styles.emptyAction}>
            <Button label="Giriş yap" onPress={() => router.push('/(auth)/login' as any)} />
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Siparişlerim"
        subtitle={active.length > 0 ? `${active.length} aktif siparişin var` : undefined}
        back
      />

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
        }
      >
        {loading && sorted.length === 0 ? (
          <View style={styles.empty}><LogoLoader /></View>
        ) : sorted.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Henüz sipariş yok</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>Sofra henüz boş. Yakınındaki restoranlara bak.</Text>
            <View style={styles.emptyAction}>
              <Button label="Restoranlara bak" size="lg" onPress={() => router.push('/(customer)' as any)} />
            </View>
          </Animated.View>
        ) : null}

        {active.map(order => {
          const eta = etaClock(order);
          const detail = order.scheduled_for
            ? plannedLabel(order.scheduled_for)
            : eta ? `Tahmini ${eta}` : priceTL(order.total_cents);
          const title = activeTitle(order);
          const where = order.pickup ? 'Gelip al · ' : '';
          return (
            <Pressable
              key={order.id}
              style={[styles.activeCard, { backgroundColor: t.brand }]}
              onPress={() => router.push(`/(customer)/order/${order.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${order.seller_name}, ${where}${detail}`}
            >
              <FoodImage imageUrl={order.seller_photo} size={56} borderRadius={28} />
              <View style={styles.activeBody}>
                <Text style={[styles.activeTitle, { color: t.accent }]}>{title}</Text>
                <Text style={[styles.activeSub, { color: t.onBrandSoft }]} numberOfLines={1}>{order.seller_name} · {where}{detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={t.accent} />
            </Pressable>
          );
        })}

        {past.map(order => {
          const refundNote = REFUND_LABELS[order.refund_status];
          const paymentNote = PAYMENT_LABELS[order.payment_status];

          // İptal edilen sipariş kısa görünür; ürünleri sipariş sayfasında durur.
          if (order.status === 'cancelled') {
            return (
              <View key={order.id} style={[styles.orderCard, { backgroundColor: t.surface }]}>
                <Pressable
                  style={styles.cancelledRow}
                  onPress={() => router.push(`/(customer)/order/${order.id}` as any)}
                  accessibilityRole="button"
                >
                  <View style={styles.orderSellerBody}>
                    <Text style={[styles.orderSeller, { color: t.text }]} numberOfLines={1}>{order.seller_name}</Text>
                    <Text style={[styles.orderMeta, { color: t.textSecondary }]} numberOfLines={1}>
                      {STATUS_LABELS[order.status]}{paymentNote ? ` · ${paymentNote}` : ''}
                    </Text>
                    <Text style={[styles.orderMeta, { color: t.textSecondary }]} numberOfLines={1}>{fmtDateTime(order.created_at)}</Text>
                  </View>
                  <Text style={[styles.totalValue, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
                </Pressable>
                {refundNote ? <Text style={[styles.refundStatus, { color: t.textSecondary }]}>{refundNote}</Text> : null}
              </View>
            );
          }

          return (
            <View key={order.id} style={[styles.orderCard, { backgroundColor: t.surface }]}>
              <Pressable
                style={[styles.orderHead, { borderBottomColor: t.divider }]}
                onPress={() => router.push(`/(customer)/order/${order.id}` as any)}
                accessibilityRole="button"
              >
                <View style={styles.orderSellerBody}>
                  <Text style={[styles.orderSeller, { color: t.text }]} numberOfLines={1}>{order.seller_name}</Text>
                  <Text style={[styles.orderMeta, { color: t.textSecondary }]} numberOfLines={1}>
                    {fmtDateTime(order.created_at)} · #{order.id.slice(0, 8).toUpperCase()} · {order.items.reduce((n, i) => n + i.quantity, 0)} ürün
                  </Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: t.background }]}>
                  <Text style={[styles.statusChipText, { color: t.text }]}>{statusLabel(order)}</Text>
                </View>
              </Pressable>
              <View style={styles.itemList}>
                {order.items.map((item, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <FoodImage imageUrl={item.menu_item_id ? order.item_images[item.menu_item_id] : null} size={36} borderRadius={18} />
                    <Text style={[styles.itemText, { color: t.text }]} numberOfLines={1}>
                      {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.title}
                    </Text>
                    <Text style={[styles.itemPrice, { color: t.text }]}>{priceTL(item.price_cents * item.quantity)}</Text>
                  </View>
                ))}
              </View>
              {order.tip_cents > 0 ? (
                <View style={styles.tipRow}>
                  <Text style={[styles.orderMeta, { color: t.textSecondary }]}>Bahşiş dahil</Text>
                  <Text style={[styles.orderMeta, { color: t.textSecondary }]}>{priceTL(order.tip_cents)}</Text>
                </View>
              ) : null}
              <View style={[styles.totalRow, { borderTopColor: t.divider }]}>
                <Text style={[styles.totalValue, { color: t.text }]}>Toplam</Text>
                <Text style={[styles.totalValue, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
              </View>

              {order.status === 'delivered' ? (
                <View style={styles.actionRow}>
                  <View style={styles.action}>
                    {!ratedOrders.has(order.id) ? (
                      <Button
                        label="Değerlendir"
                        variant="outline"
                        fullWidth
                        onPress={() => { setRatingModal(order); setRating(0); setReview(''); }}
                      />
                    ) : (
                      <View style={[styles.ratedBox, { borderColor: t.surfaceBorder }]}>
                        <Ionicons name="checkmark" size={16} color={t.success} />
                        <Text style={[styles.ratedText, { color: t.success }]}>Değerlendirildi</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.action}>
                    <Button label="Tekrar sipariş ver" fullWidth onPress={() => reorderToCart(order)} />
                  </View>
                </View>
              ) : null}

              {order.status === 'delivered' && order.refund_status === 'none' ? (
                <Pressable style={styles.refundBtn} onPress={() => { setRefundModal(order.id); setRefundReason(''); }} accessibilityRole="button">
                  <Text style={[styles.refundBtnText, { color: t.textSecondary }]}>İade talebi oluştur</Text>
                </Pressable>
              ) : null}
              {refundNote ? <Text style={[styles.refundStatus, { color: t.textSecondary }]}>{refundNote}</Text> : null}
              {paymentNote ? <Text style={[styles.refundStatus, { color: t.textSecondary }]}>{paymentNote}</Text> : null}
            </View>
          );
        })}
      </ScrollView>

      {/* REFUND MODAL */}
      <Modal visible={!!refundModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: t.surface }]}>
            <Text style={[styles.modalTitle, { color: t.heading }]}>İade talebi</Text>
            <Text style={[styles.modalSub, { color: t.textSecondary }]}>Neden iade etmek istediğini yaz</Text>

            <TextInput
              style={[styles.reviewInput, { backgroundColor: t.background, color: t.text }]}
              value={refundReason}
              onChangeText={setRefundReason}
              placeholder="İade nedenin..."
              placeholderTextColor={t.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="İade nedeni"
            />

            <View style={styles.modalBtns}>
              <View style={styles.action}>
                <Button label="Vazgeç" variant="outline" fullWidth onPress={() => setRefundModal(null)} />
              </View>
              <View style={styles.action}>
                <Button
                  label="Gönder"
                  fullWidth
                  disabled={!refundReason.trim()}
                  onPress={async () => {
                    if (!refundReason.trim() || !refundModal) return;
                    try {
                      await requestRefund(refundModal, refundReason.trim());
                      setOrders(prev => prev.map(o => (o.id === refundModal ? { ...o, refund_status: 'requested' } : o)));
                      setRefundModal(null);
                      Alert.alert('İade talebi', 'İade talebin alındı. En kısa sürede değerlendireceğiz.');
                    } catch (err: any) {
                      Alert.alert('Hata', err?.message ?? 'İade talebi oluşturulamadı.');
                    }
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* RATING MODAL */}
      <Modal visible={!!ratingModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: t.surface }]}>
            <Text style={[styles.modalTitle, { color: t.heading }]}>Siparişi değerlendir</Text>
            <Text style={[styles.modalSub, { color: t.textSecondary }]}>{ratingModal?.seller_name}</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <Pressable
                  key={star}
                  style={styles.starBtn}
                  onPress={() => setRating(star)}
                  accessibilityRole="button"
                  accessibilityLabel={`${star} yıldız`}
                  accessibilityState={{ selected: rating >= star }}
                >
                  <Ionicons name={rating >= star ? 'star' : 'star-outline'} size={36} color={rating >= star ? t.primary : t.textMuted} />
                </Pressable>
              ))}
            </View>

            <TextInput
              style={[styles.reviewInput, { backgroundColor: t.background, color: t.text }]}
              value={review}
              onChangeText={setReview}
              placeholder="Yemekler nasıldı? Yorumunu yaz..."
              placeholderTextColor={t.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="Yorumun"
            />

            <View style={styles.modalBtns}>
              <View style={styles.action}>
                <Button label="İptal" variant="outline" fullWidth onPress={() => setRatingModal(null)} />
              </View>
              <View style={styles.action}>
                <Button label="Gönder" fullWidth disabled={rating === 0} onPress={() => ratingModal && submitRating(ratingModal)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tipRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 6 },
  safe: { flex: 1 },

  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 12 },

  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 4 },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
  emptyAction: { marginTop: 12 },

  activeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 },
  activeBody: { flex: 1, minWidth: 0 },
  activeTitle: { fontSize: 15, fontFamily: fonts.bold },
  activeSub: { fontSize: 13, fontFamily: fonts.regular, marginTop: 2 },

  orderCard: { borderRadius: 16, padding: 12 },
  orderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, paddingBottom: 10, borderBottomWidth: 1 },
  orderSellerBody: { flex: 1, minWidth: 0 },
  orderSeller: { fontSize: 15, fontFamily: fonts.bold },
  orderMeta: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  statusChip: { height: 26, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusChipText: { fontSize: 12, fontFamily: fonts.semibold },
  cancelledRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },

  itemList: { gap: 8, paddingVertical: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, fontSize: 13, fontFamily: fonts.regular },
  itemPrice: { fontSize: 13, fontFamily: fonts.bold },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1 },
  totalValue: { fontSize: 15, fontFamily: fonts.extrabold },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1, minWidth: 0 },
  ratedBox: { minHeight: 46, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  ratedText: { fontSize: 14, fontFamily: fonts.bold },
  refundBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  refundBtnText: { fontSize: 13, fontFamily: fonts.semibold },
  refundStatus: { fontSize: 13, fontFamily: fonts.medium, textAlign: 'center', marginTop: 8 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 20, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontFamily: fonts.display, marginBottom: 4 },
  modalSub: { fontFamily: fonts.regular, fontSize: 14, marginBottom: 16 },
  starsRow: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  starBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  reviewInput: { width: '100%', borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 14, minHeight: 80, marginBottom: 16 },
  modalBtns: { flexDirection: 'row', gap: 8, width: '100%' },
});
