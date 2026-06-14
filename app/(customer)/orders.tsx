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
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { fetchCustomerOrders, fetchSellersByIds, createReview, cancelOrder, requestRefund } from '@/lib/db';
import { useRealtimeOrders } from '@/lib/use-realtime-orders';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_emoji: string;
  seller_bg: string;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  items: { title: string; quantity: number; price_cents: number }[];
  delivery_address: string;
};


const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string; icon: string }> = {
  pending:   { label: 'Bekliyor',       bg: '#FFF8E1', text: '#F57F17', icon: '⏳' },
  accepted:  { label: 'Kabul Edildi',   bg: '#E3F2FD', text: '#1565C0', icon: '✅' },
  preparing: { label: 'Hazırlanıyor',   bg: '#FFF8E1', text: '#E65100', icon: '👨‍🍳' },
  ready:     { label: 'Hazır',          bg: '#E8F5E9', text: '#2E7D32', icon: '🎉' },
  delivered: { label: 'Teslim Edildi',  bg: '#E8F5E9', text: '#2E7D32', icon: '✓' },
  cancelled: { label: 'İptal',          bg: '#F5F5F5', text: '#9E9E9E', icon: '✕' },
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffH / 24);

  if (diffMin < 60) return `${diffMin} dk önce`;
  if (diffH < 24) return `${diffH} saat önce`;
  if (diffDay === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

const FILTER_TABS: { key: 'all' | OrderStatus; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'preparing', label: 'Aktif' },
  { key: 'delivered', label: 'Teslim' },
  { key: 'cancelled', label: 'İptal' },
];

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
      <Text style={{ fontSize: 52 }}>{emoji}</Text>
    </Animated.View>
  );
}

