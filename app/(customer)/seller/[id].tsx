import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';

import { useCart } from '@/lib/cart-context';
import { useFavorites } from '@/lib/favorites-context';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import { useTheme } from '@/lib/theme-context';
import { shareSeller } from '@/lib/social-share';
import type { MenuItem, Seller } from '@/types';
import FoodImage from '@/components/shared/FoodImage';
import { FoodFilterChips, FoodLabels } from '@/components/shared/FoodFilters';
import { CartButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import Ionicons from '@expo/vector-icons/Ionicons';
import { sellerPhoto } from '@/lib/food-images';
import { isOpenAt, istanbulClock, istanbulToday } from '@/lib/date';
import { mealCardLabels } from '@/lib/order-options';
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
import { allergenSummary } from '@/lib/allergens';
import { track } from '@/lib/analytics';
import { categoryLabel } from '@/lib/menu-categories';
import { groupMenu } from '@/lib/menu-sections';
import {
  customerGroups,
  groupRuleLabel,
  groupsFromRows,
  optionsCanRaisePrice,
  requiredOptionsMin,
  selectedOptionIds,
  selectedOptionsTotal,
  selectionError,
  selectionSummary,
  toggleOption,
} from '@/lib/option-groups';
import { availableFoodFilters, dietaryLabels, foodDetailLabels, matchesFoodFilters, toggleKey, type FoodFilterKey } from '@/lib/dietary';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { LogoLoader } from '@/components/shared/Logo';
import { Seo } from '@/components/shared/Seo';
import { cuisineLabel } from '@/lib/cuisines';
import { restaurantDescription, restaurantJsonLd, restaurantTitle } from '@/lib/seo';


function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace('.', ',')}`;
}

/** Telefonda kaydırınca görünen üst şeridin ve sekmelerin yüksekliği (güvenli alan hariç) */
const STICKY_HEIGHT = 60;
const TABS_HEIGHT = 46;

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
  mealCards: string[];
  pickupEnabled: boolean;
  acceptsScheduled: boolean;
  isPaused: boolean;
  cuisines: string[];
};

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

/** Sunucudaki place_order ile aynı hesap: porsiyon menü fiyatının yerine geçer. */
function optionsTotal(item: MenuItem, portionId: string | null, variantId: string | null, extraIds: Set<string>, optionIds: ReadonlySet<string>): number {
  const base = item.portions?.find(p => p.id === portionId)?.priceCents ?? item.price_cents;
  const variantDiff = item.variants?.find(v => v.id === variantId)?.priceDiffCents ?? 0;
  const extras = item.extras?.filter(e => extraIds.has(e.id)).reduce((sum, e) => sum + e.priceCents, 0) ?? 0;
  return base + variantDiff + extras + selectedOptionsTotal(item.optionGroups ?? [], optionIds);
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

const BADGE_CONFIG: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  popular: { label: 'Popüler', icon: 'trending-up-outline' },
  new: { label: 'Yeni', icon: 'sparkles-outline' },
  spicy: { label: 'Acılı', icon: 'flame-outline' },
};

/** Kategori sekmelerinin yanındaki "Yorumlar" sekmesi */
const REVIEWS_TAB = '__yorumlar';

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
  const groups = item.optionGroups ?? [];
  const fromPrice = (item.portions && item.portions.length > 0
    ? Math.min(...item.portions.map(p => p.priceCents))
    : item.price_cents) + requiredOptionsMin(groups);
  // Fiyatı değişen porsiyon varsa gösterilen en düşüğüdür, müşteri bunu bilsin.
  const priceRange = new Set(item.portions?.map(p => p.priceCents) ?? []).size > 1 || optionsCanRaisePrice(groups);
  const priceText = `${priceTL(fromPrice)}${priceRange ? ' ve üzeri' : ''}`;

  return (
    <Pressable
      style={[st.menuCard, { backgroundColor: t.surface }]}
      onPress={item.is_available ? onOpen : undefined}
      accessibilityLabel={`${item.title}, ${priceText}${item.is_available ? '' : ', bugünlük bitti'}`}
    >
      <View style={st.menuBody}>
        <Text style={[st.menuTitle, { color: item.is_available ? t.text : t.textSecondary }]} numberOfLines={2}>{item.title}</Text>
        {item.description ? (
          <Text style={[st.menuDesc, { color: t.textSecondary }]} numberOfLines={2}>{item.description}</Text>
        ) : null}
        {item.allergens && item.allergens.length > 0 ? (
          <Text style={[st.menuDesc, { color: t.text }]} numberOfLines={1}>{allergenSummary(item.allergens)}</Text>
        ) : null}
        <Text style={[st.menuPrice, { color: item.is_available ? t.text : t.textSecondary }]}>{priceText}</Text>
        <FoodLabels labels={dietaryLabels(item)} />
        {badge || !item.is_available || (item.remaining_today != null && item.remaining_today <= 5) ? (
          <View style={st.menuTags}>
            {badge ? (
              <View style={[st.menuBadge, { backgroundColor: t.background }]}>
                <Ionicons name={badge.icon} size={12} color={t.text} />
                <Text style={[st.menuBadgeText, { color: t.text }]} numberOfLines={1}>{badge.label}</Text>
              </View>
            ) : null}
            {!item.is_available ? <Text style={[st.menuOut, { color: t.danger }]}>Bugünlük bitti</Text> : null}
            {item.is_available && item.remaining_today != null && item.remaining_today <= 5 ? (
              <Text style={[st.menuFew, { color: t.textSecondary }]}>{item.remaining_today} porsiyon kaldı</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={st.menuPhoto}>
        <View style={!item.is_available && st.menuPhotoOff}>
          <FoodImage imageUrl={item.image_url} size={88} borderRadius={44} />
        </View>
        {item.is_available ? (
          qty === 0 ? (
            <Pressable style={[st.addBtn, { backgroundColor: t.brand }]} onPress={onAdd} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${item.title} sepete ekle`}>
              <Ionicons name="add" size={20} color={t.onBrand} />
            </Pressable>
          ) : (
            <View style={[st.qtyControl, { backgroundColor: t.brand }]}>
              <Pressable style={st.qtyBtn} onPress={onDecrement} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${item.title} azalt`}>
                <Ionicons name="remove" size={18} color={t.onBrand} />
              </Pressable>
              <Text style={[st.qtyNum, { color: t.onBrand }]}>{qty}</Text>
              <Pressable style={st.qtyBtn} onPress={onIncrement} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${item.title} artır`}>
                <Ionicons name="add" size={18} color={t.onBrand} />
              </Pressable>
            </View>
          )
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SellerDetailScreen() {
  const { isDesktop, pageWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const heroHeight = isDesktop ? 240 : 230 + insets.top;
  /** Üst şeridin tamamen görünür olduğu kaydırma konumu: sheet şeridin altına girmeden hemen önce */
  const stickyEnd = isDesktop ? 180 : 146;
  const scrollRef = useRef<any>(null);
  const menuTopRef = useRef(0);
  const listTopRef = useRef(0);
  const sectionTops = useRef<Record<string, number>>({});
  const reviewsTopRef = useRef(0);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showCatBar, setShowCatBar] = useState(false);
  const [stickyActive, setStickyActive] = useState(false);
  const scrollToSection = (cat: string) => {
    const y = cat === REVIEWS_TAB
      ? reviewsTopRef.current
      : menuTopRef.current + listTopRef.current + (sectionTops.current[cat] ?? 0);
    scrollRef.current?.scrollTo?.({ y: Math.max(y - (isDesktop ? 72 : insets.top + STICKY_HEIGHT + TABS_HEIGHT + 6), 0), animated: true });
    setActiveSection(cat);
  };
  const sheetWidth = isDesktop ? 560 : pageWidth;
  const sheetStyle = isDesktop ? { marginHorizontal: (pageWidth - sheetWidth) / 2 } : undefined;
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
  const [foodFilters, setFoodFilters] = useState<FoodFilterKey[]>([]);
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
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
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
    track('view_restaurant', { seller_id: id });

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
            mealCards: mealCardLabels(result.meal_cards),
            pickupEnabled: !!result.pickup_enabled,
            acceptsScheduled: !!result.accepts_scheduled,
            isPaused: !!result.is_paused,
            cuisines: result.cuisines ?? [],
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
          // Restoranın kendi bölümleri varsa ürünler onların altında, bölüm ve ürün sırasıyla görünür (057).
          const sections = result.menu_sections ?? [];
          const ordered = groupMenu(
            result.menu_items
              .filter(m => !todaysItems || todaysItems.has(m.id))
              .map(m => ({ ...m, category: categoryLabel(m.category) })),
            sections,
          ).flatMap(g => g.items.map(m => ({ m, section: g.title })));
          const items: MenuItem[] = ordered
            .map(({ m, section }) => {
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
              allergens: m.allergens ?? null,
              dietary: m.dietary ?? [],
              price_cents: m.price_cents,
              currency: m.currency,
              image_url: m.image_url,
              is_available: m.is_available && remainingToday(m.daily_limit, m.sold_today, m.stock_reset_date, istanbulToday()) !== 0,
              remaining_today: remainingToday(m.daily_limit, m.sold_today, m.stock_reset_date, istanbulToday()),
              category: section,
              created_at: m.created_at,
              updated_at: m.updated_at,
              variants: variants.length > 0 ? variants : undefined,
              extras: extras.length > 0 ? extras : undefined,
              portions: portions.length > 0 ? portions : undefined,
              optionGroups: customerGroups(groupsFromRows(m.menu_option_groups)),
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
      Alert.alert('İşlem yapılamadı', next ? 'Bu satıcı şu anda takip edilemiyor.' : 'Lütfen tekrar dene.');
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
      Alert.alert('İşlem yapılamadı', next ? 'Kendi yorumunu faydalı olarak işaretleyemezsin.' : 'Lütfen tekrar dene.');
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
      const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0) || (item.portions && item.portions.length > 0) || (item.optionGroups && item.optionGroups.length > 0);
      if (hasOptions) {
        setOptionsItem(item);
        setOptionsQty(1);
        setSelectedPortion(item.portions?.[0]?.id ?? null);
        setSelectedVariant(item.variants?.[0]?.id ?? null);
        setSelectedExtras(new Set());
        setSelectedOptions(new Set());
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
    setSelectedOptions(new Set());
    optionsSheetRef.current?.snapToIndex(1);
  }, []);

  const doAdd = useCallback(
    (
      item: MenuItem,
      priceCents: number,
      title: string,
      selection: { variantId?: string | null; portionId?: string | null; extraIds?: string[]; optionIds?: string[] } = {},
      qty = 1,
    ) => {
      const ok = addItem(id!, {
        menuItemId: item.id,
        title,
        imageUrl: item.image_url,
        priceCents,
        ...selection,
      }, qty);
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
                }, qty),
            },
          ],
        );
      }
    },
    [id, addItem, forceAdd],
  );

  const confirmOptions = useCallback(() => {
    if (!optionsItem) return;
    const groups = optionsItem.optionGroups ?? [];
    const missing = selectionError(groups, selectedOptions);
    if (missing) {
      Alert.alert('Seçim gerekli', missing);
      return;
    }
    const portion = optionsItem.portions?.find(p => p.id === selectedPortion);
    const variant = optionsItem.variants?.find(v => v.id === selectedVariant);
    const extrasArr = optionsItem.extras?.filter(e => selectedExtras.has(e.id)) ?? [];
    const totalPrice = optionsTotal(optionsItem, selectedPortion, selectedVariant, selectedExtras, selectedOptions);

    const parts = [optionsItem.title];
    if (portion) parts.push(`(${portion.label})`);
    if (variant && optionsItem.variants && optionsItem.variants.length > 1) parts.push(`(${variant.label})`);
    if (extrasArr.length > 0) parts.push(`+ ${extrasArr.map(e => e.label).join(', ')}`);
    const summary = selectionSummary(groups, selectedOptions);
    if (summary) parts.push(`· ${summary}`);
    const title = parts.join(' ');

    // Fiyatı sunucu yeniden hesaplar; buradaki tutar yalnızca sepette gösterim içindir.
    doAdd(optionsItem, totalPrice, title, {
      variantId: variant?.id ?? null,
      portionId: portion?.id ?? null,
      extraIds: extrasArr.map(e => e.id),
      optionIds: selectedOptionIds(groups, selectedOptions),
    }, optionsQty);
    setOptionsItem(null);
    optionsSheetRef.current?.close();
  }, [optionsQty, optionsItem, selectedPortion, selectedVariant, selectedExtras, selectedOptions, doAdd]);

  /** Ürün detayının alt çubuğu: seçenekler kayarken adet ve ekle düğmesi yerinde kalır */
  const renderOptionsFooter = useCallback(
    (props: BottomSheetFooterProps) => {
      if (!optionsItem) return null;
      return (
        <BottomSheetFooter {...props}>
          <View style={[st.optionsFooter, { backgroundColor: t.surface, borderTopColor: t.divider, paddingBottom: insets.bottom + 16 }]}>
            <View style={[st.optionsStepper, { backgroundColor: t.background }]}>
              <Pressable style={st.optionsStepBtn} onPress={() => setOptionsQty(q => Math.max(1, q - 1))} accessibilityRole="button" accessibilityLabel="Azalt">
                <Ionicons name="remove" size={18} color={t.text} />
              </Pressable>
              <Text style={[st.optionsQty, { color: t.text }]}>{optionsQty}</Text>
              <Pressable style={st.optionsStepBtn} onPress={() => setOptionsQty(q => q + 1)} accessibilityRole="button" accessibilityLabel="Artır">
                <Ionicons name="add" size={18} color={t.text} />
              </Pressable>
            </View>
            <Pressable style={[st.optionsConfirmBtn, { backgroundColor: t.brand }]} onPress={confirmOptions} accessibilityRole="button">
              <Text style={[st.optionsConfirmText, { color: t.onBrand }]} numberOfLines={1}>
                Sepete ekle · {priceTL(optionsTotal(optionsItem, selectedPortion, selectedVariant, selectedExtras, selectedOptions) * optionsQty)}
              </Text>
            </Pressable>
          </View>
        </BottomSheetFooter>
      );
    },
    [optionsItem, optionsQty, selectedPortion, selectedVariant, selectedExtras, selectedOptions, confirmOptions, insets.bottom, t],
  );

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
    inputRange: [0, stickyEnd - 36, stickyEnd],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  if (loading) {
    return (
      <View style={[st.loadingWrap, { backgroundColor: t.background }]}>
        <Seo path={id ? `/seller/${id}` : undefined} />
        <LogoLoader />
      </View>
    );
  }

  if (!seller) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Seo title="Restoran bulunamadı" noindex />
        <View style={st.errorWrap}>
          <Ionicons name="sad-outline" size={48} color={t.textMuted} />
          <Text style={[st.errorTitle, { color: t.heading }]}>Satıcı bulunamadı</Text>
          <Button label="Geri dön" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const hasCart = fromThisSeller && totalItems > 0;
  const hasRating = seller.rating_count > 0;
  const ratingText = Number(seller.rating_avg).toFixed(1).replace('.', ',');
  const metaItems = [
    isClosed ? 'Şu an kapalı' : 'Açık',
    `${seller.deliveryTime} dk`,
    seller.deliveryFee > 0 ? `Teslimat ${priceTL(seller.deliveryFee)}` : 'Ücretsiz teslimat',
    ...(isDesktop ? [seller.minOrder > 0 ? `Min. ${priceTL(seller.minOrder)}` : 'Minimum yok'] : []),
  ];

  const shownItems = menuItems.filter(i => matchesFoodFilters(i, foodFilters));
  const filterOptions = availableFoodFilters(menuItems);
  const cats = Array.from(new Set(shownItems.map(i => i.category ?? 'Diğer')));
  const hasReviews = displayReviews.length > 0;
  const current = activeSection && (cats.includes(activeSection) || (hasReviews && activeSection === REVIEWS_TAB)) ? activeSection : cats[0];
  const tabItems = [
    ...cats.map(cat => ({ key: cat, label: cat })),
    ...(hasReviews ? [{ key: REVIEWS_TAB, label: 'Yorumlar' }] : []),
  ];
  const tabButtons = tabItems.map(tab => {
    const on = tab.key === current;
    return (
      <Pressable key={tab.key} style={[st.menuTab, on && { borderBottomColor: t.brand }]} onPress={() => scrollToSection(tab.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
        <Text style={[st.menuTabText, { color: on ? t.text : t.textSecondary }, on && st.menuTabTextOn]}>{tab.label}</Text>
      </Pressable>
    );
  });

  const reviewStars = (value: number, size = 12) => (
    <View style={st.reviewStars}>
      {[1, 2, 3, 4, 5].map(n => (
        <Ionicons key={n} name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? t.text : t.textMuted} />
      ))}
    </View>
  );

  const lowerStyle = isDesktop ? st.lowerDesktop : null;

  const seoSeller = { ...seller, cuisineLabels: seller.cuisines.map(cuisineLabel) };

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <Seo
        title={restaurantTitle(seoSeller)}
        description={restaurantDescription(seoSeller)}
        path={`/seller/${seller.id}`}
        image={seller.photo}
        jsonLd={restaurantJsonLd(seoSeller)}
      />
      {/* ═══ Üst şerit: kaydırınca fotoğrafın yerine geçer ═══ */}
      <Animated.View
        style={[st.stickyHeader, { pointerEvents: stickyActive ? 'auto' : 'none', opacity: headerOpacity, backgroundColor: isDesktop ? t.surface : t.brand, paddingTop: insets.top + 8 }]}
      >
        <Pressable style={[st.overlayBtn, { backgroundColor: t.panel }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={20} color={t.onBrand} />
        </Pressable>
        <Text style={[st.stickyTitle, { color: isDesktop ? t.heading : t.onBrand }]} numberOfLines={1}>{seller.display_name}</Text>
        {hasRating ? (
          <View style={st.stickyRating}>
            <Ionicons name="star" size={14} color={isDesktop ? t.text : t.onBrand} />
            <Text style={[st.stickyRatingNum, { color: isDesktop ? t.text : t.onBrand }]}>{ratingText}</Text>
          </View>
        ) : null}
        {!isDesktop ? <CartButton /> : null}
      </Animated.View>

      {/* ═══ Fotoğrafın üstündeki düğmeler ═══ */}
      <View style={[st.floatingRow, isDesktop ? st.floatingRowDesktop : { top: insets.top + 8 }]}>
        <Pressable style={[st.overlayBtn, { backgroundColor: t.panel }]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
          <Ionicons name="arrow-back" size={20} color={t.onBrand} />
        </Pressable>
        <View style={st.floatingRight}>
          <Pressable
            style={[st.overlayBtn, { backgroundColor: t.panel }]}
            onPress={() => seller && shareSeller(seller.display_name, Number(seller.rating_avg), seller.district ?? '')}
            accessibilityRole="button"
            accessibilityLabel="Paylaş"
          >
            <Ionicons name="share-social-outline" size={20} color={t.onBrand} />
          </Pressable>
          <Pressable style={[st.favBtn, { backgroundColor: t.panel }]} onPress={toggleFav} accessibilityRole="button" accessibilityState={{ selected: isFav }} accessibilityLabel={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}>
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={21} color={isFav ? t.accent : t.onBrand} />
            </Animated.View>
          </Pressable>
          {!isDesktop ? <CartButton /> : null}
        </View>
      </View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[st.scroll, hasCart && !isDesktop && { paddingBottom: 96 + insets.bottom }]}
        ref={scrollRef}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          {
            useNativeDriver: true,
            listener: (e: any) => {
              const y = e.nativeEvent.contentOffset.y;
              const offset = isDesktop ? 80 : insets.top + 120;
              setStickyActive(y >= stickyEnd - 10);
              // Sheet'teki sekmeler üst şeridin altına girince yüzen sekmeler görünür.
              setShowCatBar(!isDesktop && menuTopRef.current > 0 && y > menuTopRef.current - insets.top - STICKY_HEIGHT - TABS_HEIGHT);
              let current: string | null = null;
              for (const [cat, top] of Object.entries(sectionTops.current)) {
                // Filtreyle gizlenen bölümün eski konumu sayılmaz.
                if (cats.includes(cat) && menuTopRef.current + listTopRef.current + top <= y + offset) current = cat;
              }
              if (reviewsTopRef.current > 0 && reviewsTopRef.current <= y + offset) current = REVIEWS_TAB;
              if (current) setActiveSection(prev => (prev === current ? prev : current));
            },
          },
        )}
        scrollEventThrottle={16}
      >
        {/* ═══ KAPAK ═══ */}
        <View style={[st.heroCover, { height: heroHeight, backgroundColor: t.mint }, isDesktop && st.heroCoverDesktop]}>
          <FoodImage imageUrl={seller.photo} size={isDesktop ? pageWidth - 32 : pageWidth} height={heroHeight} borderRadius={isDesktop ? 16 : 0} />
        </View>

        {/* ═══ RESTORAN BİLGİSİ ═══ */}
        <View style={[st.sheet, { backgroundColor: t.surface }, isDesktop && st.sheetDesktop]}>
          <View style={isDesktop ? st.headDesktop : null}>
            <View style={isDesktop ? st.headInfoDesktop : null}>
              <View style={st.nameRow}>
                <Text style={[st.sellerName, { color: t.heading }]} accessibilityRole="header">{seller.display_name}</Text>
                {seller.logo ? <FoodImage imageUrl={seller.logo} size={44} borderRadius={12} /> : null}
              </View>

              <View style={st.metaRow}>
                <View style={st.metaRating}>
                  <Ionicons name="star" size={14} color={t.text} />
                  <Text style={[st.metaRatingText, { color: t.text }]}>{hasRating ? ratingText : 'Yeni'}</Text>
                </View>
                {hasRating ? <Text style={[st.metaText, { color: t.textSecondary }]}>({seller.rating_count})</Text> : null}
                {metaItems.map(text => (
                  <Text key={text} style={[st.metaText, { color: t.textSecondary }]}>• {text}</Text>
                ))}
              </View>

              {isDesktop && seller.bio ? (
                <Text style={[st.sellerBio, { color: t.textSecondary }]} numberOfLines={2}>{seller.bio}</Text>
              ) : null}
            </View>

            <View style={[st.actionRow, isDesktop && st.actionRowDesktop]}>
              <Pressable
                style={[st.actionBtn, isDesktop ? st.actionBtnDesktop : st.actionBtnFlex, { backgroundColor: isFollowing ? t.background : t.accent }]}
                onPress={toggleFollow}
                accessibilityRole="button"
                accessibilityState={{ selected: isFollowing }}
              >
                {isFollowing ? <Ionicons name="checkmark" size={16} color={t.text} /> : null}
                <Text style={[st.followBtnText, { color: isFollowing ? t.text : t.onAccent }]} numberOfLines={1}>
                  {isFollowing ? 'Takiptesin' : '+ Takip et'}{followerCount > 0 ? ` · ${followerCount}` : ''}
                </Text>
              </Pressable>
              <Pressable style={[st.actionBtn, isDesktop ? st.actionBtnDesktop : st.actionBtnFlex, { backgroundColor: t.brand }]} onPress={() => messageSheetRef.current?.snapToIndex(0)} accessibilityRole="button">
                <Text style={[st.messageBtnText, { color: t.onBrand }]} numberOfLines={1}>Mesaj gönder</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={st.customOrder}
            accessibilityRole="button"
            onPress={() => {
              setMessageText('Merhaba, özel bir sipariş vermek istiyorum: ');
              messageSheetRef.current?.snapToIndex(0);
            }}
          >
            <Ionicons name="create-outline" size={16} color={t.textSecondary} />
            <Text style={[st.customOrderText, { color: t.textSecondary }]}>Özel sipariş ver</Text>
          </Pressable>

          {campaigns.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.campaignRow} style={st.bleed}>
              {campaigns.map(c => (
                <Pressable key={c.id} style={[st.campaignBox, { backgroundColor: t.background }]} onPress={() => copyCampaignCode(c.code)} accessibilityRole="button" accessibilityLabel={`Kuponu kopyala: ${c.code}`}>
                  <Ionicons name="pricetag-outline" size={18} color={t.text} />
                  <View style={st.campaignBody}>
                    <Text style={[st.campaignBoxTitle, { color: t.text }]} numberOfLines={1}>
                      {c.discount_type === 'percent' ? `%${c.discount_value} indirim` : c.discount_type === 'fixed' ? `${priceTL(c.discount_value)} indirim` : 'Ücretsiz teslimat'}
                    </Text>
                    <Text style={[st.campaignBoxSub, { color: t.textSecondary }]} numberOfLines={1}>
                      {c.min_order_cents > 0 ? `Min. ${priceTL(c.min_order_cents)} · ` : ''}
                      {copiedCode === c.code ? 'Kopyalandı' : <>Kod: <Text style={[st.campaignBoxCode, { color: t.text }]}>{c.code}</Text></>}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {outOfArea ? (
            <View style={[st.closedBanner, { backgroundColor: t.background }]}>
              <Ionicons name="location-outline" size={18} color={t.danger} />
              <Text style={[st.closedBannerText, { color: t.danger }]}>
                Seçili konumun bu satıcının teslimat alanının dışında.{seller.pickupEnabled ? ' Gelip alabilirsin.' : ''}
              </Text>
            </View>
          ) : null}

          {isClosed ? (
            <View style={[st.closedBanner, { backgroundColor: t.background }]}>
              <Ionicons name="time-outline" size={18} color={t.danger} />
              <Text style={[st.closedBannerText, { color: t.danger }]}>
                {seller.acceptsScheduled && !seller.isPaused
                  ? 'Bu mağaza şu an kapalı. Sepette ileri bir saat seçebilirsin.'
                  : 'Bu mağaza şu an kapalı, sipariş alınmıyor.'}
              </Text>
            </View>
          ) : null}

          {!isDesktop && menuItems.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.menuTabs} style={[st.bleed, st.menuTabsWrap]}>
              {tabButtons}
            </ScrollView>
          ) : null}
        </View>

        {/* ═══ MENÜ ═══ */}
        <View
          style={[st.menuSection, isDesktop && st.menuColumns]}
          onLayout={e => { menuTopRef.current = e.nativeEvent.layout.y; }}
        >
          {menuItems.length === 0 ? (
            <View style={st.emptyMenu}>
              <Ionicons name="restaurant-outline" size={40} color={t.textMuted} />
              <Text style={[st.emptyText, { color: t.textSecondary }]}>Bugünlük menü henüz hazır değil.</Text>
            </View>
          ) : (
            <>
              {isDesktop ? (
                <View style={[st.catNav, { backgroundColor: t.surface }]}>
                  <Text style={[st.catNavTitle, { color: t.heading }]}>Menü</Text>
                  {tabItems.map(tab => {
                    const on = tab.key === current;
                    return (
                      <Pressable key={tab.key} style={[st.catNavItem, on && { backgroundColor: t.brand }]} onPress={() => scrollToSection(tab.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                        <Text style={[st.catNavText, { color: on ? t.onBrand : t.textSecondary }, on && st.menuTabTextOn]} numberOfLines={1}>{tab.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={[st.menuList, isDesktop && st.menuListDesktop]} onLayout={e => { listTopRef.current = e.nativeEvent.layout.y; }}>
                {filterOptions.length > 0 ? (
                  <FoodFilterChips
                    active={foodFilters}
                    options={filterOptions}
                    onToggle={key => setFoodFilters(prev => toggleKey(prev, key))}
                    style={[st.foodFilters, !isDesktop && st.foodFiltersBleed]}
                    contentStyle={!isDesktop && st.foodFiltersRow}
                  />
                ) : null}
                {shownItems.length === 0 ? (
                  <View style={st.emptyMenu}>
                    <Ionicons name="search-outline" size={40} color={t.textMuted} />
                    <Text style={[st.emptyText, { color: t.textSecondary }]}>Bu filtrelere uyan yemek yok.</Text>
                    <Button label="Filtreleri temizle" onPress={() => setFoodFilters([])} />
                  </View>
                ) : null}
                {cats.map(cat => (
                  <View key={cat} onLayout={e => { sectionTops.current[cat] = e.nativeEvent.layout.y; }}>
                    <Text style={[st.menuSectionTitle, { color: t.heading }]}>{cat}</Text>
                    <View style={st.menuRows}>
                      {shownItems.filter(i => (i.category ?? 'Diğer') === cat).map(item => {
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
                  </View>
                ))}
              </View>

              {isDesktop ? (
                <View style={[st.basket, { backgroundColor: t.surface }]}>
                  <Text style={[st.basketTitle, { color: t.heading }]}>Sepetin</Text>
                  {hasCart ? (
                    <>
                      {cartItems.map(line => (
                        <View key={line.lineKey} style={st.basketRow}>
                          <View style={st.basketQty}>
                            <Pressable style={st.basketQtyBtn} onPress={() => decrementItem(line.lineKey)} hitSlop={{ left: 4, right: 4 }} accessibilityRole="button" accessibilityLabel={`${line.title} azalt`}>
                              <Ionicons name="remove-circle-outline" size={20} color={t.textSecondary} />
                            </Pressable>
                            <Text style={[st.basketQtyText, { color: t.text }]}>{line.quantity}</Text>
                            <Pressable style={st.basketQtyBtn} onPress={() => incrementItem(line.lineKey)} hitSlop={{ left: 4, right: 4 }} accessibilityRole="button" accessibilityLabel={`${line.title} artır`}>
                              <Ionicons name="add-circle-outline" size={20} color={t.textSecondary} />
                            </Pressable>
                          </View>
                          <Text style={[st.basketName, { color: t.text }]} numberOfLines={2}>{line.title}</Text>
                          <Text style={[st.basketPrice, { color: t.text }]}>{priceTL(line.priceCents * line.quantity)}</Text>
                        </View>
                      ))}
                      <View style={[st.basketTotal, { borderTopColor: t.divider }]}>
                        <Text style={[st.basketTotalText, { color: t.text }]}>Ara toplam</Text>
                        <Text style={[st.basketTotalText, { color: t.text }]}>{priceTL(totalCents)}</Text>
                      </View>
                      <View style={st.basketBtn}>
                        <Button label="Sepete git" fullWidth onPress={() => router.push('/(customer)/cart')} />
                      </View>
                    </>
                  ) : (
                    <View style={st.basketEmpty}>
                      <Ionicons name="bag-outline" size={32} color={t.textMuted} />
                      <Text style={[st.basketEmptyText, { color: t.textSecondary }]}>Sepetin boş. Menüden seçim yap.</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </>
          )}
        </View>

        {/* ═══ ÇALIŞMA SAATLERİ ═══ */}
        {workingHours.length > 0 && (
          <View style={[st.lowerCard, lowerStyle, { backgroundColor: t.surface }]}>
            <Pressable
              style={st.hoursTitleRow}
              onPress={() => setShowHours(!showHours)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showHours }}
            >
              <Text style={[st.sectionTitle, { color: t.heading }]}>Çalışma saatleri</Text>
              <Ionicons name={showHours ? 'chevron-up' : 'chevron-down'} size={18} color={t.textSecondary} />
            </Pressable>
            {showHours && (
              <View style={st.hoursList}>
                {workingHours.map((wh: WorkingHours, idx: number) => {
                  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
                  const isToday = idx === todayIdx;
                  return (
                    <View key={wh.day} style={[st.hoursRow, isToday && { backgroundColor: t.background }]}>
                      <Text style={[st.hoursDay, { color: isToday ? t.text : t.textSecondary }, isToday && st.hoursToday]}>{wh.day}</Text>
                      <Text style={[st.hoursTime, { color: wh.open ? t.text : t.danger }, isToday && st.hoursToday]}>
                        {wh.hours}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ═══ YORUMLAR (GELİŞTİRİLMİŞ) ═══ */}
        {hasReviews && (
          <View style={[st.reviewsSection, lowerStyle]} onLayout={e => { reviewsTopRef.current = e.nativeEvent.layout.y; }}>
            <View style={st.reviewsHeader}>
              <Text style={[st.sectionTitle, { color: t.heading }]}>Değerlendirmeler</Text>
              <Text style={[st.reviewsCount, { color: t.textSecondary }]}>{displayReviews.length} yorum</Text>
            </View>

            {/* Rating Summary */}
            {seller && (
              <View style={[st.ratingSummary, { backgroundColor: t.surface }]}>
                <View style={st.ratingSummaryLeft}>
                  <Text style={[st.ratingSummaryNum, { color: t.heading }]}>{ratingText}</Text>
                  {reviewStars(Math.round(seller.rating_avg ?? 0))}
                  <Text style={[st.ratingSummaryCount, { color: t.textSecondary }]}>{seller.rating_count} değerlendirme</Text>
                </View>
                <View style={st.ratingSummaryBars}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const reviews = displayReviews;
                    const count = reviews.filter(r => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <View key={star} style={st.ratingBarRow}>
                        <Text style={[st.ratingBarLabel, { color: t.textSecondary }]}>{star}</Text>
                        <View style={[st.ratingBarTrack, { backgroundColor: t.background }]}>
                          <View style={[st.ratingBarFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: t.brand }]} />
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
                <View style={[st.reviewCard, { backgroundColor: t.surface }]}>
                  <View style={[st.topReviewBadge, { backgroundColor: t.brand }]}>
                    <Text style={[st.topReviewBadgeText, { color: t.onBrand }]}>En beğenilen yorum</Text>
                  </View>
                  <View style={st.reviewTop}>
                    <View style={[st.reviewAvatar, { backgroundColor: t.background }]}>
                      <Text style={[st.reviewAvatarText, { color: t.textSecondary }]}>{topReview.name.charAt(0)}</Text>
                    </View>
                    <View style={st.reviewWho}>
                      <Text style={[st.reviewName, { color: t.text }]}>{topReview.name}</Text>
                      {reviewStars(topReview.rating)}
                    </View>
                    <View style={st.helpfulCountHighlight}>
                      <Ionicons name="thumbs-up-outline" size={14} color={t.text} />
                      <Text style={[st.helpfulCountText, { color: t.text }]}>{topReview.helpfulCount}</Text>
                    </View>
                  </View>
                  <Text style={[st.reviewComment, { color: t.textSecondary }]}>{topReview.comment}</Text>
                  {topReview.menuItem && (
                    <View style={[st.reviewMenuTag, { backgroundColor: t.background }]}>
                      <Ionicons name="restaurant-outline" size={12} color={t.textSecondary} />
                      <Text style={[st.reviewMenuTagText, { color: t.textSecondary }]}>{topReview.menuItem}</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Tüm yorumlar */}
            {displayReviews.map(rev => {
              const helpfulOn = helpfulReviews.has(rev.id);
              return (
                <View key={rev.id} style={[st.reviewCard, { backgroundColor: t.surface }]}>
                  <View style={st.reviewTop}>
                    <View style={[st.reviewAvatar, { backgroundColor: t.background }]}>
                      <Text style={[st.reviewAvatarText, { color: t.textSecondary }]}>{rev.name.charAt(0)}</Text>
                    </View>
                    <View style={st.reviewWho}>
                      <Text style={[st.reviewName, { color: t.text }]}>{rev.name}</Text>
                      <Text style={[st.reviewDate, { color: t.textSecondary }]}>{rev.date}</Text>
                    </View>
                    {reviewStars(rev.rating)}
                  </View>

                  {/* Sipariş edilen ürün */}
                  {rev.menuItem && (
                    <View style={[st.reviewMenuTag, { backgroundColor: t.background }]}>
                      <Ionicons name="restaurant-outline" size={12} color={t.textSecondary} />
                      <Text style={[st.reviewMenuTagText, { color: t.textSecondary }]}>{rev.menuItem}</Text>
                    </View>
                  )}

                  <Text style={[st.reviewComment, { color: t.textSecondary }]}>{rev.comment}</Text>

                  {/* Satıcı Cevabı */}
                  {rev.sellerReply && (
                    <View style={[st.sellerReplyCard, { backgroundColor: t.background }]}>
                      <View style={st.sellerReplyHeader}>
                        <Ionicons name="chatbubble-outline" size={13} color={t.text} />
                        <Text style={[st.sellerReplyLabel, { color: t.text }]}>Satıcı yanıtı</Text>
                      </View>
                      <Text style={[st.sellerReplyText, { color: t.textSecondary }]}>{rev.sellerReply}</Text>
                    </View>
                  )}

                  {/* Faydalı butonu */}
                  <View style={st.reviewActions}>
                    <Pressable
                      style={[st.helpfulBtn, { backgroundColor: helpfulOn ? t.accent : t.background }]}
                      onPress={() => toggleHelpful(rev.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: helpfulOn }}
                    >
                      <Ionicons name={helpfulOn ? 'thumbs-up' : 'thumbs-up-outline'} size={14} color={helpfulOn ? t.onAccent : t.textSecondary} />
                      <Text style={[st.helpfulBtnText, { color: helpfulOn ? t.onAccent : t.textSecondary }]}>
                        Faydalı ({rev.helpfulCount})
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ═══ TESLİMAT DETAYLARI ═══ */}
        <View style={[st.lowerSection, lowerStyle]}>
          <Text style={[st.sectionTitle, st.sectionTitleGap, { color: t.heading }]}>Teslimat bilgileri</Text>

          <View style={[st.infoCard, { backgroundColor: t.surface }]}>
            <View style={st.deliveryRow}>
              <Ionicons name="bicycle-outline" size={20} color={t.textSecondary} />
              <View style={st.deliveryBody}>
                <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Teslimat süresi</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.deliveryTime} dk</Text>
              </View>
            </View>

            <View style={[st.infoDivider, { backgroundColor: t.divider }]} />

            <View style={st.deliveryRow}>
              <Ionicons name="wallet-outline" size={20} color={t.textSecondary} />
              <View style={st.deliveryBody}>
                <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Min. sipariş</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.minOrder > 0 ? priceTL(seller.minOrder) : 'Yok'}</Text>
              </View>
            </View>

            <View style={[st.infoDivider, { backgroundColor: t.divider }]} />

            <View style={st.deliveryRow}>
              <Ionicons name="location-outline" size={20} color={t.textSecondary} />
              <View style={st.deliveryBody}>
                <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Teslimat bölgesi</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.district ?? seller.city ?? 'Belirtilmemiş'}{radiusKm != null && seller.latitude != null ? ` · ${radiusKm} km` : ''}</Text>
              </View>
            </View>

            {seller.pickupEnabled ? (
              <>
                <View style={[st.infoDivider, { backgroundColor: t.divider }]} />
                <View style={st.deliveryRow}>
                  <Ionicons name="bag-handle-outline" size={20} color={t.textSecondary} />
                  <View style={st.deliveryBody}>
                    <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Gelip alma</Text>
                    <Text style={[st.deliveryValue, { color: t.text }]}>Siparişini restorandan alabilirsin</Text>
                  </View>
                </View>
              </>
            ) : null}

            {seller.acceptsScheduled ? (
              <>
                <View style={[st.infoDivider, { backgroundColor: t.divider }]} />
                <View style={st.deliveryRow}>
                  <Ionicons name="calendar-outline" size={20} color={t.textSecondary} />
                  <View style={st.deliveryBody}>
                    <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Planlı sipariş</Text>
                    <Text style={[st.deliveryValue, { color: t.text }]}>7 güne kadar ileri bir saate sipariş verebilirsin</Text>
                  </View>
                </View>
              </>
            ) : null}

            {seller.mealCards.length > 0 ? (
              <>
                <View style={[st.infoDivider, { backgroundColor: t.divider }]} />
                <View style={st.deliveryRow}>
                  <Ionicons name="card-outline" size={20} color={t.textSecondary} />
                  <View style={st.deliveryBody}>
                    <Text style={[st.deliveryLabel, { color: t.textSecondary }]}>Kapıda yemek kartı</Text>
                    <Text style={[st.deliveryValue, { color: t.text }]}>{seller.mealCards.join(', ')}</Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>
        </View>

        {/* ═══ SATICI BİLGİSİ ═══ */}
        {seller.bio && (
          <View style={[st.lowerSection, lowerStyle]}>
            <Text style={[st.sectionTitle, st.sectionTitleGap, { color: t.heading }]}>Beni tanı</Text>
            <View style={[st.storyCard, { backgroundColor: t.surface }]}>
              <Text style={[st.storyText, { color: t.textSecondary }]}>{seller.bio}</Text>
            </View>
          </View>
        )}

        {/* ═══ SATICI BİLGİLERİ ═══ */}
        <View style={[st.lowerSection, lowerStyle]}>
          <Text style={[st.sectionTitle, st.sectionTitleGap, { color: t.heading }]}>Satıcı hakkında</Text>
          <View style={[st.aboutCard, { backgroundColor: t.surface }]}>
            <View style={st.aboutRow}>
              <Text style={[st.aboutLabel, { color: t.textSecondary }]}>Satıcı</Text>
              <Text style={[st.aboutValue, { color: t.text }]}>{seller.isRestaurant ? 'Onaylı restoran' : 'Onaylı mutfak'}</Text>
            </View>
            <View style={[st.aboutDivider, { backgroundColor: t.divider }]} />
            <View style={st.aboutRow}>
              <Text style={[st.aboutLabel, { color: t.textSecondary }]}>Konum</Text>
              <Text style={[st.aboutValue, { color: t.text }]}>
                {[seller.address_line, seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <View style={[st.aboutDivider, { backgroundColor: t.divider }]} />
            <View style={st.aboutRow}>
              <Text style={[st.aboutLabel, { color: t.textSecondary }]}>Teslimat</Text>
              <Text style={[st.aboutValue, { color: t.text }]}>{seller.deliveryTime} dakika</Text>
            </View>
            <View style={[st.aboutDivider, { backgroundColor: t.divider }]} />
            <View style={st.aboutRow}>
              <Text style={[st.aboutLabel, { color: t.textSecondary }]}>Min. sipariş</Text>
              <Text style={[st.aboutValue, { color: t.text }]}>{seller.minOrder > 0 ? priceTL(seller.minOrder) : 'Yok'}</Text>
            </View>
            <View style={[st.aboutDivider, { backgroundColor: t.divider }]} />
            <View style={st.aboutRow}>
              <Text style={[st.aboutLabel, { color: t.textSecondary }]}>Puan</Text>
              <Text style={[st.aboutValue, { color: t.text }]}>
                {ratingText} ({seller.rating_count} yorum)
              </Text>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      {showCatBar && menuItems.length > 0 ? (
        <View style={[st.floatingCats, { top: insets.top + STICKY_HEIGHT, backgroundColor: t.surface, borderBottomColor: t.divider }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.menuTabs}>
            {tabButtons}
          </ScrollView>
        </View>
      ) : null}

      {/* ═══ CART BAR ═══ */}
      {hasCart && !isDesktop && (
        <SafeAreaView edges={['bottom']} style={st.cartBar} pointerEvents="box-none">
          <Pressable style={[st.cartPill, { backgroundColor: t.brand }]} onPress={() => router.push('/(customer)/cart')} accessibilityRole="button" accessibilityLabel={`Sepeti görüntüle, ${totalItems} ürün, ${priceTL(totalCents)}`}>
            <Text style={[st.cartPillText, { color: t.onBrand }]} numberOfLines={1}>Sepeti görüntüle · {totalItems} ürün</Text>
            <Text style={[st.cartPillText, { color: t.accent }]}>{priceTL(totalCents)}</Text>
          </Pressable>
        </SafeAreaView>
      )}
      {/* VARIANT / EXTRAS BOTTOM SHEET */}
      <BottomSheet
        ref={optionsSheetRef}
        style={sheetStyle}
        index={-1}
        snapPoints={optionsSnapPoints}
        enablePanDownToClose
        onClose={() => setOptionsItem(null)}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        footerComponent={renderOptionsFooter}
        handleStyle={[st.plateHandle, { backgroundColor: t.background }]}
        handleIndicatorStyle={[st.handleIndicator, { backgroundColor: t.textMuted }]}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}>
          {optionsItem && (
            <>
              <View style={[st.plateWrap, { backgroundColor: t.background }]}>
                <FoodImage imageUrl={optionsItem.image_url} size={176} borderRadius={88} />
                <Pressable style={[st.plateClose, { backgroundColor: t.surface }]} onPress={() => optionsSheetRef.current?.close()} accessibilityRole="button" accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={t.text} />
                </Pressable>
              </View>

              <View style={st.optionsInner}>
                <Text style={[st.optionsTitle, { color: t.heading }]}>{optionsItem.title}</Text>
                <Text style={[st.optionsSub, { color: t.textSecondary }]} numberOfLines={1}>{seller.display_name} · {seller.deliveryTime} dk</Text>

                {optionsItem.remaining_today != null || (optionsItem.badge && BADGE_CONFIG[optionsItem.badge]) ? (
                  <View style={st.optionsChips}>
                    {optionsItem.remaining_today != null ? (
                      <View style={[st.optionsChip, { backgroundColor: t.background }]}>
                        <Text style={[st.optionsChipText, { color: t.text }]}>Bugün için {optionsItem.remaining_today} porsiyon kaldı</Text>
                      </View>
                    ) : null}
                    {optionsItem.badge && BADGE_CONFIG[optionsItem.badge] ? (
                      <View style={[st.optionsChip, { backgroundColor: t.background }]}>
                        <Ionicons name={BADGE_CONFIG[optionsItem.badge].icon} size={14} color={t.text} />
                        <Text style={[st.optionsChipText, { color: t.text }]}>{BADGE_CONFIG[optionsItem.badge].label}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {foodDetailLabels(optionsItem).length > 0 ? (
                  <View style={st.optionsChips}>
                    {foodDetailLabels(optionsItem).map(label => (
                      <View key={label} style={[st.optionsChip, { backgroundColor: t.background }]}>
                        <Text style={[st.optionsChipText, { color: t.text }]}>{label}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={[st.optionsPriceBig, { color: t.text }]}>{priceTL(optionsTotal(optionsItem, selectedPortion, selectedVariant, selectedExtras, selectedOptions))}</Text>
                {optionsItem.description ? (
                  <Text style={[st.optionsDesc, { color: t.textSecondary }]}>{optionsItem.description}</Text>
                ) : null}
                <View style={[st.allergenBox, { backgroundColor: t.background }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={t.text} />
                  <Text style={[st.allergenText, { color: t.text }]}>{allergenSummary(optionsItem.allergens)}</Text>
                </View>

                {/* Portions */}
                {optionsItem.portions && optionsItem.portions.length > 0 && (
                  <View style={[st.optionsSection, { borderTopColor: t.divider }]}>
                    <View style={st.optionsSectionHead}>
                      <Text style={[st.optionsSectionTitle, { color: t.heading }]}>Porsiyon</Text>
                      <View style={[st.optionsTag, { backgroundColor: t.brand }]}>
                        <Text style={[st.optionsTagText, { color: t.onBrand }]}>Zorunlu</Text>
                      </View>
                    </View>
                    {optionsItem.portions.map(p => {
                      const active = selectedPortion === p.id;
                      return (
                        <Pressable
                          key={p.id}
                          style={st.optionRow}
                          onPress={() => setSelectedPortion(p.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <View style={[st.optionRadio, active ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                            {active && <View style={[st.optionRadioDot, { backgroundColor: t.onAccent }]} />}
                          </View>
                          <Text style={[st.optionLabel, { color: t.text }, active && st.optionLabelActive]}>{p.label}</Text>
                          <Text style={[st.optionPrice, { color: t.text }]}>{priceTL(p.priceCents)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* Variants */}
                {optionsItem.variants && optionsItem.variants.length > 0 && (
                  <View style={[st.optionsSection, { borderTopColor: t.divider }]}>
                    <View style={st.optionsSectionHead}>
                      <Text style={[st.optionsSectionTitle, { color: t.heading }]}>Seçenek</Text>
                      <View style={[st.optionsTag, { backgroundColor: t.brand }]}>
                        <Text style={[st.optionsTagText, { color: t.onBrand }]}>Zorunlu</Text>
                      </View>
                    </View>
                    {optionsItem.variants.map(v => {
                      const active = selectedVariant === v.id;
                      return (
                        <Pressable
                          key={v.id}
                          style={st.optionRow}
                          onPress={() => setSelectedVariant(v.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <View style={[st.optionRadio, active ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                            {active && <View style={[st.optionRadioDot, { backgroundColor: t.onAccent }]} />}
                          </View>
                          <Text style={[st.optionLabel, { color: t.text }, active && st.optionLabelActive]}>{v.label}</Text>
                          <Text style={[st.optionPrice, { color: t.text }]}>
                            {v.priceDiffCents === 0
                              ? ''
                              : v.priceDiffCents > 0
                                ? `+ ${priceTL(v.priceDiffCents)}`
                                : `- ${priceTL(Math.abs(v.priceDiffCents))}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* Seçim grupları */}
                {(optionsItem.optionGroups ?? []).map(group => {
                  const single = group.maxSelect === 1;
                  return (
                    <View key={group.id} style={[st.optionsSection, { borderTopColor: t.divider }]}>
                      <View style={st.optionsSectionHead}>
                        <Text style={[st.optionsSectionTitle, st.optionsGroupTitle, { color: t.heading }]}>{group.title}</Text>
                        <View style={[st.optionsTag, { backgroundColor: group.minSelect > 0 ? t.brand : t.background }]}>
                          <Text style={[st.optionsTagText, { color: group.minSelect > 0 ? t.onBrand : t.text }]}>{groupRuleLabel(group)}</Text>
                        </View>
                      </View>
                      {group.options.length === 0 ? (
                        <Text style={[st.optionsDesc, { color: t.danger }]}>Seçenekler şu an tükendi.</Text>
                      ) : null}
                      {group.options.map(option => {
                        const active = selectedOptions.has(option.id);
                        return (
                          <Pressable
                            key={option.id}
                            style={st.optionRow}
                            onPress={() => setSelectedOptions(prev => toggleOption(prev, group, option.id))}
                            accessibilityRole={single ? 'radio' : 'checkbox'}
                            accessibilityState={single ? { selected: active } : { checked: active }}
                          >
                            {single ? (
                              <View style={[st.optionRadio, active ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                                {active && <View style={[st.optionRadioDot, { backgroundColor: t.onAccent }]} />}
                              </View>
                            ) : (
                              <View style={[st.optionCheck, active ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                                {active && <Ionicons name="checkmark" size={15} color={t.onAccent} />}
                              </View>
                            )}
                            <Text style={[st.optionLabel, { color: t.text }, active && st.optionLabelActive]}>{option.label}</Text>
                            {option.priceCents > 0 ? (
                              <Text style={[st.optionPrice, { color: t.text }]}>+ {priceTL(option.priceCents)}</Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}

                {/* Extras */}
                {optionsItem.extras && optionsItem.extras.length > 0 && (
                  <View style={[st.optionsSection, { borderTopColor: t.divider }]}>
                    <View style={st.optionsSectionHead}>
                      <Text style={[st.optionsSectionTitle, { color: t.heading }]}>Yanına ekle</Text>
                      <View style={[st.optionsTag, { backgroundColor: t.background }]}>
                        <Text style={[st.optionsTagText, { color: t.text }]}>İsteğe bağlı</Text>
                      </View>
                    </View>
                    {optionsItem.extras.map(e => {
                      const checked = selectedExtras.has(e.id);
                      return (
                        <Pressable
                          key={e.id}
                          style={st.optionRow}
                          onPress={() => setSelectedExtras(prev => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id);
                            else next.add(e.id);
                            return next;
                          })}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                        >
                          <View style={[st.optionCheck, checked ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                            {checked && <Ionicons name="checkmark" size={15} color={t.onAccent} />}
                          </View>
                          <Text style={[st.optionLabel, { color: t.text }, checked && st.optionLabelActive]}>{e.label}</Text>
                          <Text style={[st.optionPrice, { color: t.text }]}>+ {priceTL(e.priceCents)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>

      {/* ═══ MESAJ BOTTOM SHEET ═══ */}
      <BottomSheet
        ref={messageSheetRef}
        style={sheetStyle}
        index={-1}
        snapPoints={messageSnapPoints}
        enablePanDownToClose
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        handleIndicatorStyle={[st.handleIndicator, { backgroundColor: t.textMuted }]}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.msgInner}>
          <View style={st.msgHeader}>
            <Text style={[st.msgTitle, { color: t.heading }]}>Mesaj gönder</Text>
            <Pressable style={st.msgClose} onPress={() => messageSheetRef.current?.close()} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={22} color={t.text} />
            </Pressable>
          </View>
          <Text style={[st.msgSubtitle, { color: t.textSecondary }]}>
            Satıcıya soru sor veya özel sipariş iste
          </Text>
          <TextInput
            style={[st.msgInput, { backgroundColor: t.background, color: t.text }]}
            placeholder="Mesajını yaz..."
            placeholderTextColor={t.textMuted}
            value={messageText}
            onChangeText={setMessageText}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            accessibilityLabel="Mesajın"
          />
          <View style={st.msgQuickBtns}>
            <Pressable style={[st.msgQuickBtn, { backgroundColor: t.background }]} hitSlop={2} onPress={() => setMessageText('Bu yemeği ne zaman hazırlayabilirsiniz?')} accessibilityRole="button">
              <Text style={[st.msgQuickBtnText, { color: t.text }]}>Ne zaman hazır?</Text>
            </Pressable>
            <Pressable style={[st.msgQuickBtn, { backgroundColor: t.background }]} hitSlop={2} onPress={() => setMessageText('Alerjen içermeyen seçenekleriniz var mı?')} accessibilityRole="button">
              <Text style={[st.msgQuickBtnText, { color: t.text }]}>Alerjen bilgisi</Text>
            </Pressable>
            <Pressable style={[st.msgQuickBtn, { backgroundColor: t.background }]} hitSlop={2} onPress={() => setMessageText('Özel bir sipariş vermek istiyorum: ')} accessibilityRole="button">
              <Text style={[st.msgQuickBtnText, { color: t.text }]}>Özel sipariş</Text>
            </Pressable>
          </View>
          <Button
            label={sendingMessage ? 'Gönderiliyor...' : 'Gönder'}
            size="lg"
            fullWidth
            onPress={submitMessage}
            disabled={!messageText.trim() || sendingMessage}
          />
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Masaüstünde alttaki bölümler menü sütunuyla hizalanır: 16 + kategori 184 + 24, 24 + sepet 300 + 16 */
const CAT_NAV_WIDTH = 184;
const BASKET_WIDTH = 300;

const st = StyleSheet.create({
  safe: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorTitle: { fontSize: 18, fontFamily: fonts.display },
  scroll: { paddingBottom: 32 },

  // ── Üst şerit
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stickyTitle: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },
  stickyRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stickyRatingNum: { fontSize: 14, fontFamily: fonts.bold },

  // ── Fotoğrafın üstündeki düğmeler
  floatingRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 5,
    pointerEvents: 'box-none',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  floatingRowDesktop: { top: 28, left: 28, right: 28 },
  floatingRight: { flexDirection: 'row', alignItems: 'center', gap: 8, pointerEvents: 'box-none' },
  overlayBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  favBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  // ── Kapak
  heroCover: { overflow: 'hidden' },
  heroCoverDesktop: { marginHorizontal: 16, marginTop: 16, borderRadius: 16 },

  // ── Bilgi kartı
  sheet: { marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingHorizontal: 16 },
  sheetDesktop: { marginTop: 12, marginHorizontal: 16, borderRadius: 16, paddingBottom: 8 },
  headDesktop: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  headInfoDesktop: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerName: { flex: 1, minWidth: 0, fontSize: 24, lineHeight: 28, fontFamily: fonts.display, letterSpacing: -0.6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, marginTop: 4 },
  metaRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaRatingText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  metaText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  sellerBio: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 8 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionRowDesktop: { marginTop: 0 },
  actionBtnFlex: { flex: 1 },
  allergenBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, marginTop: 10 },
  allergenText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  actionBtn: { height: 44, borderRadius: 12, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actionBtnDesktop: { width: 168 },
  followBtnText: { fontSize: 13, fontFamily: fonts.extrabold },
  messageBtnText: { fontSize: 13, fontFamily: fonts.bold },
  customOrder: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  customOrderText: { fontSize: 13, fontFamily: fonts.semibold },

  // ── Kampanya ve uyarılar
  bleed: { marginHorizontal: -16, flexGrow: 0 },
  campaignRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 8 },
  campaignBox: { width: 216, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  campaignBody: { flex: 1, minWidth: 0 },
  campaignBoxTitle: { fontSize: 14, fontFamily: fonts.bold },
  campaignBoxSub: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  campaignBoxCode: { fontFamily: fonts.bold },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8, padding: 12, borderRadius: 12 },
  closedBannerText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },

  // ── Sekmeler
  menuTabsWrap: { marginTop: 2 },
  menuTabs: { paddingHorizontal: 16, gap: 20 },
  menuTab: { minHeight: 44, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  menuTabText: { fontSize: 14, fontFamily: fonts.medium },
  menuTabTextOn: { fontFamily: fonts.extrabold },
  floatingCats: { position: 'absolute', left: 0, right: 0, zIndex: 9, borderBottomWidth: 1 },

  // ── Menü
  menuSection: { paddingBottom: 8 },
  menuColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24, paddingHorizontal: 16, paddingTop: 12 },
  menuList: { paddingHorizontal: 16 },
  foodFilters: { flexGrow: 0, marginBottom: 12 },
  foodFiltersBleed: { marginHorizontal: -16 },
  foodFiltersRow: { paddingHorizontal: 16 },
  menuListDesktop: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  menuSectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, paddingTop: 14, paddingBottom: 10 },
  menuRows: { gap: 10 },
  menuCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16 },
  menuBody: { flex: 1, minWidth: 0 },
  menuTitle: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  menuDesc: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },
  menuPrice: { fontSize: 15, lineHeight: 20, fontFamily: fonts.extrabold, marginTop: 4 },
  menuTags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  menuBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 6 },
  menuBadgeText: { fontSize: 11, fontFamily: fonts.semibold },
  menuOut: { fontSize: 12, fontFamily: fonts.bold },
  menuFew: { fontSize: 12, fontFamily: fonts.semibold },
  menuPhoto: { width: 88, height: 88 },
  menuPhotoOff: { opacity: 0.5 },
  addBtn: { position: 'absolute', right: -2, bottom: -2, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  qtyControl: { position: 'absolute', right: -2, bottom: -2, height: 36, borderRadius: 18, flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { minWidth: 18, textAlign: 'center', fontSize: 14, fontFamily: fonts.bold },
  emptyMenu: { flex: 1, alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular },

  // ── Masaüstü kategori ve sepet
  catNav: { width: CAT_NAV_WIDTH, borderRadius: 16, padding: 8, position: 'sticky' as any, top: 72, gap: 2 },
  catNavTitle: { fontSize: 18, fontFamily: fonts.display, paddingVertical: 8, paddingHorizontal: 8 },
  catNavItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 10 },
  catNavText: { fontSize: 14, fontFamily: fonts.medium },
  basket: { width: BASKET_WIDTH, borderRadius: 16, padding: 14, position: 'sticky' as any, top: 72 },
  basketTitle: { fontSize: 18, fontFamily: fonts.display, marginBottom: 6 },
  basketRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  basketQty: { flexDirection: 'row', alignItems: 'center' },
  basketQtyBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  basketQtyText: { minWidth: 14, textAlign: 'center', fontSize: 13, fontFamily: fonts.bold },
  basketName: { flex: 1, minWidth: 0, fontSize: 13, fontFamily: fonts.regular },
  basketPrice: { fontSize: 13, fontFamily: fonts.semibold },
  basketTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10, marginTop: 6 },
  basketTotalText: { fontSize: 14, fontFamily: fonts.bold },
  basketBtn: { marginTop: 12 },
  basketEmpty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  basketEmptyText: { fontSize: 13, fontFamily: fonts.regular, textAlign: 'center' },

  // ── Alttaki bölümler
  lowerDesktop: { marginLeft: 16 + CAT_NAV_WIDTH + 24, marginRight: 16 + BASKET_WIDTH + 24 },
  lowerSection: { marginHorizontal: 16, marginTop: 20 },
  lowerCard: { marginHorizontal: 16, marginTop: 20, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 16 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },
  sectionTitleGap: { marginBottom: 10 },

  // ── Çalışma saatleri
  hoursTitleRow: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hoursList: { gap: 2, paddingBottom: 10 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  hoursDay: { fontSize: 13, fontFamily: fonts.semibold, width: 90 },
  hoursTime: { fontSize: 13, fontFamily: fonts.semibold },
  hoursToday: { fontFamily: fonts.extrabold },

  // ── Değerlendirmeler
  reviewsSection: { marginHorizontal: 16, marginTop: 20, gap: 10 },
  reviewsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewsCount: { fontSize: 13, fontFamily: fonts.medium },
  ratingSummary: { flexDirection: 'row', borderRadius: 16, padding: 14, gap: 20 },
  ratingSummaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  ratingSummaryNum: { fontSize: 36, lineHeight: 42, fontFamily: fonts.display },
  ratingSummaryCount: { fontSize: 11, fontFamily: fonts.medium, marginTop: 2 },
  ratingSummaryBars: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 5 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingBarLabel: { fontSize: 12, fontFamily: fonts.bold, width: 12, textAlign: 'center' },
  ratingBarTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  ratingBarFill: { height: '100%', borderRadius: 3 },
  reviewCard: { borderRadius: 16, padding: 14, gap: 10 },
  topReviewBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, height: 24, justifyContent: 'center' },
  topReviewBadgeText: { fontSize: 11, fontFamily: fonts.bold },
  helpfulCountHighlight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  helpfulCountText: { fontSize: 13, fontFamily: fonts.bold },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { flex: 1, minWidth: 0 },
  reviewAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { fontSize: 14, fontFamily: fonts.bold },
  reviewName: { fontSize: 13, fontFamily: fonts.bold },
  reviewDate: { fontFamily: fonts.regular, fontSize: 11 },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewComment: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  reviewMenuTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  reviewMenuTagText: { fontSize: 11, fontFamily: fonts.semibold },
  sellerReplyCard: { borderRadius: 12, padding: 10 },
  sellerReplyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  sellerReplyLabel: { fontSize: 11, fontFamily: fonts.bold },
  sellerReplyText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  reviewActions: { flexDirection: 'row' },
  helpfulBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12 },
  helpfulBtnText: { fontSize: 12, fontFamily: fonts.semibold },

  // ── Teslimat, hikâye, satıcı
  infoCard: { borderRadius: 16, paddingVertical: 4 },
  infoDivider: { height: 1, marginHorizontal: 14 },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  deliveryBody: { flex: 1, minWidth: 0 },
  deliveryLabel: { fontSize: 11, fontFamily: fonts.medium, marginBottom: 2 },
  deliveryValue: { fontSize: 13, fontFamily: fonts.semibold },
  storyCard: { borderRadius: 16, padding: 14 },
  storyText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  aboutCard: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8 },
  aboutLabel: { fontFamily: fonts.regular, fontSize: 13 },
  aboutValue: { flexShrink: 1, fontSize: 13, fontFamily: fonts.semibold, textAlign: 'right', maxWidth: '55%' },
  aboutDivider: { height: 1 },

  // ── Yüzen sepet
  cartBar: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  cartPill: { height: 54, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18 },
  cartPillText: { flexShrink: 1, fontSize: 15, fontFamily: fonts.bold },

  // ── Ürün detayı
  optionsCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  plateHandle: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handleIndicator: { width: 40 },
  plateWrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 16 },
  plateClose: { position: 'absolute', top: 0, right: 16, width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionsInner: { paddingTop: 16, paddingHorizontal: 16 },
  optionsTitle: { fontSize: 26, lineHeight: 31, fontFamily: fonts.display, letterSpacing: -0.5 },
  optionsSub: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 2 },
  optionsChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  optionsChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 10 },
  optionsChipText: { fontSize: 13, fontFamily: fonts.semibold },
  optionsGroupTitle: { flexShrink: 1 },
  optionsPriceBig: { fontSize: 18, lineHeight: 24, fontFamily: fonts.extrabold, marginTop: 10 },
  optionsDesc: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, marginTop: 4 },
  optionsSection: { borderTopWidth: 1, marginTop: 14, paddingTop: 10 },
  optionsSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  optionsSectionTitle: { fontSize: 15, lineHeight: 20, fontFamily: fonts.display, letterSpacing: -0.3 },
  optionsTag: { height: 24, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  optionsTagText: { fontSize: 12, fontFamily: fonts.semibold },
  optionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  optionRadioDot: { width: 8, height: 8, borderRadius: 4 },
  optionCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.regular },
  optionLabelActive: { fontFamily: fonts.bold },
  optionPrice: { fontSize: 14, fontFamily: fonts.bold },
  optionsFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 16, borderTopWidth: 1 },
  optionsStepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  optionsStepBtn: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  optionsQty: { width: 18, textAlign: 'center', fontSize: 15, fontFamily: fonts.bold },
  optionsConfirmBtn: { flex: 1, minWidth: 0, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  optionsConfirmText: { fontSize: 15, fontFamily: fonts.bold },

  // ── Mesaj
  msgInner: { paddingHorizontal: 16, paddingBottom: 24 },
  msgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  msgTitle: { flex: 1, minWidth: 0, fontSize: 22, lineHeight: 27, fontFamily: fonts.display, letterSpacing: -0.4 },
  msgClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  msgSubtitle: { fontFamily: fonts.regular, fontSize: 13, marginBottom: 12 },
  msgInput: { borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 14, minHeight: 80, marginBottom: 10 },
  msgQuickBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  msgQuickBtn: { height: 40, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  msgQuickBtnText: { fontSize: 13, fontFamily: fonts.semibold },
});
