import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import FoodImage from '@/components/shared/FoodImage';
import { sellerPhoto } from '@/lib/food-images';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { fetchMenuItemImages, fetchCustomerOrders, fetchSellersByIds, fetchSellerWithMenu, createReview, cancelOrder, requestRefund } from '@/lib/db';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';

type OrderStatus = 'awaiting_payment' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_photo: string | null;
  item_images: Record<string, string | null>;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  items: { menu_item_id: string | null; title: string; quantity: number; price_cents: number }[];
  delivery_address: string;
  refund_status: string;
  payment_status: string;
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
  ready: 'Yolda',
  delivered: 'Teslim edildi',
  cancelled: 'İptal edildi',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const ACTIVE_STATUSES: OrderStatus[] = ['awaiting_payment', 'pending', 'accepted', 'preparing', 'ready'];

const ACTIVE_TITLES: Record<string, string> = {
  awaiting_payment: 'Ödeme bekleniyor',
  pending: 'Mutfağın onayı bekleniyor',
  accepted: 'Sipariş alındı',
  preparing: 'Sipariş ocakta',
  ready: 'Yemeğin yola çıktı',
};

function FloatingEmoji({ emoji }: { emoji: string }) {
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
      <Text style={{ fontFamily: fonts.regular, fontSize: 52 }}>{emoji}</Text>
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
      })));
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
          ? { ...o, status: payload.new.status as OrderStatus, refund_status: payload.new.refund_status ?? o.refund_status, payment_status: payload.new.payment_status ?? o.payment_status }
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
      Alert.alert('Hata', 'Menü yüklenemedi. Lütfen tekrar deneyin.');
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
      if (current?.is_available && current.title === item.title) {
        lines.push({ id: current.id, title: current.title, priceCents: current.price_cents, quantity: item.quantity });
      } else {
        skipped += 1;
      }
    }
    if (lines.length === 0) {
      Alert.alert('Ürünler eklenemedi', 'Bu siparişteki ürünleri satıcının menüsünden yeniden seçmeniz gerekiyor.');
      return;
    }

    const addLines = () => {
      for (const line of lines) {
        for (let q = 0; q < line.quantity; q++) {
          addItem(order.seller_id, { menuItemId: line.id, title: line.title, priceCents: line.priceCents });
        }
      }
      Alert.alert(
        'Sepete Eklendi',
        skipped > 0
          ? `${lines.length} ürün eklendi. ${skipped} ürünü menüden yeniden seçmeniz gerekiyor.`
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
      'Sepetinizi temizleyip bu siparişi eklemek ister misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle ve Ekle',
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
          Alert.alert('Zaten değerlendirildi', 'Bu sipariş için daha önce yorum yaptınız.');
        } else {
          Alert.alert('Değerlendirme gönderilemedi', 'Lütfen tekrar deneyin.');
        }
        return;
      }
    }
    setRatedOrders((prev) => new Set(prev).add(order.id));
    setRatingModal(null);
    Alert.alert('Teşekkürler!', 'Değerlendirmeniz gönderildi.');
  };


  const sorted = [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const active = sorted.filter(o => ACTIVE_STATUSES.includes(o.status));
  const past = sorted.filter(o => !ACTIVE_STATUSES.includes(o.status));

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: t.surfaceBorder }]}>
          <Text style={[styles.headerTitle, { color: t.text }]}>Siparişlerim</Text>
        </View>
        <Animated.View entering={FadeIn.duration(500)} style={styles.empty}>
          <FloatingEmoji emoji="📦" />
          <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[styles.emptyTitle, { color: t.text }]}>Giriş yapın</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[styles.emptySub, { color: t.textMuted }]}>Siparişlerinizi görmek için giriş yapın.</Animated.Text>
          <Pressable
            style={{ marginTop: 12, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
            onPress={() => router.push('/(auth)/login' as any)}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontFamily: fonts.bold }}>Giriş Yap</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.surface }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={[styles.backBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="chevron-back" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.heading }]}>Siparişlerim</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {sorted.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Henüz sipariş yok</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>Sofra henüz boş. Yakınındaki mutfaklara bak.</Text>
            <Pressable style={styles.emptyBtn} onPress={() => router.push('/(customer)' as any)} accessibilityRole="button">
              <Text style={styles.emptyBtnText}>Mutfaklara bak</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {active.map(order => (
          <Pressable
            key={order.id}
            style={[styles.activeCard, { backgroundColor: t.mint }]}
            onPress={() => router.push(`/(customer)/order/${order.id}` as any)}
            accessibilityRole="button"
          >
            <FoodImage imageUrl={order.seller_photo} size={52} borderRadius={12} />
            <View style={styles.activeBody}>
              <Text style={[styles.activeTitle, { color: t.text }]}>{ACTIVE_TITLES[order.status]}</Text>
              <Text style={[styles.activeSub, { color: t.textSecondary }]} numberOfLines={1}>{order.seller_name} · {priceTL(order.total_cents)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </Pressable>
        ))}

        {past.map(order => (
          <View key={order.id} style={[styles.orderCard, { borderColor: t.surfaceBorder }]}>
            <View style={[styles.orderHead, { borderBottomColor: t.divider }]}>
              <Text style={[styles.orderDate, { color: t.textSecondary }]}>{fmtDateTime(order.created_at)}</Text>
              <View style={[styles.statusChip, { backgroundColor: t.chip }]}>
                <Text style={[styles.statusChipText, { color: t.text }]}>{STATUS_LABELS[order.status]}</Text>
              </View>
            </View>
            <Pressable style={styles.orderSellerRow} onPress={() => router.push(`/(customer)/order/${order.id}` as any)} accessibilityRole="button">
              <FoodImage imageUrl={order.seller_photo} size={54} borderRadius={10} style={styles.orderSellerPhoto} />
              <View style={styles.orderSellerBody}>
                <Text style={[styles.orderSeller, { color: t.text }]} numberOfLines={1}>{order.seller_name}</Text>
                <Text style={[styles.orderMeta, { color: t.textSecondary }]}>
                  Sipariş #{order.id.slice(0, 8).toUpperCase()} · {order.items.reduce((n, i) => n + i.quantity, 0)} ürün
                </Text>
              </View>
            </Pressable>
            <View style={styles.itemList}>
              {order.items.map((item, idx) => (
                <View key={idx} style={styles.itemRow}>
                  <FoodImage imageUrl={item.menu_item_id ? order.item_images[item.menu_item_id] : null} size={34} borderRadius={8} />
                  <Text style={[styles.itemText, { color: t.text }]} numberOfLines={1}>
                    {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.title}
                  </Text>
                  <Text style={[styles.itemPrice, { color: t.text }]}>{priceTL(item.price_cents * item.quantity)}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.totalRow, { borderTopColor: t.divider }]}>
              <Text style={[styles.totalLabel, { color: t.text }]}>Toplam</Text>
              <Text style={[styles.totalValue, { color: t.text }]}>{priceTL(order.total_cents)}</Text>
            </View>

            {order.status === 'delivered' ? (
              <View style={styles.actionRow}>
                {!ratedOrders.has(order.id) ? (
                  <Pressable
                    style={[styles.reviewBtn, { borderColor: t.surfaceBorder }]}
                    onPress={() => { setRatingModal(order); setRating(0); setReview(''); }}
                    accessibilityRole="button"
                  >
                    <Ionicons name="star" size={16} color="#E8A317" />
                    <Text style={[styles.reviewBtnText, { color: t.text }]}>Değerlendir</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.reviewBtn, { borderColor: t.surfaceBorder }]}>
                    <Text style={[styles.reviewBtnText, { color: t.success }]}>✓ Değerlendirildi</Text>
                  </View>
                )}
                <Pressable style={styles.reorderBtn} onPress={() => reorderToCart(order)} accessibilityRole="button">
                  <Text style={styles.reorderBtnText}>Tekrar sipariş ver</Text>
                </Pressable>
              </View>
            ) : null}

            {order.status === 'delivered' && order.refund_status === 'none' ? (
              <Pressable style={styles.refundBtn} onPress={() => { setRefundModal(order.id); setRefundReason(''); }} accessibilityRole="button">
                <Text style={[styles.refundBtnText, { color: t.textSecondary }]}>İade talebi oluştur</Text>
              </Pressable>
            ) : null}
            {REFUND_LABELS[order.refund_status] ? (
              <Text style={[styles.refundStatus, { color: t.textSecondary }]}>{REFUND_LABELS[order.refund_status]}</Text>
            ) : null}
            {PAYMENT_LABELS[order.payment_status] ? (
              <Text style={[styles.refundStatus, { color: t.textSecondary }]}>{PAYMENT_LABELS[order.payment_status]}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {/* REFUND MODAL */}
      <Modal visible={!!refundModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>İade Talebi</Text>
            <Text style={styles.modalSub}>Lütfen iade nedeninizi belirtin</Text>

            <TextInput
              style={styles.reviewInput}
              value={refundReason}
              onChangeText={setRefundReason}
              placeholder="İade nedeninizi yazın..."
              placeholderTextColor="#6B766F"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setRefundModal(null)}>
                <Text style={styles.modalCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmit, !refundReason.trim() && { opacity: 0.5 }]}
                onPress={async () => {
                  if (!refundReason.trim() || !refundModal) return;
                  try {
                    await requestRefund(refundModal, refundReason.trim());
                    setOrders(prev => prev.map(o => (o.id === refundModal ? { ...o, refund_status: 'requested' } : o)));
                    setRefundModal(null);
                    Alert.alert('İade Talebi', 'İade talebiniz başarıyla oluşturuldu. En kısa sürede değerlendirilecektir.');
                  } catch (err: any) {
                    Alert.alert('Hata', err?.message ?? 'İade talebi oluşturulamadı.');
                  }
                }}
              >
                <Text style={styles.modalSubmitText}>Gönder</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* RATING MODAL */}
      <Modal visible={!!ratingModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Siparişi Değerlendir</Text>
            <Text style={styles.modalSub}>{ratingModal?.seller_name}</Text>
            
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <Pressable key={star} onPress={() => setRating(star)}>
                  <Text style={[styles.starIcon, rating >= star && styles.starIconActive]}>★</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              value={review}
              onChangeText={setReview}
              placeholder="Yemekler nasıldı? Lütfen yorumunuzu yazın..."
              placeholderTextColor="#6B766F"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setRatingModal(null)}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </Pressable>
              <Pressable style={[styles.modalSubmit, rating === 0 && { opacity: 0.5 }]} onPress={() => ratingModal && submitRating(ratingModal)}>
                <Text style={styles.modalSubmitText}>Gönder</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 20, lineHeight: 25, fontFamily: fonts.display, letterSpacing: -0.4 },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },

  orderCard: { borderWidth: 1, borderRadius: 16, padding: 12 },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderInfo: { flex: 1 },
  orderSeller: { fontSize: 15, fontFamily: fonts.bold },
  orderDate: { fontSize: 13, fontFamily: fonts.regular },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  orderTotal: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary },

  expandedWrap: { marginTop: 10 },
  divider: { height: 1, backgroundColor: '#E3E6DE', marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemQty: { fontFamily: fonts.bold, color: '#151A16' },
  itemText: { flex: 1, fontSize: 13, fontFamily: fonts.regular },
  itemPrice: { fontSize: 13, fontFamily: fonts.semibold },
  addressRow: { marginTop: 6 },
  addressText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  reorderBtn: { flex: 1, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  reorderBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },

  expandHint: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ACA5', textAlign: 'center', marginTop: 10 },

  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24, gap: 8 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  emptyTitle: { fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 4 },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },

  timelineBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  timelineItem: { alignItems: 'center', position: 'relative', flex: 1 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#DDE1D8', zIndex: 2 },
  timelineDotActive: { backgroundColor: colors.primary },
  timelineLine: { position: 'absolute', top: 5, left: '50%', width: '100%', height: 2, backgroundColor: '#DDE1D8', zIndex: 1 },
  timelineLineActive: { backgroundColor: colors.primary },
  timelineText: { fontSize: 10, color: '#6B766F', marginTop: 6, fontFamily: fonts.semibold, textAlign: 'center' },
  timelineTextActive: { color: colors.primary, fontFamily: fonts.bold },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  simulateBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#FFE082', alignItems: 'center' },
  simulateBtnText: { fontSize: 13, fontFamily: fonts.bold, color: '#F57F17' },
  reviewBtn: { flex: 1, height: 46, borderRadius: 23, borderWidth: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  reviewBtnText: { fontSize: 14, fontFamily: fonts.semibold },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16', marginBottom: 4 },
  modalSub: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F', marginBottom: 20 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  starIcon: { fontFamily: fonts.regular, fontSize: 40, color: '#DDE1D8' },
  starIconActive: { color: '#E3A90F' },
  reviewInput: { width: '100%', backgroundColor: '#FAF8F2', borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 14, color: '#151A16', minHeight: 80, borderWidth: 1, borderColor: '#EDEFE8', marginBottom: 20 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#EFF2EA' },
  modalCancelText: { fontSize: 14, fontFamily: fonts.semibold, color: '#56605A' },
  modalSubmit: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  modalSubmitText: { fontSize: 14, fontFamily: fonts.bold, color: '#fff' },

  cancelBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFCC80',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 13, fontFamily: fonts.bold, color: '#E65100' },
  refundStatus: { fontSize: 13, fontFamily: fonts.medium, textAlign: 'center', marginTop: 8 },
  refundBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  refundBtnText: { fontSize: 13, fontFamily: fonts.semibold },
  backBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  activeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  activeBody: { flex: 1, minWidth: 0 },
  activeTitle: { fontSize: 14, fontFamily: fonts.bold },
  activeSub: { fontSize: 13, fontFamily: fonts.regular, marginTop: 2 },
  orderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1 },
  statusChip: { height: 26, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusChipText: { fontSize: 12, fontFamily: fonts.semibold },
  orderSellerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  orderSellerPhoto: { width: 76 },
  orderSellerBody: { flex: 1, minWidth: 0 },
  orderMeta: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  itemList: { gap: 8 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  totalLabel: { fontSize: 14, fontFamily: fonts.semibold },
  totalValue: { fontSize: 14, fontFamily: fonts.extrabold },
  emptyBtn: { marginTop: 12, height: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.bold },
});