export default function CustomerOrdersScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const { colors: t } = useTheme();
  const isLoggedIn = !!session;
  const { addItem, clearCart } = useCart();
  const [activeTab, setActiveTab] = useState<'all' | OrderStatus>('all');
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      const sellerMap = new Map(sellers.map(s => [s.id, s.display_name]));

      setOrders(dbOrders.map(o => ({
        id: o.id,
        seller_id: o.seller_id,
        seller_name: sellerMap.get(o.seller_id) ?? 'Satıcı',
        seller_emoji: '🍽️',
        seller_bg: '#FFF3E0',
        status: o.status as OrderStatus,
        created_at: o.created_at,
        total_cents: o.total_cents,
        items: o.order_items.map(i => ({
          title: i.title_snapshot,
          quantity: i.quantity,
          price_cents: i.unit_price_cents,
        })),
        delivery_address: o.delivery_address ?? '',
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
          ? { ...o, status: payload.new.status as OrderStatus }
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

  const sellerNames = useMemo(() => {
    const names = new Map<string, string>();
    orders.forEach(o => names.set(o.seller_id, o.seller_name));
    return Array.from(names.entries());
  }, [orders]);

  const reorderToCart = (order: DemoOrder) => {
    const firstItem = order.items[0];
    const ok = addItem(order.seller_id, {
      menuItemId: `${order.seller_id}-${firstItem.title}`,
      title: firstItem.title,
      priceCents: firstItem.price_cents,
    });
    if (!ok) {
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
              order.items.forEach((item) => {
                for (let q = 0; q < item.quantity; q++) {
                  addItem(order.seller_id, {
                    menuItemId: `${order.seller_id}-${item.title}`,
                    title: item.title,
                    priceCents: item.price_cents,
                  });
                }
              });
              Alert.alert('Sepete Eklendi', `${order.items.length} ürün sepete eklendi.`);
            },
          },
        ],
      );
      return;
    }
    // First item added, add rest
    order.items.slice(1).forEach((item) => {
      for (let q = 0; q < item.quantity; q++) {
        addItem(order.seller_id, {
          menuItemId: `${order.seller_id}-${item.title}`,
          title: item.title,
          priceCents: item.price_cents,
        });
      }
    });
    // Add remaining quantity of first item
    for (let q = 1; q < firstItem.quantity; q++) {
      addItem(order.seller_id, {
        menuItemId: `${order.seller_id}-${firstItem.title}`,
        title: firstItem.title,
        priceCents: firstItem.price_cents,
      });
    }
    Alert.alert('Sepete Eklendi', `${order.items.length} ürün sepete eklendi.`);
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
      } catch {
        // Still mark as rated locally
      }
    }
    setRatedOrders((prev) => new Set(prev).add(order.id));
    setRatingModal(null);
    Alert.alert('Teşekkürler!', 'Değerlendirmeniz gönderildi.');
  };


  const filtered = orders
    .filter(o => {
      if (activeTab === 'all') { /* pass */ }
      else if (activeTab === 'preparing') {
        if (!['pending', 'accepted', 'preparing', 'ready'].includes(o.status)) return false;
      } else {
        if (o.status !== activeTab) return false;
      }
      if (sellerFilter !== 'all' && o.seller_id !== sellerFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortOrder === 'newest' ? db - da : da - db;
    });

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
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Giriş Yap</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.surfaceBorder }]}>
        <Text style={[styles.headerTitle, { color: t.text }]}>Siparişlerim</Text>
        <Text style={[styles.headerSub, { color: t.textMuted }]}>{orders.length} sipariş</Text>
      </View>

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabScroll}
        style={styles.tabRow}
      >
        {FILTER_TABS.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.tabPill, activeTab === tab.key && styles.tabPillActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Seller filter + sort */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sellerScroll}>
          <Pressable
            style={[styles.sellerPill, sellerFilter === 'all' && styles.sellerPillActive]}
            onPress={() => setSellerFilter('all')}
          >
            <Text style={[styles.sellerPillText, sellerFilter === 'all' && styles.sellerPillTextActive]}>Tüm Satıcılar</Text>
          </Pressable>
          {sellerNames.map(([id, name]) => (
            <Pressable
              key={id}
              style={[styles.sellerPill, sellerFilter === id && styles.sellerPillActive]}
              onPress={() => setSellerFilter(sellerFilter === id ? 'all' : id)}
            >
              <Text style={[styles.sellerPillText, sellerFilter === id && styles.sellerPillTextActive]} numberOfLines={1}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          style={styles.sortBtn}
          onPress={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
        >
          <Ionicons name={sortOrder === 'newest' ? 'arrow-down' : 'arrow-up'} size={14} color="#6B5E50" />
          <Text style={styles.sortBtnText}>{sortOrder === 'newest' ? 'Yeni' : 'Eski'}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {filtered.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={styles.empty}>
            <FloatingEmoji emoji="📋" />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={styles.emptyTitle}>Sipariş yok</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={styles.emptySub}>Bu filtrelerde sipariş bulunmuyor.</Animated.Text>
          </Animated.View>
        ) : (
          filtered.map(order => {
            const sc = STATUS_CONFIG[order.status];
            const isExpanded = expandedId === order.id;

            return (
              <Pressable
                key={order.id}
                style={[styles.orderCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}
                onPress={() => setExpandedId(isExpanded ? null : order.id)}
              >
                {/* Top row */}
                <View style={styles.orderTop}>
                  <View style={[styles.orderEmoji, { backgroundColor: order.seller_bg }]}>
                    <Text style={styles.orderEmojiText}>{order.seller_emoji}</Text>
                  </View>
                  <View style={styles.orderInfo}>
                    <Text style={[styles.orderSeller, { color: t.text }]} numberOfLines={1}>{order.seller_name}</Text>
                    <Text style={[styles.orderDate, { color: t.textMuted }]}>{formatDate(order.created_at)}</Text>
                  </View>
                  <View style={styles.orderRight}>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.text }]}>
                        {sc.icon} {sc.label}
                      </Text>
                    </View>
                    <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                  </View>
                </View>

                {/* Expanded items */}
                {isExpanded ? (
                  <View style={styles.expandedWrap}>
                    <View style={styles.divider} />

                    {/* Timeline for active orders */}
                    {['pending', 'accepted', 'preparing', 'ready'].includes(order.status) ? (
                      <View style={styles.timelineBox}>
                        {(['pending', 'preparing', 'ready', 'delivered'] as OrderStatus[]).map((step, idx, arr) => {
                          const sMap: Record<string, string> = { pending: 'Bekliyor', preparing: 'Hazırlanıyor', ready: 'Yolda', delivered: 'Teslim' };
                          const currentIdx = arr.findIndex(s => s === order.status) || 0;
                          const mappedCurrent = currentIdx === -1 && order.status === 'accepted' ? 1 : Math.max(0, currentIdx);
                          const active = idx <= mappedCurrent;
                          const isLast = idx === arr.length - 1;
                          return (
                            <View key={step} style={styles.timelineItem}>
                              <View style={[styles.timelineDot, active && styles.timelineDotActive]} />
                              {!isLast && <View style={[styles.timelineLine, idx < mappedCurrent && styles.timelineLineActive]} />}
                              <Text style={[styles.timelineText, active && styles.timelineTextActive]}>{sMap[step]}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {order.items.map((item, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemText}>
                          <Text style={styles.itemQty}>{item.quantity}×</Text> {item.title}
                        </Text>
                        <Text style={styles.itemPrice}>{priceTL(item.price_cents * item.quantity)}</Text>
                      </View>
                    ))}
                    <View style={styles.addressRow}>
                      <Text style={styles.addressText}>📍 {order.delivery_address}</Text>
                    </View>

                    {/* Action buttons */}
                    <View style={styles.actionRow}>
                      {order.status === 'delivered' ? (
                        <>
                          <Pressable
                            style={styles.reorderBtn}
                            onPress={() => reorderToCart(order)}
                          >
                            <Text style={styles.reorderBtnText}>🛒 Tekrar Ver</Text>
                          </Pressable>
                          {!ratedOrders.has(order.id) ? (
                            <Pressable
                              style={styles.reviewBtn}
                              onPress={() => { setRatingModal(order); setRating(0); setReview(''); }}
                            >
                              <Text style={styles.reviewBtnText}>⭐ Değerlendir</Text>
                            </Pressable>
                          ) : (
                            <View style={[styles.reviewBtn, { backgroundColor: '#E8F5E9' }]}>
                              <Text style={[styles.reviewBtnText, { color: '#2E7D32' }]}>✓ Değerlendirildi</Text>
                            </View>
                          )}
                        </>
                      ) : null}
                    </View>

                    {/* Cancel button — pending/accepted only */}
                    {['pending', 'accepted'].includes(order.status) ? (
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => {
                          Alert.alert(
                            'Siparişi İptal Et',
                            'Bu siparişi iptal etmek istediğinize emin misiniz?',
                            [
                              { text: 'Vazgeç', style: 'cancel' },
                              {
                                text: 'İptal Et',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await cancelOrder(order.id);
                                    await loadOrders();
                                    Alert.alert('İptal Edildi', 'Siparişiniz başarıyla iptal edildi.');
                                  } catch (err: any) {
                                    Alert.alert('Hata', err?.message ?? 'Sipariş iptal edilemedi.');
                                  }
                                },
                              },
                            ],
                          );
                        }}
                      >
                        <Text style={styles.cancelBtnText}>İptal Et</Text>
                      </Pressable>
                    ) : null}

                    {/* Refund button — delivered only */}
                    {order.status === 'delivered' ? (
                      <Pressable
                        style={styles.refundBtn}
                        onPress={() => { setRefundModal(order.id); setRefundReason(''); }}
                      >
                        <Text style={styles.refundBtnText}>İade Talebi</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {/* Expand hint */}
                <Text style={styles.expandHint}>{isExpanded ? '▲ Kapat' : '▼ Detaylar'}</Text>
              </Pressable>
            );
          })
        )}
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
              placeholderTextColor="#A89A8A"
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
              placeholderTextColor="#A89A8A"
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
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: fonts.extrabold },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  tabPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  tabTextActive: { color: '#fff' },

  filterBar: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, borderBottomWidth: 1, borderBottomColor: '#F0ECE6' },
  sellerScroll: { paddingHorizontal: 16, paddingVertical: 8, gap: 6, flexGrow: 1 },
  sellerPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F7F3EE', borderWidth: 1, borderColor: '#EDE8E2' },
  sellerPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sellerPillText: { fontSize: 11, fontWeight: '600', color: '#6B5E50', maxWidth: 120 },
  sellerPillTextActive: { color: '#fff' },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F7F3EE', borderWidth: 1, borderColor: '#EDE8E2', flexShrink: 0 },
  sortBtnText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
  },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderEmoji: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  orderEmojiText: { fontSize: 24 },
  orderInfo: { flex: 1 },
  orderSeller: { fontSize: 14, fontWeight: '700', color: '#1A1208', marginBottom: 2 },
  orderDate: { fontSize: 12, color: '#A89A8A' },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },

  expandedWrap: { marginTop: 10 },
  divider: { height: 1, backgroundColor: '#EDE8E2', marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  itemQty: { fontWeight: '700', color: '#1A1208' },
  itemText: { fontSize: 13, color: '#6B5E50', flex: 1 },
  itemPrice: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  addressRow: { marginTop: 6 },
  addressText: { fontSize: 12, color: '#A89A8A' },
  reorderBtn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reorderBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  expandHint: { fontSize: 11, color: '#C4B8AA', textAlign: 'center', marginTop: 10 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },

  timelineBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  timelineItem: { alignItems: 'center', position: 'relative', flex: 1 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E8E2DA', zIndex: 2 },
  timelineDotActive: { backgroundColor: colors.primary },
  timelineLine: { position: 'absolute', top: 5, left: '50%', width: '100%', height: 2, backgroundColor: '#E8E2DA', zIndex: 1 },
  timelineLineActive: { backgroundColor: colors.primary },
  timelineText: { fontSize: 10, color: '#A89A8A', marginTop: 6, fontWeight: '600', textAlign: 'center' },
  timelineTextActive: { color: colors.primary, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  simulateBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#FFE082', alignItems: 'center' },
  simulateBtnText: { fontSize: 13, fontWeight: '700', color: '#F57F17' },
  reviewBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  reviewBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 4 },
  modalSub: { fontSize: 14, color: '#A89A8A', marginBottom: 20 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  starIcon: { fontSize: 40, color: '#E8E2DA' },
  starIconActive: { color: '#EF9F27' },
  reviewInput: { width: '100%', backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14, fontSize: 14, color: '#1A1208', minHeight: 80, borderWidth: 1, borderColor: '#F0ECE6', marginBottom: 20 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#F5F0EA' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: '#6B5E50' },
  modalSubmit: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  modalSubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  cancelBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFCC80',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#E65100' },
  refundBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F5F0EA',
    borderWidth: 1,
    borderColor: '#E8E2DA',
    alignItems: 'center',
  },
  refundBtnText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
});
