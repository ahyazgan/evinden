import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';
import BottomSheet, { BottomSheetScrollView, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import { useFavorites } from '@/lib/favorites-context';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import { useTheme } from '@/lib/theme-context';
import { shareSeller } from '@/lib/social-share';
import type { MenuItem, Seller } from '@/types';
import FoodImage from '@/components/shared/FoodImage';
import { Ionicons } from '@expo/vector-icons';
import { sellerPhoto } from '@/lib/food-images';
import { isOpenAt, istanbulClock, istanbulToday } from '@/lib/date';
import { remainingToday } from '@/lib/stock';
import { isInDeliveryArea, usableCoords } from '@/lib/geo';
import { getSavedLocation } from '@/components/shared/LocationPicker';
import {
  fetchFollowState,
  fetchMyHelpfulReviewIds,
  fetchSellerCoupons,
  fetchSellerWithMenu,
  fetchSellerHours,
  fetchReviews,
  fetchWeeklyMenu,
  followSeller,
  markReviewHelpful,
  unfollowSeller,
  unmarkReviewHelpful,
  type CouponRow,
  type ReviewRow,
  type SellerHourRow,
} from '@/lib/db';
import { chatErrorMessage, sendMessageToSeller } from '@/lib/messages';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { fonts } from '@/lib/fonts';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_W = (SCREEN_W - 32 - 10) / 2;

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Types for display ──────────────────────────────────────────────────────

type WorkingHours = { day: string; hours: string; open: boolean };

type DisplayReview = {
  id: string;
  name: string;
  rating: number;
  date: string;
  comment: string;
  photoUri?: string;
  helpfulCount: number;
  menuItem?: string;
  sellerReply?: string;
};

type SellerView = Seller & {
  deliveryTime: string;
  minOrder: number;
  deliveryFee: number;
  photo: string | null;
  logo: string | null;
  isRestaurant: boolean;
};

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

/** Sunucudaki place_order ile aynı hesap: porsiyon menü fiyatının yerine geçer. */
function optionsTotal(item: MenuItem, portionId: string | null, variantId: string | null, extraIds: Set<string>): number {
  const base = item.portions?.find(p => p.id === portionId)?.priceCents ?? item.price_cents;
  const variantDiff = item.variants?.find(v => v.id === variantId)?.priceDiffCents ?? 0;
  const extras = item.extras?.filter(e => extraIds.has(e.id)).reduce((sum, e) => sum + e.priceCents, 0) ?? 0;
  return base + variantDiff + extras;
}

function hoursRowToDisplay(rows: SellerHourRow[]): WorkingHours[] {
  return DAY_NAMES.map((day, i) => {
    const row = rows.find(r => r.day_of_week === i);
    if (!row || !row.is_open) return { day, hours: 'Kapalı', open: false };
    return { day, hours: `${row.open_time ?? '09:00'} - ${row.close_time ?? '21:00'}`, open: true };
  });
}

function formatMemberSince(createdAt: string): string {
  const d = new Date(createdAt);
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${months[d.getMonth()]} ${d.getFullYear()}'dan beri aktif`;
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  popular: { label: '🔥 Popüler', bg: '#FFF3E0', text: '#E65100' },
  new: { label: '✨ Yeni', bg: '#E8F5E9', text: '#2E7D32' },
  spicy: { label: '🌶️ Acılı', bg: '#FFEBEE', text: '#C62828' },
};

function MenuCard({
  item,
  qty,
  onOpen,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem;
  qty: number;
  onOpen: () => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors: t } = useTheme();
  const badge = item.badge ? BADGE_CONFIG[item.badge] : null;
  const fromPrice = item.portions && item.portions.length > 0
    ? Math.min(...item.portions.map(p => p.priceCents))
    : item.price_cents;

  return (
    <Pressable
      style={[st.menuCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, !item.is_available && st.menuCardDisabled]}
      onPress={item.is_available ? onOpen : undefined}
      accessibilityLabel={`${item.title}, ${priceTL(fromPrice)}`}
    >
      <View>
        <FoodImage imageUrl={item.image_url} size={GRID_W - 10} height={104} borderRadius={10} />
        {!item.is_available ? (
          <View style={st.soldOutOverlay}>
            <Text style={st.soldOutText}>Bugünlük bitti</Text>
          </View>
        ) : qty === 0 ? (
          <Pressable style={st.addBtn} onPress={onAdd} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${item.title} sepete ekle`}>
            <Ionicons name="add" size={18} color="#fff" />
          </Pressable>
        ) : (
          <View style={st.qtyControl}>
            <Pressable style={st.qtyBtn} onPress={onDecrement} hitSlop={6} accessibilityRole="button" accessibilityLabel="Azalt">
              <Ionicons name="remove" size={16} color="#fff" />
            </Pressable>
            <Text style={st.qtyNum}>{qty}</Text>
            <Pressable style={st.qtyBtn} onPress={onIncrement} hitSlop={6} accessibilityRole="button" accessibilityLabel="Artır">
              <Ionicons name="add" size={16} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>
      <Text style={[st.menuTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
      {item.description ? (
        <Text style={[st.menuDesc, { color: t.textSecondary }]} numberOfLines={1}>{item.description}</Text>
      ) : null}
      <View style={st.menuPriceRow}>
        <Text style={st.menuPrice}>{priceTL(fromPrice)}</Text>
        {badge ? <Text style={[st.menuBadge, { color: badge.text }]} numberOfLines={1}>{badge.label}</Text> : null}
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SellerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: t } = useTheme();
  const {
    sellerId: cartSellerId,
    items: cartItems,
    totalItems,
    totalCents,
    addItem,
    forceAdd,
    incrementItem,
    decrementItem,
  } = useCart();
  const { addRecent } = useRecentlyViewed();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [seller, setSeller] = useState<SellerView | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string>('Tümü');
  const [loading, setLoading] = useState(true);
  const [showHours, setShowHours] = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHours[]>([]);
  const [isClosed, setIsClosed] = useState(false);
  const [outOfArea, setOutOfArea] = useState(false);
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [optionsItem, setOptionsItem] = useState<MenuItem | null>(null);
  const [optionsQty, setOptionsQty] = useState(1);
  const [selectedPortion, setSelectedPortion] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const { session, requireAuth } = useRequireAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [campaigns, setCampaigns] = useState<CouponRow[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showDeliveryZones, setShowDeliveryZones] = useState(false);
  const [helpfulReviews, setHelpfulReviews] = useState<Set<string>>(new Set());
  const [dbReviews, setDbReviews] = useState<ReviewRow[]>([]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const optionsSheetRef = useRef<BottomSheet>(null);
  const messageSheetRef = useRef<BottomSheet>(null);
  const optionsSnapPoints = useMemo(() => ['55%', '80%'], []);
  const messageSnapPoints = useMemo(() => ['45%'], []);

  const isFav = isFavorite(id ?? '');

  useEffect(() => {
    if (!id) return;
    addRecent(id);

    (async () => {
      try {
        const result = await fetchSellerWithMenu(id);
        if (result) {
          const s: SellerView = {
            id: result.id,
            user_id: result.user_id,
            display_name: result.display_name,
            bio: result.bio,
            city: result.city,
            district: result.district,
            address_line: result.address_line,
            latitude: result.latitude ? Number(result.latitude) : null,
            longitude: result.longitude ? Number(result.longitude) : null,
            rating_avg: Number(result.rating_avg) || 0,
            rating_count: result.rating_count,
            is_active: result.is_active,
            created_at: result.created_at,
            updated_at: result.updated_at,
            deliveryTime: `${result.delivery_time_min ?? 25}-${result.delivery_time_max ?? 40}`,
            minOrder: result.min_order_cents ?? 0,
            deliveryFee: result.delivery_fee_cents ?? 0,
            photo: sellerPhoto(result),
            logo: result.logo_url ?? null,
            isRestaurant: result.seller_type === 'restaurant',
          };
          setSeller(s);
          setRadiusKm(result.delivery_radius_km != null ? Number(result.delivery_radius_km) : null);
          getSavedLocation()
            .then(saved => setOutOfArea(!isInDeliveryArea(result, usableCoords(saved))))
            .catch(() => {});
          const { dayOfWeek } = istanbulClock();
          // Haftalık menü kullanan satıcıda yalnızca bugünün ürünleri satılır (sunucu da denetler).
          const todaysItems = result.uses_weekly_menu
            ? new Set(
                (await fetchWeeklyMenu(id))
                  .filter(w => w.is_active && w.day_of_week === dayOfWeek)
                  .map(w => w.menu_item_id),
              )
            : null;
          const bySortOrder = (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order;
          const items: MenuItem[] = result.menu_items
            .filter(m => !todaysItems || todaysItems.has(m.id))
            .map(m => {
            const variants = [...(m.menu_item_variants ?? [])]
              .filter(v => v.is_available)
              .sort(bySortOrder)
              .map(v => ({ id: v.id, label: v.label, priceDiffCents: v.price_diff_cents }));
            const extras = [...(m.menu_item_extras ?? [])]
              .filter(e => e.is_available)
              .sort(bySortOrder)
              .map(e => ({ id: e.id, label: e.label, priceCents: e.price_cents }));
            const portions = [...(m.menu_item_portions ?? [])]
              .filter(p => p.is_available)
              .sort(bySortOrder)
              .map(p => ({ id: p.id, label: p.label, priceCents: p.price_cents }));
            return {
              id: m.id,
              seller_id: m.seller_id,
              title: m.title,
              description: m.description,
              price_cents: m.price_cents,
              currency: m.currency,
              image_url: m.image_url,
              is_available: m.is_available && remainingToday(m.daily_limit, m.sold_today, m.stock_reset_date, istanbulToday()) !== 0,
              remaining_today: remainingToday(m.daily_limit, m.sold_today, m.stock_reset_date, istanbulToday()),
              category: m.category ?? undefined,
              created_at: m.created_at,
              updated_at: m.updated_at,
              variants: variants.length > 0 ? variants : undefined,
              extras: extras.length > 0 ? extras : undefined,
              portions: portions.length > 0 ? portions : undefined,
            };
          });
          setMenuItems(items);

          // Fetch reviews and hours in parallel
          const [reviews, hours] = await Promise.all([
            fetchReviews(id).catch(() => [] as ReviewRow[]),
            fetchSellerHours(id).catch(() => [] as SellerHourRow[]),
          ]);
          setDbReviews(reviews);
          fetchSellerCoupons(id).then(setCampaigns).catch(() => undefined);
          if (hours.length > 0) setWorkingHours(hoursRowToDisplay(hours));
          setIsClosed(result.is_paused || !isOpenAt(hours, istanbulClock()));
        } else {
          setSeller(null);
        }
      } catch {
        setSeller(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, addRecent]);

  useEffect(() => {
    if (!id) return;
    fetchFollowState(id)
      .then(state => {
        setIsFollowing(state.is_following);
        setFollowerCount(state.follower_count);
      })
      .catch(() => undefined);
  }, [id, session?.userId]);

  const dbReviewIds = dbReviews.map(r => r.id).join(',');
  useEffect(() => {
    if (!session?.userId || !dbReviewIds) return;
    fetchMyHelpfulReviewIds(dbReviewIds.split(','))
      .then(ids => setHelpfulReviews(new Set(ids)))
      .catch(() => undefined);
  }, [session?.userId, dbReviewIds]);

  const toggleFollow = async () => {
    if (!id || !requireAuth() || !session?.userId) return;
    const next = !isFollowing;
    setIsFollowing(next);
    setFollowerCount(c => Math.max(c + (next ? 1 : -1), 0));
    try {
      if (next) await followSeller(session.userId, id);
      else await unfollowSeller(session.userId, id);
    } catch {
      setIsFollowing(!next);
      setFollowerCount(c => Math.max(c + (next ? -1 : 1), 0));
      Alert.alert('İşlem yapılamadı', next ? 'Bu satıcı şu anda takip edilemiyor.' : 'Lütfen tekrar deneyin.');
    }
  };

  const changeHelpfulLocally = (reviewId: string, helpful: boolean) => {
    setHelpfulReviews(prev => {
      const updated = new Set(prev);
      if (helpful) updated.add(reviewId);
      else updated.delete(reviewId);
      return updated;
    });
    setDbReviews(prev => prev.map(r => (
      r.id === reviewId ? { ...r, helpful_count: Math.max(r.helpful_count + (helpful ? 1 : -1), 0) } : r
    )));
  };

  const toggleHelpful = async (reviewId: string) => {
    if (!requireAuth() || !session?.userId) return;
    const next = !helpfulReviews.has(reviewId);
    changeHelpfulLocally(reviewId, next);
    try {
      if (next) await markReviewHelpful(session.userId, reviewId);
      else await unmarkReviewHelpful(session.userId, reviewId);
    } catch {
      changeHelpfulLocally(reviewId, !next);
      Alert.alert('İşlem yapılamadı', next ? 'Kendi yorumunuzu faydalı olarak işaretleyemezsiniz.' : 'Lütfen tekrar deneyin.');
    }
  };

  const submitMessage = async () => {
    const body = messageText.trim();
    if (!id || !body || sendingMessage || !requireAuth()) return;
    setSendingMessage(true);
    try {
      const conversationId = await sendMessageToSeller(id, body);
      setMessageText('');
      messageSheetRef.current?.close();
      router.push(`/chat/${conversationId}` as any);
    } catch (e: any) {
      Alert.alert('Mesaj gönderilemedi', chatErrorMessage(e));
    } finally {
      setSendingMessage(false);
    }
  };

  const copyCampaignCode = async (code: string) => {
    await Clipboard.setStringAsync(code).catch(() => undefined);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const toggleFav = useCallback(() => {
    toggleFavorite(id!);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, friction: 3, tension: 200, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }, [id, heartScale, toggleFavorite]);

  const openOptionsOrAdd = useCallback(
    (item: MenuItem) => {
      const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0) || (item.portions && item.portions.length > 0);
      if (hasOptions) {
        setOptionsItem(item);
        setOptionsQty(1);
        setSelectedPortion(item.portions?.[0]?.id ?? null);
        setSelectedVariant(item.variants?.[0]?.id ?? null);
        setSelectedExtras(new Set());
        optionsSheetRef.current?.snapToIndex(1);
        return;
      }
      doAdd(item, item.price_cents, item.title);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  /** Karta dokununca ürün detayı: seçenek olmasa da fotoğraf ve açıklama görünür */
  const openDetail = useCallback((item: MenuItem) => {
    setOptionsItem(item);
    setOptionsQty(1);
    setSelectedPortion(item.portions?.[0]?.id ?? null);
    setSelectedVariant(item.variants?.[0]?.id ?? null);
    setSelectedExtras(new Set());
    optionsSheetRef.current?.snapToIndex(1);
  }, []);

  const doAdd = useCallback(
    (
      item: MenuItem,
      priceCents: number,
      title: string,
      selection: { variantId?: string | null; portionId?: string | null; extraIds?: string[] } = {},
    ) => {
      const ok = addItem(id!, {
        menuItemId: item.id,
        title,
        imageUrl: item.image_url,
        priceCents,
        ...selection,
      });
      if (!ok) {
        Alert.alert(
          'Sepet temizlensin mi?',
          'Sepetinde başka bir satıcıdan ürün var. Devam edersen sepet temizlenir.',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Temizle ve ekle',
              style: 'destructive',
              onPress: () =>
                forceAdd(id!, {
                  menuItemId: item.id,
                  title,
                  imageUrl: item.image_url,
                  priceCents,
                  ...selection,
                }),
            },
          ],
        );
      }
      return ok;
    },
    [id, addItem, forceAdd],
  );

  const confirmOptions = useCallback(() => {
    if (!optionsItem) return;
    const portion = optionsItem.portions?.find(p => p.id === selectedPortion);
    const variant = optionsItem.variants?.find(v => v.id === selectedVariant);
    const extrasArr = optionsItem.extras?.filter(e => selectedExtras.has(e.id)) ?? [];
    const totalPrice = optionsTotal(optionsItem, selectedPortion, selectedVariant, selectedExtras);

    const parts = [optionsItem.title];
    if (portion) parts.push(`(${portion.label})`);
    if (variant && optionsItem.variants && optionsItem.variants.length > 1) parts.push(`(${variant.label})`);
    if (extrasArr.length > 0) parts.push(`+ ${extrasArr.map(e => e.label).join(', ')}`);
    const title = parts.join(' ');

    // Fiyatı sunucu yeniden hesaplar; buradaki tutar yalnızca sepette gösterim içindir.
    for (let i = 0; i < optionsQty; i++) {
      const added = doAdd(optionsItem, totalPrice, title, {
        variantId: variant?.id ?? null,
        portionId: portion?.id ?? null,
        extraIds: extrasArr.map(e => e.id),
      });
      if (!added) break;
    }
    setOptionsItem(null);
    optionsSheetRef.current?.close();
  }, [optionsItem, selectedPortion, selectedVariant, selectedExtras, doAdd]);

  const fromThisSeller = cartSellerId === id;

  const displayReviews: DisplayReview[] = useMemo((): DisplayReview[] => {
    if (dbReviews.length > 0) {
      return dbReviews.map((r: ReviewRow) => ({
        id: r.id,
        name: 'Müşteri',
        rating: r.rating,
        date: (() => {
          const diffMs = Date.now() - new Date(r.created_at).getTime();
          const diffDay = Math.floor(diffMs / 86400000);
          if (diffDay === 0) return 'Bugün';
          if (diffDay === 1) return 'Dün';
          if (diffDay < 7) return `${diffDay} gün önce`;
          if (diffDay < 30) return `${Math.floor(diffDay / 7)} hafta önce`;
          return new Date(r.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
        })(),
        comment: r.comment ?? '',
        helpfulCount: r.helpful_count,
        menuItem: r.menu_item_title ?? undefined,
        sellerReply: r.seller_reply ?? undefined,
      }));
    }
    return [];
  }, [dbReviews]);

  // Sticky header opacity
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 140, 180],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  if (loading) {
    return (
      <View style={[st.loadingWrap, { backgroundColor: t.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={st.errorWrap}>
          <Text style={st.errorEmoji}>😕</Text>
          <Text style={[st.errorTitle, { color: t.text }]}>Satıcı bulunamadı</Text>
          <Pressable style={st.errorBtn} onPress={() => router.back()}>
            <Text style={st.errorBtnText}>← Geri dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const hasCart = fromThisSeller && totalItems > 0;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      {/* ═══ Sticky Header (scroll'da görünür — blur glass) ═══ */}
      <Animated.View style={[st.stickyHeader, { opacity: headerOpacity, backgroundColor: t.surface + 'B3' }]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top']} style={st.stickyInner}>
          <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={20} color="#151A16" />
          </Pressable>
          <Text style={[st.stickyTitle, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
          <View style={st.stickyRating}>
            <Text style={st.stickyRatingStar}>★</Text>
            <Text style={st.stickyRatingNum}>{Number(seller.rating_avg).toFixed(1).replace('.', ',')}</Text>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* ═══ Floating back & fav button (hero üstünde) ═══ */}
      <SafeAreaView edges={['top']} style={st.floatingBackWrap}>
        <View style={st.floatingRow}>
          <Pressable style={st.floatingBtn} onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Geri">
            <Ionicons name="chevron-back" size={22} color="#151A16" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={st.floatingBtn}
              onPress={() => seller && shareSeller(seller.display_name, Number(seller.rating_avg), seller.district ?? '')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Paylaş"
            >
              <Ionicons name="share-social-outline" size={20} color="#151A16" />
            </Pressable>
            <Pressable style={st.floatingBtn} onPress={toggleFav} hitSlop={12} accessibilityRole="button" accessibilityLabel={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}>
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={21} color={isFav ? '#CE3A1F' : '#151A16'} />
              </Animated.View>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[st.scroll, hasCart && { paddingBottom: 110 }]}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
      >
        {/* ═══ HERO COVER ═══ */}
        <View style={st.heroCover}>
          <FoodImage imageUrl={seller.photo} size={SCREEN_W} height={190} borderRadius={0} />
        </View>
        <View style={[st.sellerAvatar, { borderColor: t.surface }]}>
          {seller.logo ? (
            <FoodImage imageUrl={seller.logo} size={60} borderRadius={30} />
          ) : (
            <Text style={st.sellerAvatarText}>{seller.display_name.charAt(0).toLocaleUpperCase('tr')}</Text>
          )}
        </View>

        {/* ═══ SELLER INFO ═══ */}
        <View style={[st.infoSection, { backgroundColor: t.surface, borderBottomColor: t.divider }]}>
          <Text style={[st.sellerName, { color: t.heading }]}>{seller.display_name}</Text>

          <View style={st.ratingRow}>
            <Ionicons name="star" size={15} color="#E8A317" />
            <Text style={[st.ratingNumBig, { color: t.text }]}>
              {seller.rating_count > 0 ? Number(seller.rating_avg).toFixed(1).replace('.', ',') : 'Yeni'}
            </Text>
            {seller.rating_count > 0 ? <Text style={[st.ratingCountText, { color: t.textSecondary }]}>({seller.rating_count})</Text> : null}
            <Text style={[st.ratingCountText, { color: t.textSecondary }]}>·</Text>
            <Text style={st.verifiedText}>{seller.isRestaurant ? 'Onaylı restoran' : 'Onaylı mutfak'}</Text>
            <Text style={[st.ratingCountText, { color: t.textSecondary }]}>·</Text>
            <Text style={[st.ratingCountText, { color: isClosed ? '#C62828' : t.success }]}>{isClosed ? 'Şu an kapalı' : 'Açık'}</Text>
          </View>

          {seller.bio ? (
            <Text style={[st.sellerBio, { color: t.textSecondary }]}>{seller.bio}</Text>
          ) : null}

          <View style={[st.deliveryPill, { borderColor: t.surfaceBorder }]}>
            <View style={st.deliveryPillIcon}>
              <Ionicons name="bicycle" size={20} color="#fff" />
            </View>
            <View style={st.deliveryPillBody}>
              <Text style={[st.deliveryPillTitle, { color: t.text }]}>Teslimat: {seller.deliveryTime} dk</Text>
              <Text style={[st.deliveryPillSub, { color: t.textSecondary }]} numberOfLines={1}>
                {seller.deliveryFee > 0 ? `Ücret: ${priceTL(seller.deliveryFee)}` : 'Ücretsiz teslimat'}
                {seller.minOrder > 0 ? ` · Min. sipariş: ${priceTL(seller.minOrder)}` : ''}
              </Text>
            </View>
          </View>

          {/* Takip Et + Mesaj Gönder butonları */}
          <View style={st.actionBtnsRow}>
            <Pressable
              style={[st.followBtn, isFollowing && st.followBtnActive]}
              onPress={toggleFollow}
            >
              <Text style={[st.followBtnText, isFollowing && st.followBtnTextActive]}>
                {isFollowing ? '✓ Takiptesin' : '+ Takip et'}{followerCount > 0 ? ` · ${followerCount}` : ''}
              </Text>
            </Pressable>
            <Pressable
              style={st.messageBtnInline}
              onPress={() => messageSheetRef.current?.snapToIndex(0)}
            >
              <Ionicons name="chatbubble-outline" size={17} color={colors.ink} />
              <Text style={st.messageBtnInlineText}>Mesaj gönder</Text>
            </Pressable>
            <Pressable
              style={st.customOrderBtn}
              onPress={() => {
                setMessageText('Merhaba, özel bir sipariş vermek istiyorum: ');
                messageSheetRef.current?.snapToIndex(0);
              }}
            >
              <Text style={st.customOrderBtnText}>Özel sipariş iste</Text>
            </Pressable>
          </View>
        </View>

        {campaigns.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.campaignRow} style={{ backgroundColor: t.surface }}>
            {campaigns.map(c => (
              <Pressable key={c.id} style={st.campaignBox} onPress={() => copyCampaignCode(c.code)} accessibilityRole="button" accessibilityLabel={`Kuponu kopyala: ${c.code}`}>
                <Text style={st.campaignBoxTitle} numberOfLines={1}>
                  {c.discount_type === 'percent' ? `%${c.discount_value} indirim` : c.discount_type === 'fixed' ? `${priceTL(c.discount_value)} indirim` : 'Ücretsiz teslimat'}
                </Text>
                <Text style={st.campaignBoxSub} numberOfLines={1}>
                  {c.min_order_cents > 0 ? `Min. ${priceTL(c.min_order_cents)} · ` : ''}
                  {copiedCode === c.code ? 'Kopyalandı' : <>Kod: <Text style={st.campaignBoxCode}>{c.code}</Text></>}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* ═══ MENÜ ═══ */}
        <View style={[st.menuSection, { backgroundColor: t.surface }]}>
          {menuItems.length === 0 ? (
            <View style={st.emptyMenu}>
              <Ionicons name="restaurant-outline" size={40} color={t.textMuted} />
              <Text style={[st.emptyText, { color: t.textSecondary }]}>Bugünlük menü henüz hazır değil.</Text>
            </View>
          ) : (() => {
            const cats = ['Tümü', ...Array.from(new Set(menuItems.map(i => i.category ?? 'Diğer')))];
            const current = cats.includes(activeCat) ? activeCat : 'Tümü';
            const shown = current === 'Tümü' ? menuItems : menuItems.filter(i => (i.category ?? 'Diğer') === current);
            return (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.menuTabs} style={[st.menuTabsWrap, { borderBottomColor: t.divider }]}>
                  {cats.map(cat => {
                    const on = cat === current;
                    return (
                      <Pressable key={cat} style={[st.menuTab, on && { borderBottomColor: t.text }]} onPress={() => setActiveCat(cat)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                        <Text style={[st.menuTabText, { color: on ? t.text : t.textSecondary }, on && st.menuTabTextOn]}>{cat}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={st.menuGrid}>
                  {shown.map(item => {
                    // Aynı ürün farklı seçimlerle (varyant/ekstra) birden fazla satır olabilir.
                    const itemLines = fromThisSeller ? cartItems.filter(ci => ci.menuItemId === item.id) : [];
                    const qty = itemLines.reduce((sum, l) => sum + l.quantity, 0);
                    return (
                      <MenuCard
                        key={item.id}
                        item={item}
                        qty={qty}
                        onOpen={() => openDetail(item)}
                        onAdd={() => openOptionsOrAdd(item)}
                        onIncrement={() => (itemLines.length === 1 ? incrementItem(itemLines[0].lineKey) : openOptionsOrAdd(item))}
                        onDecrement={() => {
                          const last = itemLines[itemLines.length - 1];
                          if (last) decrementItem(last.lineKey);
                        }}
                      />
                    );
                  })}
                </View>
              </>
            );
          })()}
        </View>

        {/* ═══ ÇALIŞMA SAATLERİ ═══ */}
        {workingHours.length > 0 && (
          <View style={[st.hoursSection, { backgroundColor: t.surface }]}>
            <Pressable style={st.hoursTitleRow} onPress={() => setShowHours(!showHours)}>
              <Text style={[st.hoursHeading, { color: t.text }]}>Çalışma Saatleri</Text>
              <Text style={st.hoursToggle}>{showHours ? '▲' : '▼'}</Text>
            </Pressable>
            {showHours && (
              <View style={st.hoursCard}>
                {workingHours.map((wh: WorkingHours, idx: number) => {
                  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
                  const isToday = idx === todayIdx;
                  return (
                    <View key={wh.day} style={[st.hoursRow, isToday && st.hoursRowToday]}>
                      <Text style={[st.hoursDay, isToday && st.hoursDayToday]}>{wh.day}</Text>
                      <Text style={[st.hoursTime, !wh.open && st.hoursTimeClosed, isToday && st.hoursTimeToday]}>
                        {wh.hours}
                      </Text>
                      {isToday && <View style={st.hoursTodayDot} />}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ═══ YORUMLAR (GELİŞTİRİLMİŞ) ═══ */}
        {displayReviews.length > 0 && (
          <View style={[st.reviewsSection, { backgroundColor: t.surface }]}>
            <View style={st.menuHeader}>
              <Text style={[st.menuHeading, { color: t.text }]}>Değerlendirmeler</Text>
              <Text style={[st.menuCount, { color: t.textMuted }]}>{displayReviews.length} yorum</Text>
            </View>

            {/* Rating Summary */}
            {seller && (
              <View style={st.ratingSummary}>
                <View style={st.ratingSummaryLeft}>
                  <Text style={st.ratingSummaryNum}>{Number(seller.rating_avg).toFixed(1).replace('.', ',')}</Text>
                  <View style={st.ratingSummaryStars}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <Text key={s} style={[st.reviewStar, s <= Math.round(seller.rating_avg ?? 0) && st.reviewStarActive]}>★</Text>
                    ))}
                  </View>
                  <Text style={st.ratingSummaryCount}>{seller.rating_count} değerlendirme</Text>
                </View>
                <View style={st.ratingSummaryBars}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const reviews = displayReviews;
                    const count = reviews.filter(r => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <View key={star} style={st.ratingBarRow}>
                        <Text style={st.ratingBarLabel}>{star}</Text>
                        <View style={st.ratingBarTrack}>
                          <View style={[st.ratingBarFill, { width: `${Math.max(pct, 2)}%` }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* En beğenilen yorum highlight */}
            {(() => {
              const reviews = displayReviews;
              const topReview = [...reviews].sort((a, b) => b.helpfulCount - a.helpfulCount)[0];
              if (!topReview || topReview.helpfulCount < 5) return null;
              return (
                <View style={st.topReviewCard}>
                  <View style={st.topReviewBadge}>
                    <Text style={st.topReviewBadgeText}>En Beğenilen Yorum</Text>
                  </View>
                  <View style={st.reviewTop}>
                    <View style={[st.reviewAvatar, { backgroundColor: '#FFF8E1', borderColor: '#E3A90F' }]}>
                      <Text style={st.reviewAvatarText}>{topReview.name.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.reviewName, { color: t.text }]}>{topReview.name}</Text>
                      <View style={st.reviewStars}>
                        {[1, 2, 3, 4, 5].map(s => (
                          <Text key={s} style={[st.reviewStar, s <= topReview.rating && st.reviewStarActive]}>★</Text>
                        ))}
                      </View>
                    </View>
                    <Text style={st.helpfulCountHighlight}>👍 {topReview.helpfulCount}</Text>
                  </View>
                  <Text style={[st.reviewComment, { color: t.textSecondary }]}>{topReview.comment}</Text>
                  {topReview.menuItem && (
                    <View style={st.reviewMenuTag}>
                      <Text style={st.reviewMenuTagText}>🍽️ {topReview.menuItem}</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Tüm yorumlar */}
            {displayReviews.map(rev => (
              <View key={rev.id} style={[st.reviewCard, { borderTopColor: t.surfaceBorder }]}>
                <View style={st.reviewTop}>
                  <View style={st.reviewAvatar}>
                    <Text style={st.reviewAvatarText}>{rev.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.reviewName, { color: t.text }]}>{rev.name}</Text>
                    <Text style={[st.reviewDate, { color: t.textMuted }]}>{rev.date}</Text>
                  </View>
                  <View style={st.reviewStars}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <Text key={s} style={[st.reviewStar, s <= rev.rating && st.reviewStarActive]}>★</Text>
                    ))}
                  </View>
                </View>

                {/* Sipariş edilen ürün */}
                {rev.menuItem && (
                  <View style={st.reviewMenuTag}>
                    <Text style={st.reviewMenuTagText}>🍽️ {rev.menuItem}</Text>
                  </View>
                )}

                <Text style={[st.reviewComment, { color: t.textSecondary }]}>{rev.comment}</Text>

                {/* Satıcı Cevabı */}
                {rev.sellerReply && (
                  <View style={st.sellerReplyCard}>
                    <View style={st.sellerReplyHeader}>
                      <Text style={st.sellerReplyIcon}>💬</Text>
                      <Text style={st.sellerReplyLabel}>Satıcı Yanıtı</Text>
                    </View>
                    <Text style={st.sellerReplyText}>{rev.sellerReply}</Text>
                  </View>
                )}

                {/* Faydalı butonu */}
                <View style={st.reviewActions}>
                  <Pressable
                    style={[st.helpfulBtn, helpfulReviews.has(rev.id) && st.helpfulBtnActive]}
                    onPress={() => toggleHelpful(rev.id)}
                  >
                    <Text style={[st.helpfulBtnText, helpfulReviews.has(rev.id) && st.helpfulBtnTextActive]}>
                      Faydalı ({rev.helpfulCount})
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ═══ TESLİMAT DETAYLARI ═══ */}
        <View style={[st.deliverySection, { backgroundColor: t.surface }]}>
          <Text style={[st.sectionTitle, { color: t.text }]}>Teslimat Bilgileri</Text>

          <View style={[st.deliveryCard, { backgroundColor: t.background, borderColor: t.surfaceBorder }]}>
            <View style={st.deliveryRow}>
              <Text style={st.deliveryIcon}>🚗</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Süresi</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.deliveryTime} dk</Text>
              </View>
            </View>

            <View style={st.deliveryDivider} />

            <View style={st.deliveryRow}>
              <Text style={st.deliveryIcon}>💰</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Min. Sipariş</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.minOrder > 0 ? priceTL(seller.minOrder) : 'Yok'}</Text>
              </View>
            </View>

            <View style={st.deliveryDivider} />

            <View style={st.deliveryRow}>
              <Text style={st.deliveryIcon}>📍</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Bölgesi</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.district ?? seller.city ?? 'Belirtilmemiş'}{radiusKm != null && seller.latitude != null ? ` · ${radiusKm} km` : ''}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ═══ SATICI BİLGİSİ ═══ */}
        {seller.bio && (
          <View style={[st.storySection, { backgroundColor: t.surface }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Beni Tanıyın</Text>
            <View style={st.storyCard}>
              <Text style={[st.storyText, { color: t.textSecondary }]}>{seller.bio}</Text>
            </View>
          </View>
        )}

        {/* ═══ SATICI BİLGİLERİ ═══ */}
        <View style={[st.aboutSection, { backgroundColor: t.background }]}>
          <Text style={[st.aboutHeading, { color: t.text }]}>Satıcı Hakkında</Text>
          <View style={[st.aboutCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>Konum</Text>
              <Text style={st.aboutValue}>
                {[seller.address_line, seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>Teslimat</Text>
              <Text style={st.aboutValue}>{seller.deliveryTime} dakika</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>Min. Sipariş</Text>
              <Text style={st.aboutValue}>{seller.minOrder > 0 ? priceTL(seller.minOrder) : 'Yok'}</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>Puan</Text>
              <Text style={st.aboutValue}>
                {Number(seller.rating_avg).toFixed(1).replace('.', ',')} ({seller.rating_count} yorum)
              </Text>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ═══ CART BAR ═══ */}
      {hasCart && (
        <SafeAreaView edges={['bottom']} style={st.cartBar} pointerEvents="box-none">
          <Pressable style={st.cartPill} onPress={() => router.push('/(customer)/cart')} accessibilityRole="button">
            <Text style={st.cartPillText}>Sepeti görüntüle · {totalItems} ürün</Text>
            <Text style={st.cartPillText}>{priceTL(totalCents)}</Text>
          </Pressable>
        </SafeAreaView>
      )}
      {/* VARIANT / EXTRAS BOTTOM SHEET */}
      <BottomSheet
        ref={optionsSheetRef}
        index={-1}
        snapPoints={optionsSnapPoints}
        enablePanDownToClose
        onClose={() => setOptionsItem(null)}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        handleIndicatorStyle={{ backgroundColor: '#C9CEC5', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetScrollView contentContainerStyle={st.optionsInner}>
          {optionsItem && (
            <>
              <FoodImage imageUrl={optionsItem.image_url} size={SCREEN_W - 32} height={200} borderRadius={16} />
              {optionsItem.remaining_today != null ? (
                <View style={[st.stockTag, { backgroundColor: t.chip }]}>
                  <Text style={[st.stockTagText, { color: t.text }]}>Bugün için {optionsItem.remaining_today} porsiyon kaldı</Text>
                </View>
              ) : null}
              <View style={st.optionsHeader}>
                <Text style={[st.optionsTitle, { color: t.heading }]}>{optionsItem.title}</Text>
                <Pressable onPress={() => optionsSheetRef.current?.close()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={t.text} />
                </Pressable>
              </View>
              <Text style={st.optionsPriceBig}>{priceTL(optionsItem.portions?.[0]?.priceCents ?? optionsItem.price_cents)}</Text>
              {optionsItem.description ? (
                <Text style={[st.optionsDesc, { color: t.textSecondary }]}>{optionsItem.description}</Text>
              ) : null}

              {/* Portions */}
              {optionsItem.portions && optionsItem.portions.length > 0 && (
                <View style={st.optionsSection}>
                  <View style={st.optionsSectionHead}>
                    <Text style={[st.optionsSectionTitle, { color: t.text }]}>Porsiyon</Text>
                    <View style={[st.optionsTag, st.optionsTagReq]}>
                      <Text style={[st.optionsTagText, { color: '#fff' }]}>Zorunlu</Text>
                    </View>
                  </View>
                  {optionsItem.portions.map(p => {
                    const active = selectedPortion === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        style={[st.optionRow, active && st.optionRowActive]}
                        onPress={() => setSelectedPortion(p.id)}
                      >
                        <View style={[st.optionRadio, active && st.optionRadioActive]}>
                          {active && <View style={st.optionRadioDot} />}
                        </View>
                        <Text style={[st.optionLabel, active && st.optionLabelActive]}>{p.label}</Text>
                        <Text style={st.optionPrice}>{priceTL(p.priceCents)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Variants */}
              {optionsItem.variants && optionsItem.variants.length > 0 && (
                <View style={st.optionsSection}>
                  <View style={st.optionsSectionHead}>
                    <Text style={[st.optionsSectionTitle, { color: t.text }]}>Seçenek</Text>
                    <View style={[st.optionsTag, st.optionsTagReq]}>
                      <Text style={[st.optionsTagText, { color: '#fff' }]}>Zorunlu</Text>
                    </View>
                  </View>
                  {optionsItem.variants.map(v => {
                    const active = selectedVariant === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        style={[st.optionRow, active && st.optionRowActive]}
                        onPress={() => setSelectedVariant(v.id)}
                      >
                        <View style={[st.optionRadio, active && st.optionRadioActive]}>
                          {active && <View style={st.optionRadioDot} />}
                        </View>
                        <Text style={[st.optionLabel, active && st.optionLabelActive]}>{v.label}</Text>
                        <Text style={st.optionPrice}>
                          {v.priceDiffCents === 0
                            ? ''
                            : v.priceDiffCents > 0
                              ? `+${priceTL(v.priceDiffCents)}`
                              : `-${priceTL(Math.abs(v.priceDiffCents))}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Extras */}
              {optionsItem.extras && optionsItem.extras.length > 0 && (
                <View style={st.optionsSection}>
                  <View style={st.optionsSectionHead}>
                    <Text style={[st.optionsSectionTitle, { color: t.text }]}>Yanına ekle</Text>
                    <View style={[st.optionsTag, { backgroundColor: t.chip }]}>
                      <Text style={[st.optionsTagText, { color: t.text }]}>İsteğe bağlı</Text>
                    </View>
                  </View>
                  {optionsItem.extras.map(e => {
                    const checked = selectedExtras.has(e.id);
                    return (
                      <Pressable
                        key={e.id}
                        style={[st.optionRow, checked && st.optionRowActive]}
                        onPress={() => setSelectedExtras(prev => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id);
                          else next.add(e.id);
                          return next;
                        })}
                      >
                        <View style={[st.optionCheck, checked && st.optionCheckActive]}>
                          {checked && <Text style={st.optionCheckMark}>✓</Text>}
                        </View>
                        <Text style={[st.optionLabel, checked && st.optionLabelActive]}>{e.label}</Text>
                        <Text style={st.optionPrice}>+ {priceTL(e.priceCents)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Total & Confirm */}
              <View style={st.optionsFooter}>
                <View style={st.optionsStepper}>
                  <Pressable style={[st.optionsStepBtn, { borderColor: t.surfaceBorder }]} onPress={() => setOptionsQty(q => Math.max(1, q - 1))} accessibilityRole="button" accessibilityLabel="Azalt">
                    <Ionicons name="remove" size={20} color={t.text} />
                  </Pressable>
                  <Text style={[st.optionsQty, { color: t.text }]}>{optionsQty}</Text>
                  <Pressable style={[st.optionsStepBtn, { borderColor: t.surfaceBorder }]} onPress={() => setOptionsQty(q => q + 1)} accessibilityRole="button" accessibilityLabel="Artır">
                    <Ionicons name="add" size={20} color={t.text} />
                  </Pressable>
                </View>
                <Pressable style={st.optionsConfirmBtn} onPress={confirmOptions} accessibilityRole="button">
                  <Text style={st.optionsConfirmText}>
                    Sepete ekle · {priceTL(optionsTotal(optionsItem, selectedPortion, selectedVariant, selectedExtras) * optionsQty)}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>

      {/* ═══ MESAJ BOTTOM SHEET ═══ */}
      <BottomSheet
        ref={messageSheetRef}
        index={-1}
        snapPoints={messageSnapPoints}
        enablePanDownToClose
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        handleIndicatorStyle={{ backgroundColor: '#C9CEC5', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.optionsInner}>
          <View style={st.optionsHeader}>
            <Text style={st.optionsTitle}>Mesaj Gönder</Text>
            <Pressable onPress={() => messageSheetRef.current?.close()} hitSlop={8}>
              <Text style={st.optionsClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={[st.msgSubtitle, { color: t.textMuted }]}>
            Satıcıya soru sorun veya özel sipariş isteyin
          </Text>
          <TextInput
            style={[st.msgInput, { backgroundColor: t.background, color: t.text, borderColor: t.surfaceBorder }]}
            placeholder="Mesajınızı yazın..."
            placeholderTextColor={t.textMuted}
            value={messageText}
            onChangeText={setMessageText}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <View style={st.msgQuickBtns}>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Bu yemeği ne zaman hazırlayabilirsiniz?')}>
              <Text style={st.msgQuickBtnText}>Ne zaman hazır?</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Alerjen içermeyen seçenekleriniz var mı?')}>
              <Text style={st.msgQuickBtnText}>Alerjen bilgisi</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Özel bir sipariş vermek istiyorum: ')}>
              <Text style={st.msgQuickBtnText}>Özel sipariş</Text>
            </Pressable>
          </View>
          <Pressable
            style={[st.msgSendBtn, (!messageText.trim() || sendingMessage) && { opacity: 0.5 }]}
            onPress={submitMessage}
            disabled={!messageText.trim() || sendingMessage}
          >
            <Text style={st.msgSendBtnText}>{sendingMessage ? 'Gönderiliyor...' : 'Gönder'}</Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  errorTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  errorBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  errorBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  scroll: { paddingBottom: 32 },

  // ── Sticky Header
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(240,236,230,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  stickyTitle: { flex: 1, fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  stickyRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stickyRatingStar: { fontFamily: fonts.regular, fontSize: 14, color: '#E3A90F' },
  stickyRatingNum: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16' },

  // ── Floating buttons
  floatingBackWrap: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 5,
  },
  floatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  floatingBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hero Cover
  heroCover: { height: 190, width: SCREEN_W, backgroundColor: colors.mint },
  sellerAvatar: {
    position: 'absolute',
    top: 156,
    left: SCREEN_W / 2 - 33,
    zIndex: 2,
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatarText: { fontSize: 24, fontFamily: fonts.display, color: '#fff' },

  // ── Info Section
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 42,
    paddingBottom: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  sellerName: { fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4, textAlign: 'center', marginBottom: 4 },

  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ratingNumBig: { fontSize: 13, fontFamily: fonts.bold },
  ratingCountText: { fontFamily: fonts.regular, fontSize: 13 },
  verifiedText: { fontSize: 13, color: colors.primary, fontFamily: fonts.semibold },

  sellerBio: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },

  deliveryPill: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 8,
    paddingRight: 14,
    borderWidth: 1,
    borderRadius: 30,
  },
  deliveryPillIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  deliveryPillBody: { flex: 1, minWidth: 0 },
  deliveryPillTitle: { fontSize: 13, lineHeight: 17, fontFamily: fonts.bold },
  deliveryPillSub: { fontSize: 13, lineHeight: 17, fontFamily: fonts.regular },


  // ── Menu Section
  menuSection: { paddingBottom: 20 },
  menuTabsWrap: { borderBottomWidth: 1 },
  menuTabs: { paddingHorizontal: 16, gap: 20 },
  menuTab: { paddingTop: 12, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  menuTabText: { fontSize: 14, fontFamily: fonts.regular },
  menuTabTextOn: { fontFamily: fonts.bold },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  menuCard: { width: GRID_W, borderWidth: 1, borderRadius: 14, padding: 5 },
  menuCardDisabled: { opacity: 0.6 },
  menuTitle: { fontSize: 14, fontFamily: fonts.semibold, paddingHorizontal: 5, paddingTop: 8 },
  menuDesc: { fontSize: 12, fontFamily: fonts.regular, paddingHorizontal: 5, paddingTop: 1 },
  menuPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 5, paddingTop: 4, paddingBottom: 3 },
  menuPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  menuBadge: { flexShrink: 1, fontSize: 11, fontFamily: fonts.semibold },
  soldOutOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 10, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center' },
  soldOutText: { fontSize: 13, fontFamily: fonts.bold, color: '#fff' },
  addBtn: { position: 'absolute', right: 6, bottom: 6, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center' },
  qtyControl: { position: 'absolute', right: 6, bottom: 6, height: 32, borderRadius: 16, backgroundColor: colors.secondary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 },
  qtyBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { minWidth: 18, textAlign: 'center', fontSize: 13, fontFamily: fonts.bold, color: '#fff' },
  emptyMenu: { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular },

  // ── Kampanya kutuları
  campaignRow: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  campaignBox: { width: 196, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FFF9E6' },
  campaignBoxTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  campaignBoxSub: { fontSize: 12, fontFamily: fonts.regular, color: '#56605A', marginTop: 2 },
  campaignBoxCode: { fontFamily: fonts.bold, color: colors.primary },

  // ── Bölüm başlıkları
  menuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  menuHeading: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.4 },
  menuCount: { fontSize: 13, fontFamily: fonts.medium },
  sectionTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.4, marginBottom: 12 },

  // ── Yüzen sepet
  cartPill: { height: 54, borderRadius: 27, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12, shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 8 },
  cartPillText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },


  // ── About Section
  aboutSection: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16 },
  aboutHeading: { fontSize: 18, fontFamily: fonts.display, color: '#151A16', marginBottom: 12 },
  aboutCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
  aboutValue: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16', textAlign: 'right', maxWidth: '55%' },
  aboutDivider: { height: 1, backgroundColor: '#EFF2EA' },

  // ── Cart Bar
  cartBar: { position: 'absolute', left: 16, right: 16, bottom: 12 },
  cartBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 14, fontFamily: fonts.extrabold, color: '#fff' },
  cartBarLabel: { fontSize: 12, color: '#6B766F', fontFamily: fonts.medium },
  cartBarPrice: { fontSize: 17, fontFamily: fonts.extrabold, color: '#151A16' },
  cartBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  cartBarBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },

  // ── Working Hours
  closedBanner: { marginHorizontal: 16, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#FFEBEE' },
  closedBannerText: { fontSize: 13, fontFamily: fonts.bold, color: '#C62828', textAlign: 'center' },
  hoursSection: { paddingHorizontal: 16, paddingTop: 24 },
  hoursTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hoursHeading: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  hoursToggle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F' },
  hoursCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EDEFE8',
    gap: 2,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  hoursRowToday: { backgroundColor: '#FFF4F1' },
  hoursDay: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A', width: 90 },
  hoursDayToday: { color: colors.primary, fontFamily: fonts.extrabold },
  hoursTime: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  hoursTimeClosed: { color: '#C62828' },
  hoursTimeToday: { color: colors.primary, fontFamily: fonts.extrabold },
  hoursTodayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginLeft: 8,
  },

  // Reviews
  reviewsSection: { paddingHorizontal: 16, marginTop: 20, gap: 10 },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDEFE8',
    padding: 14,
    gap: 10,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FAF8F2',
    borderWidth: 1,
    borderColor: '#E3E6DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 14, fontFamily: fonts.bold, color: '#56605A' },
  reviewName: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16' },
  reviewDate: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F' },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewStar: { fontFamily: fonts.regular, fontSize: 12, color: '#DDE1D8' },
  reviewStarActive: { color: '#E3A90F' },
  reviewComment: { fontFamily: fonts.regular, fontSize: 13, color: '#56605A', lineHeight: 19 },

  // Options modal
  optionsCard: { backgroundColor: '#fff' },
  optionsInner: { padding: 20, paddingBottom: 34 },
  optionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  optionsTitle: { flex: 1, fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4 },
  optionsDesc: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, marginTop: 6 },
  optionsSection: { marginTop: 16 },
  optionsSectionTitle: { fontSize: 15, fontFamily: fonts.bold },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: '#FAF8F2', borderWidth: 1, borderColor: '#EDEFE8' },
  optionRowActive: { backgroundColor: '#FBEDE9', borderColor: colors.primary },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#C9CEC5', alignItems: 'center', justifyContent: 'center' },
  optionRadioActive: { borderColor: colors.primary },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  optionCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#C9CEC5', alignItems: 'center', justifyContent: 'center' },
  optionCheckActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionCheckMark: { fontSize: 12, fontFamily: fonts.extrabold, color: '#fff' },
  optionLabel: { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  optionLabelActive: { color: colors.primary, fontFamily: fonts.bold },
  optionPrice: { fontSize: 13, fontFamily: fonts.bold, color: '#56605A' },
  optionsFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingBottom: 16 },
  optionsConfirmBtn: { flex: 1, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  optionsConfirmText: { color: '#fff', fontSize: 15, fontFamily: fonts.bold },

  // Rating summary
  ratingSummary: { flexDirection: 'row', backgroundColor: '#FAF8F2', borderRadius: 16, padding: 16, marginBottom: 14, gap: 20, borderWidth: 1, borderColor: '#EDEFE8' },
  ratingSummaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  ratingSummaryNum: { fontSize: 36, fontFamily: fonts.display, color: '#151A16' },
  ratingSummaryStars: { flexDirection: 'row', gap: 2 },
  ratingSummaryCount: { fontSize: 11, color: '#6B766F', fontFamily: fonts.medium, marginTop: 2 },
  ratingSummaryBars: { flex: 1, justifyContent: 'center', gap: 5 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingBarLabel: { fontSize: 12, fontFamily: fonts.bold, color: '#6B766F', width: 12, textAlign: 'center' },
  ratingBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E3E6DE', overflow: 'hidden' },
  ratingBarFill: { height: '100%', borderRadius: 3, backgroundColor: '#E3A90F' },

  // ── Action Buttons (Takip Et, Mesaj, Özel Sipariş)
  actionBtnsRow: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  followBtn: {
    flex: 1,
    minWidth: 130,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnActive: { backgroundColor: colors.primary },
  followBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  followBtnTextActive: { color: '#fff' },
  messageBtnInline: {
    flex: 1,
    minWidth: 130,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF2EA',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageBtnInlineText: { fontSize: 14, fontFamily: fonts.bold, color: colors.ink },
  customOrderBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customOrderBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.secondary },



  // ── Menu Tags (Alerjen, Kalori, Stok)
  menuTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  calorieBadge: {
    backgroundColor: '#EFF2EA',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  calorieBadgeText: { fontSize: 9, fontFamily: fonts.bold, color: '#6B766F' },
  dietBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dietBadgeText: { fontSize: 9, fontFamily: fonts.bold },
  allergenBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  allergenBadgeText: { fontSize: 9, fontFamily: fonts.bold, color: '#E65100' },
  stockBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stockBadgeSoldOut: { backgroundColor: '#FFEBEE' },
  stockBadgeText: { fontSize: 9, fontFamily: fonts.bold, color: '#2E7D32' },
  stockBadgeTextSoldOut: { color: '#C62828' },

  // ── Enhanced Reviews
  topReviewCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  topReviewBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E3A90F',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  topReviewBadgeText: { fontSize: 10, fontFamily: fonts.extrabold, color: '#fff' },
  helpfulCountHighlight: { fontSize: 13, fontFamily: fonts.bold, color: '#E3A90F' },
  reviewMenuTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF2EA',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reviewMenuTagText: { fontSize: 11, fontFamily: fonts.semibold, color: '#56605A' },
  sellerReplyCard: {
    backgroundColor: '#F0FFF4',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#2E7D32',
  },
  sellerReplyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  sellerReplyIcon: { fontFamily: fonts.regular, fontSize: 12 },
  sellerReplyLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#2E7D32' },
  sellerReplyText: { fontFamily: fonts.regular, fontSize: 12, color: '#4E342E', lineHeight: 17 },
  reviewActions: { flexDirection: 'row', marginTop: 4 },
  helpfulBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF2EA',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  helpfulBtnActive: { backgroundColor: '#E3F2FD' },
  helpfulBtnText: { fontSize: 11, fontFamily: fonts.semibold, color: '#6B766F' },
  helpfulBtnTextActive: { color: '#1565C0' },

  // ── Delivery Section
  deliverySection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  deliveryCard: {
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  deliveryIcon: { fontFamily: fonts.regular, fontSize: 20, marginTop: 2 },
  deliveryLabel: { fontSize: 11, fontFamily: fonts.medium, marginBottom: 2 },
  deliveryValue: { fontSize: 13, fontFamily: fonts.semibold },
  deliveryFreeNote: { fontSize: 11, fontFamily: fonts.medium, color: '#2E7D32' },
  deliveryDivider: { height: 1, backgroundColor: '#EDEFE8', marginHorizontal: 14 },
  deliveryZonesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  deliveryZoneChip: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deliveryZoneText: { fontSize: 12, fontFamily: fonts.semibold, color: '#1565C0' },

  // ── Seller Story
  storySection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  storyCard: {
    backgroundColor: '#FAF8F2',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  storyMotivation: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.primary, fontStyle: 'italic', textAlign: 'center' },
  storyText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  expertiseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  expertiseTag: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#EDEFE8',
  },
  expertiseTagText: { fontSize: 12, fontFamily: fonts.semibold, color: '#56605A' },
  socialRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  socialBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#EDEFE8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  socialBtnText: { fontSize: 12, fontFamily: fonts.bold, color: '#151A16' },

  // ── Message BottomSheet
  msgSubtitle: { fontFamily: fonts.regular, fontSize: 13, marginBottom: 12 },
  msgInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontFamily: fonts.regular, fontSize: 14,
    minHeight: 80,
    marginBottom: 10,
  },
  msgQuickBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  msgQuickBtn: {
    backgroundColor: '#EFF2EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  msgQuickBtnText: { fontSize: 11, fontFamily: fonts.semibold, color: '#56605A' },
  msgSendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  msgSendBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.extrabold },
  optionsPriceBig: { fontSize: 18, fontFamily: fonts.bold, color: colors.primary, marginTop: 2 },
  optionsSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  optionsTag: { height: 24, paddingHorizontal: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionsClose: { fontSize: 18, fontFamily: fonts.regular, color: '#6B766F' },
  optionsTagReq: { backgroundColor: colors.secondary },
  optionsTagText: { fontSize: 12, fontFamily: fonts.semibold },
  optionsStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  optionsStepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  optionsQty: { width: 22, textAlign: 'center', fontSize: 16, fontFamily: fonts.bold },
  stockTag: { alignSelf: 'flex-start', height: 24, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  stockTagText: { fontSize: 12, fontFamily: fonts.semibold },
});
