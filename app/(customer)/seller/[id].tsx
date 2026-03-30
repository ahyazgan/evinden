import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import { useFavorites } from '@/lib/favorites-context';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import { useTheme } from '@/lib/theme-context';
import { shareSeller } from '@/lib/social-share';
import type { MenuItem, Seller } from '@/types';
import FoodImage from '@/components/shared/FoodImage';
import { getSellerImage, getMenuImage } from '@/lib/food-images';
import { fetchSellerWithMenu, fetchSellerHours, fetchReviews, type ReviewRow, type SellerHourRow } from '@/lib/db';

const { width: SCREEN_W } = Dimensions.get('window');

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

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

function hoursRowToDisplay(rows: SellerHourRow[]): WorkingHours[] {
  return DAY_NAMES.map((day, i) => {
    const row = rows.find(r => r.day_of_week === i + 1);
    if (!row || !row.is_open) return { day, hours: 'Kapalı', open: false };
    return { day, hours: `${row.open_time ?? '09:00'} - ${row.close_time ?? '21:00'}`, open: true };
  });
}

function formatMemberSince(createdAt: string): string {
  const d = new Date(createdAt);
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${months[d.getMonth()]} ${d.getFullYear()}'dan beri aktif`;
}

// ─── Info Chip Component ──────────────────────────────────────────────────────

function InfoChip({ icon, label, accent }: { icon: string; label: string; accent?: boolean }) {
  return (
    <View style={[st.chip, accent && st.chipAccent]}>
      <Text style={st.chipIcon}>{icon}</Text>
      <Text style={[st.chipLabel, accent && st.chipLabelAccent]}>{label}</Text>
    </View>
  );
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  popular: { label: '🔥 Popüler', bg: '#FFF3E0', text: '#E65100' },
  new: { label: '✨ Yeni', bg: '#E8F5E9', text: '#2E7D32' },
  spicy: { label: '🌶️ Acılı', bg: '#FFEBEE', text: '#C62828' },
};

function MenuCard({
  item,
  emoji,
  bgColor,
  qty,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem;
  emoji: string;
  bgColor: string;
  qty: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors: t } = useTheme();
  const badge = item.badge ? BADGE_CONFIG[item.badge] : null;
  const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0);

  return (
    <View style={[st.menuCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, !item.is_available && st.menuCardDisabled]}>
      {/* Sol: görsel */}
      <View style={st.menuLeft}>
        <FoodImage
          imageUrl={item.image_url}
          localImage={getMenuImage(item.id).image}
          emoji={emoji}
          bg={bgColor}
          size={64}
          borderRadius={14}
        />
      </View>

      {/* Orta: bilgi */}
      <View style={st.menuCenter}>
        <View style={st.menuTitleRow}>
          <Text style={[st.menuTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
          {badge && (
            <View style={[st.badgePill, { backgroundColor: badge.bg }]}>
              <Text style={[st.badgeText, { color: badge.text }]}>{badge.label}</Text>
            </View>
          )}
        </View>
        {/* Availability indicator */}
        {!item.is_available && (
          <View style={st.menuTagsRow}>
            <View style={[st.stockBadge, st.stockBadgeSoldOut]}>
              <Text style={[st.stockBadgeText, st.stockBadgeTextSoldOut]}>Tükendi</Text>
            </View>
          </View>
        )}
        {item.description ? (
          <Text style={[st.menuDesc, { color: t.textMuted }]} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={st.menuPriceRow}>
          <Text style={st.menuPrice}>{priceTL(item.price_cents)}</Text>
          {hasOptions && (
            <Text style={st.optionsHint}>Seçenekler mevcut</Text>
          )}
        </View>
      </View>

      {/* Sağ: sepet kontrol */}
      <View style={st.menuRight}>
        {!item.is_available ? (
          <View style={st.soldOut}>
            <Text style={st.soldOutText}>Tükendi</Text>
          </View>
        ) : qty === 0 ? (
          <Pressable style={st.addBtn} onPress={onAdd}>
            <Text style={st.addBtnPlus}>+</Text>
          </Pressable>
        ) : (
          <View style={st.qtyControl}>
            <Pressable style={st.qtyBtn} onPress={onDecrement} hitSlop={8}>
              <Text style={st.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={st.qtyNum}>{qty}</Text>
            <Pressable style={[st.qtyBtn, st.qtyBtnAdd]} onPress={onIncrement} hitSlop={8}>
              <Text style={[st.qtyBtnText, st.qtyBtnAddText]}>+</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
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

  const [seller, setSeller] = useState<(Seller & { deliveryTime: string; minOrder: number }) | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHours, setShowHours] = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHours[]>([]);
  const [optionsItem, setOptionsItem] = useState<MenuItem | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const [isFollowing, setIsFollowing] = useState(false);
  const [messageText, setMessageText] = useState('');
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
          const s: Seller & { deliveryTime: string; minOrder: number } = {
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
            deliveryTime: '25-40',
            minOrder: 5000,
          };
          setSeller(s);
          const items: MenuItem[] = result.menu_items.map(m => ({
            id: m.id,
            seller_id: m.seller_id,
            title: m.title,
            description: m.description,
            price_cents: m.price_cents,
            currency: m.currency,
            image_url: m.image_url,
            is_available: m.is_available,
            category: m.category ?? undefined,
            created_at: m.created_at,
            updated_at: m.updated_at,
          }));
          setMenuItems(items);

          // Fetch reviews and hours in parallel
          const [reviews, hours] = await Promise.all([
            fetchReviews(id).catch(() => [] as ReviewRow[]),
            fetchSellerHours(id).catch(() => [] as SellerHourRow[]),
          ]);
          setDbReviews(reviews);
          if (hours.length > 0) setWorkingHours(hoursRowToDisplay(hours));
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

  const toggleFav = useCallback(() => {
    toggleFavorite(id!);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, friction: 3, tension: 200, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }, [id, heartScale, toggleFavorite]);

  const openOptionsOrAdd = useCallback(
    (item: MenuItem) => {
      const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0);
      if (hasOptions) {
        setOptionsItem(item);
        setSelectedVariant(item.variants?.[0]?.id ?? null);
        setSelectedExtras(new Set());
        optionsSheetRef.current?.snapToIndex(0);
        return;
      }
      doAdd(item, item.price_cents, item.title);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const doAdd = useCallback(
    (item: MenuItem, priceCents: number, title: string) => {
      const ok = addItem(id!, {
        menuItemId: item.id,
        title,
        priceCents,
      });
      if (!ok) {
        Alert.alert(
          'Sepeti Temizle?',
          'Sepetinizde başka bir satıcıdan ürün var. Devam etmek için sepet temizlenecek.',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Temizle ve Ekle',
              style: 'destructive',
              onPress: () =>
                forceAdd(id!, {
                  menuItemId: item.id,
                  title,
                  priceCents,
                }),
            },
          ],
        );
      }
    },
    [id, addItem, forceAdd],
  );

  const confirmOptions = useCallback(() => {
    if (!optionsItem) return;
    const variant = optionsItem.variants?.find(v => v.id === selectedVariant);
    const extrasArr = optionsItem.extras?.filter(e => selectedExtras.has(e.id)) ?? [];
    const extrasCents = extrasArr.reduce((sum, e) => sum + e.priceCents, 0);
    const variantDiff = variant?.priceDiffCents ?? 0;
    const totalPrice = optionsItem.price_cents + variantDiff + extrasCents;

    const parts = [optionsItem.title];
    if (variant && optionsItem.variants && optionsItem.variants.length > 1) parts.push(`(${variant.label})`);
    if (extrasArr.length > 0) parts.push(`+ ${extrasArr.map(e => e.label).join(', ')}`);
    const title = parts.join(' ');

    doAdd(optionsItem, totalPrice, title);
    setOptionsItem(null);
    optionsSheetRef.current?.close();
  }, [optionsItem, selectedVariant, selectedExtras, doAdd]);

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

  const sellerImg = getSellerImage(id!);
  const avatar = { emoji: sellerImg.emoji, bg: sellerImg.bg };
  const hasCart = fromThisSeller && totalItems > 0;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      {/* ═══ Sticky Header (scroll'da görünür — blur glass) ═══ */}
      <Animated.View style={[st.stickyHeader, { opacity: headerOpacity, backgroundColor: t.surface + 'B3' }]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top']} style={st.stickyInner}>
          <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Text style={st.backIcon}>‹</Text>
          </Pressable>
          <Text style={[st.stickyTitle, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
          <View style={st.stickyRating}>
            <Text style={st.stickyRatingStar}>★</Text>
            <Text style={st.stickyRatingNum}>{Number(seller.rating_avg).toFixed(1)}</Text>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* ═══ Floating back & fav button (hero üstünde) ═══ */}
      <SafeAreaView edges={['top']} style={st.floatingBackWrap}>
        <View style={st.floatingRow}>
          <Pressable style={st.floatingBtn} onPress={() => router.back()} hitSlop={12}>
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
            <Text style={st.floatingBtnIcon}>‹</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={st.floatingBtn}
              onPress={() => seller && shareSeller(seller.display_name, Number(seller.rating_avg), seller.district ?? '')}
              hitSlop={12}
            >
              <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              <Text style={st.floatingBtnIcon}>↗</Text>
            </Pressable>
            <Pressable style={st.floatingBtn} onPress={toggleFav} hitSlop={12}>
              <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              <Animated.Text style={[st.floatingFavIcon, { transform: [{ scale: heartScale }] }]}>
                {isFav ? '❤️' : '🤍'}
              </Animated.Text>
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
        <View style={[st.heroCover, { backgroundColor: avatar.bg }]}>
          <FoodImage
            localImage={getSellerImage(id!).image}
            emoji={avatar.emoji}
            bg={avatar.bg}
            size={SCREEN_W}
            borderRadius={0}
            fontSize={72}
            style={{ width: SCREEN_W, height: 200 }}
          />
          {/* Gradient overlay alttan */}
          <View style={st.heroGradient} />
        </View>

        {/* ═══ SELLER INFO ═══ */}
        <View style={[st.infoSection, { backgroundColor: t.surface }]}>
          <Text style={[st.sellerName, { color: t.text }]}>{seller.display_name}</Text>

          {/* Rating bar */}
          <View style={st.ratingRow}>
            <View style={st.ratingBadge}>
              <Text style={st.ratingStarBig}>★</Text>
              <Text style={st.ratingNumBig}>{Number(seller.rating_avg).toFixed(1)}</Text>
            </View>
            <Text style={[st.ratingCountText, { color: t.textMuted }]}>{seller.rating_count} değerlendirme</Text>
            <View style={st.ratingDivider} />
            <Text style={st.verifiedText}>✓ Onaylı Mutfak</Text>
          </View>

          {seller.bio ? (
            <Text style={[st.sellerBio, { color: t.textSecondary }]}>{seller.bio}</Text>
          ) : null}

          {/* Info chips — Yemeksepeti tarzı */}
          <View style={st.chipsRow}>
            <InfoChip icon="🕐" label={`${seller.deliveryTime} dk`} />
            <InfoChip icon="💰" label={`Min ${priceTL(seller.minOrder)}`} />
            <InfoChip icon="📍" label={seller.district ?? seller.city ?? ''} />
            <InfoChip icon="🟢" label="Açık" accent />
          </View>

          {/* Takip Et + Mesaj Gönder butonları */}
          <View style={st.actionBtnsRow}>
            <Pressable
              style={[st.followBtn, isFollowing && st.followBtnActive]}
              onPress={() => setIsFollowing(!isFollowing)}
            >
              <Text style={[st.followBtnText, isFollowing && st.followBtnTextActive]}>
                {isFollowing ? '✓ Takip Ediliyor' : '+ Takip Et'}
              </Text>
            </Pressable>
            <Pressable
              style={st.messageBtnInline}
              onPress={() => messageSheetRef.current?.snapToIndex(0)}
            >
              <Text style={st.messageBtnInlineText}>💬 Mesaj Gönder</Text>
            </Pressable>
            <Pressable
              style={st.customOrderBtn}
              onPress={() => {
                setMessageText('Merhaba, özel bir sipariş vermek istiyorum: ');
                messageSheetRef.current?.snapToIndex(0);
              }}
            >
              <Text style={st.customOrderBtnText}>📋 Özel Sipariş</Text>
            </Pressable>
          </View>
        </View>

        {/* Campaigns section removed — no per-seller campaigns in DB */}

        {/* ═══ GÜVEN & İSTATİSTİKLER ═══ */}
        <View style={[st.trustSection, { backgroundColor: t.surface }]}>
          <Text style={[st.sectionTitle, { color: t.text }]}>Güven & İstatistikler</Text>

          <View style={st.statsGrid}>
            <View style={[st.statCard, { backgroundColor: '#FFF8E1' }]}>
              <Text style={st.statEmoji}>⭐</Text>
              <Text style={st.statNum}>{Number(seller.rating_avg ?? 0).toFixed(1)}</Text>
              <Text style={st.statLabel}>Puan</Text>
            </View>
            <View style={[st.statCard, { backgroundColor: '#E8F5E9' }]}>
              <Text style={st.statEmoji}>💬</Text>
              <Text style={st.statNum}>{seller.rating_count}</Text>
              <Text style={st.statLabel}>Değerlendirme</Text>
            </View>
            <View style={[st.statCard, { backgroundColor: '#E3F2FD' }]}>
              <Text style={st.statEmoji}>🍽️</Text>
              <Text style={st.statNum}>{menuItems.length}</Text>
              <Text style={st.statLabel}>Menü Ürünü</Text>
            </View>
            <View style={[st.statCard, { backgroundColor: '#F3E5F5' }]}>
              <Text style={st.statEmoji}>🕐</Text>
              <Text style={st.statNum}>{seller.deliveryTime} dk</Text>
              <Text style={st.statLabel}>Teslimat</Text>
            </View>
          </View>

          <View style={st.trustBadgesRow}>
            <View style={st.trustBadge}>
              <Text style={st.trustBadgeIcon}>✓</Text>
              <Text style={st.trustBadgeText}>Onaylı Satıcı</Text>
            </View>
            <View style={st.trustBadge}>
              <Text style={st.trustBadgeIcon}>📅</Text>
              <Text style={st.trustBadgeText}>{formatMemberSince(seller.created_at)}</Text>
            </View>
          </View>
        </View>

        {/* ═══ MENÜ ═══ */}
        <View style={[st.menuSection, { backgroundColor: t.background }]}>
          <View style={st.menuHeader}>
            <Text style={[st.menuHeading, { color: t.text }]}>Menü</Text>
            <Text style={[st.menuCount, { color: t.textMuted }]}>{menuItems.length} ürün</Text>
          </View>

          {menuItems.length === 0 ? (
            <View style={st.emptyMenu}>
              <Text style={st.emptyEmoji}>🍽️</Text>
              <Text style={st.emptyText}>Şu an aktif ürün bulunmuyor</Text>
            </View>
          ) : (
            <View style={st.menuList}>
              {(() => {
                const categories: string[] = [];
                menuItems.forEach(item => {
                  const cat = item.category ?? 'Diğer';
                  if (!categories.includes(cat)) categories.push(cat);
                });
                return categories.map(cat => (
                  <View key={cat}>
                    <View style={[st.catHeader, { borderBottomColor: t.surfaceBorder }]}>
                      <Text style={[st.catHeaderText, { color: t.text }]}>{cat}</Text>
                      <Text style={[st.catHeaderCount, { color: t.textMuted }]}>
                        {menuItems.filter(i => (i.category ?? 'Diğer') === cat).length} ürün
                      </Text>
                    </View>
                    {menuItems
                      .filter(i => (i.category ?? 'Diğer') === cat)
                      .map(item => {
                        const cartItem = fromThisSeller
                          ? cartItems.find(ci => ci.menuItemId === item.id)
                          : undefined;
                        const qty = cartItem?.quantity ?? 0;
                        const menuImg = getMenuImage(item.id);
                        const emoji = menuImg.emoji;
                        const bgColor = menuImg.bg;
                        return (
                          <MenuCard
                            key={item.id}
                            item={item}
                            emoji={emoji}
                            bgColor={bgColor}
                            qty={qty}
                            onAdd={() => openOptionsOrAdd(item)}
                            onIncrement={() => incrementItem(item.id)}
                            onDecrement={() => decrementItem(item.id)}
                          />
                        );
                      })}
                  </View>
                ));
              })()}
            </View>
          )}
        </View>

        {/* ═══ ÇALIŞMA SAATLERİ ═══ */}
        {workingHours.length > 0 && (
          <View style={[st.hoursSection, { backgroundColor: t.surface }]}>
            <Pressable style={st.hoursTitleRow} onPress={() => setShowHours(!showHours)}>
              <Text style={[st.hoursHeading, { color: t.text }]}>🕐 Çalışma Saatleri</Text>
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
                  <Text style={st.ratingSummaryNum}>{Number(seller.rating_avg).toFixed(1)}</Text>
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
                    <Text style={st.topReviewBadgeText}>⭐ En Beğenilen Yorum</Text>
                  </View>
                  <View style={st.reviewTop}>
                    <View style={[st.reviewAvatar, { backgroundColor: '#FFF8E1', borderColor: '#EF9F27' }]}>
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
                    onPress={() => {
                      setHelpfulReviews(prev => {
                        const next = new Set(prev);
                        if (next.has(rev.id)) next.delete(rev.id);
                        else next.add(rev.id);
                        return next;
                      });
                    }}
                  >
                    <Text style={[st.helpfulBtnText, helpfulReviews.has(rev.id) && st.helpfulBtnTextActive]}>
                      👍 Faydalı ({rev.helpfulCount + (helpfulReviews.has(rev.id) ? 1 : 0)})
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
                <Text style={[st.deliveryValue, { color: t.text }]}>{priceTL(seller.minOrder)}</Text>
              </View>
            </View>

            <View style={st.deliveryDivider} />

            <View style={st.deliveryRow}>
              <Text style={st.deliveryIcon}>📍</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Bölgesi</Text>
                <Text style={[st.deliveryValue, { color: t.text }]}>{seller.district ?? seller.city ?? 'Belirtilmemiş'}</Text>
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
              <Text style={st.aboutLabel}>📍 Konum</Text>
              <Text style={st.aboutValue}>
                {[seller.address_line, seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>🕐 Teslimat</Text>
              <Text style={st.aboutValue}>{seller.deliveryTime} dakika</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>💰 Min. Sipariş</Text>
              <Text style={st.aboutValue}>{priceTL(seller.minOrder)}</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>⭐ Puan</Text>
              <Text style={st.aboutValue}>
                {Number(seller.rating_avg).toFixed(1)} ({seller.rating_count} yorum)
              </Text>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ═══ CART BAR ═══ */}
      {hasCart && (
        <View style={st.cartBar}>
          <SafeAreaView edges={['bottom']} style={st.cartBarInner}>
            <View style={st.cartBarLeft}>
              <View style={st.cartBadge}>
                <Text style={st.cartBadgeText}>{totalItems}</Text>
              </View>
              <View>
                <Text style={st.cartBarLabel}>Sepeti Görüntüle</Text>
                <Text style={st.cartBarPrice}>{priceTL(totalCents)}</Text>
              </View>
            </View>
            <Pressable
              style={st.cartBarBtn}
              onPress={() => router.push('/(customer)/cart')}
            >
              <Text style={st.cartBarBtnText}>Sepete Git →</Text>
            </Pressable>
          </SafeAreaView>
        </View>
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
        handleIndicatorStyle={{ backgroundColor: '#D0C8BC', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.optionsInner}>
          {optionsItem && (
            <>
              <View style={st.optionsHeader}>
                <Text style={st.optionsTitle}>{optionsItem.title}</Text>
                <Pressable onPress={() => optionsSheetRef.current?.close()} hitSlop={8}>
                  <Text style={st.optionsClose}>✕</Text>
                </Pressable>
              </View>

              {optionsItem.description ? (
                <Text style={st.optionsDesc}>{optionsItem.description}</Text>
              ) : null}

              {/* Variants */}
              {optionsItem.variants && optionsItem.variants.length > 0 && (
                <View style={st.optionsSection}>
                  <Text style={st.optionsSectionTitle}>Porsiyon / Boyut</Text>
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
                  <Text style={st.optionsSectionTitle}>Ekstralar</Text>
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
                        <Text style={st.optionPrice}>+{priceTL(e.priceCents)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Total & Confirm */}
              <View style={st.optionsFooter}>
                <Text style={st.optionsTotal}>
                  {priceTL(
                    optionsItem.price_cents +
                    (optionsItem.variants?.find(v => v.id === selectedVariant)?.priceDiffCents ?? 0) +
                    (optionsItem.extras?.filter(e => selectedExtras.has(e.id)).reduce((s, e) => s + e.priceCents, 0) ?? 0)
                  )}
                </Text>
                <Pressable style={st.optionsConfirmBtn} onPress={confirmOptions}>
                  <Text style={st.optionsConfirmText}>Sepete Ekle</Text>
                </Pressable>
              </View>
            </>
          )}
        </BottomSheetView>
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
        handleIndicatorStyle={{ backgroundColor: '#D0C8BC', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.optionsInner}>
          <View style={st.optionsHeader}>
            <Text style={st.optionsTitle}>💬 Mesaj Gönder</Text>
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
              <Text style={st.msgQuickBtnText}>🕐 Ne zaman hazır?</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Alerjen içermeyen seçenekleriniz var mı?')}>
              <Text style={st.msgQuickBtnText}>⚠️ Alerjen bilgisi</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Özel bir sipariş vermek istiyorum: ')}>
              <Text style={st.msgQuickBtnText}>📋 Özel sipariş</Text>
            </Pressable>
          </View>
          <Pressable
            style={[st.msgSendBtn, !messageText.trim() && { opacity: 0.5 }]}
            onPress={() => {
              if (messageText.trim()) {
                Alert.alert('Mesaj Gönderildi', 'Satıcı en kısa sürede yanıt verecektir.');
                setMessageText('');
                messageSheetRef.current?.close();
              }
            }}
          >
            <Text style={st.msgSendBtnText}>Gönder</Text>
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
  errorEmoji: { fontSize: 52 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#1A1208' },
  errorBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
  stickyTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1A1208' },
  stickyRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stickyRatingStar: { fontSize: 14, color: '#EF9F27' },
  stickyRatingNum: { fontSize: 14, fontWeight: '700', color: '#1A1208' },

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
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  floatingBtnIcon: { fontSize: 24, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  floatingFavIcon: { fontSize: 20, marginTop: 1 },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },

  // ── Hero Cover
  heroCover: {
    height: 200,
    width: SCREEN_W,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  heroEmoji: { fontSize: 72 },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent',
  },

  // ── Info Section
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  sellerName: { fontSize: 24, fontWeight: '800', color: '#1A1208', marginBottom: 8 },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  ratingStarBig: { fontSize: 14, color: '#EF9F27' },
  ratingNumBig: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  ratingCountText: { fontSize: 13, color: '#8A7E72' },
  ratingDivider: { width: 1, height: 14, backgroundColor: '#E8E2DA' },
  verifiedText: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },

  sellerBio: { fontSize: 14, color: '#6B5E50', lineHeight: 20, marginBottom: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F7F3EE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  chipAccent: { backgroundColor: '#E8F5E9' },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  chipLabelAccent: { color: '#2E7D32' },

  // ── Menu Section
  menuSection: { paddingTop: 20, paddingHorizontal: 16 },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuHeading: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  menuCount: { fontSize: 13, color: '#A89A8A', fontWeight: '500' },
  menuList: { gap: 10 },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 4, paddingHorizontal: 4 },
  catHeaderText: { fontSize: 15, fontWeight: '800', color: '#1A1208' },
  catHeaderCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },

  // ── Menu Card
  menuCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  menuCardDisabled: { opacity: 0.5 },
  menuLeft: {},
  menuEmoji: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  menuEmojiText: { fontSize: 28 },
  menuCenter: { flex: 1, gap: 3 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  menuDesc: { fontSize: 12, color: '#8A7E72', lineHeight: 17 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  menuPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  menuPrice: { fontSize: 16, fontWeight: '800', color: colors.primary },
  badgePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  optionsHint: { fontSize: 10, color: '#A89A8A', fontWeight: '500', fontStyle: 'italic' },
  menuRight: { alignItems: 'flex-end', flexShrink: 0 },

  // ── Add / Qty controls
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  addBtnPlus: { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: -1 },
  soldOut: {
    backgroundColor: '#F5F0EA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  soldOutText: { fontSize: 11, fontWeight: '600', color: '#A89A8A' },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F3EE',
    borderRadius: 12,
    gap: 4,
    padding: 4,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  qtyBtnAdd: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#1A1208', lineHeight: 20 },
  qtyBtnAddText: { color: '#fff' },
  qtyNum: { fontSize: 15, fontWeight: '800', color: '#1A1208', minWidth: 24, textAlign: 'center' },

  // ── Empty
  emptyMenu: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontSize: 14, color: '#A89A8A', marginTop: 12 },

  // ── About Section
  aboutSection: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16 },
  aboutHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 12 },
  aboutCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutLabel: { fontSize: 13, color: '#8A7E72' },
  aboutValue: { fontSize: 13, fontWeight: '600', color: '#1A1208', textAlign: 'right', maxWidth: '55%' },
  aboutDivider: { height: 1, backgroundColor: '#F5F0EA' },

  // ── Cart Bar
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
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
  cartBadgeText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cartBarLabel: { fontSize: 12, color: '#8A7E72', fontWeight: '500' },
  cartBarPrice: { fontSize: 17, fontWeight: '800', color: '#1A1208' },
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
  cartBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Working Hours
  hoursSection: { paddingHorizontal: 16, paddingTop: 24 },
  hoursTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hoursHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  hoursToggle: { fontSize: 14, color: '#A89A8A' },
  hoursCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
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
  hoursRowToday: { backgroundColor: '#FFF5F2' },
  hoursDay: { fontSize: 13, fontWeight: '600', color: '#6B5E50', width: 90 },
  hoursDayToday: { color: colors.primary, fontWeight: '800' },
  hoursTime: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  hoursTimeClosed: { color: '#C62828' },
  hoursTimeToday: { color: colors.primary, fontWeight: '800' },
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
    borderColor: '#F0ECE6',
    padding: 14,
    gap: 10,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FAF7F2',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 14, fontWeight: '700', color: '#6B5E50' },
  reviewName: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  reviewDate: { fontSize: 11, color: '#A89A8A' },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewStar: { fontSize: 12, color: '#E8E2DA' },
  reviewStarActive: { color: '#EF9F27' },
  reviewComment: { fontSize: 13, color: '#6B5E50', lineHeight: 19 },

  // Options modal
  optionsCard: { backgroundColor: '#fff' },
  optionsInner: { padding: 20, paddingBottom: 34 },
  optionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  optionsTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', flex: 1, marginRight: 12 },
  optionsClose: { fontSize: 18, color: '#A89A8A', fontWeight: '700', padding: 4 },
  optionsDesc: { fontSize: 13, color: '#8A7E72', lineHeight: 19, marginBottom: 12 },
  optionsSection: { marginTop: 16 },
  optionsSectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B5E50', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: '#FAF7F2', borderWidth: 1, borderColor: '#F0ECE6' },
  optionRowActive: { backgroundColor: '#FFF0EB', borderColor: colors.primary },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D0C8BC', alignItems: 'center', justifyContent: 'center' },
  optionRadioActive: { borderColor: colors.primary },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  optionCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D0C8BC', alignItems: 'center', justifyContent: 'center' },
  optionCheckActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionCheckMark: { fontSize: 12, fontWeight: '900', color: '#fff' },
  optionLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1A1208' },
  optionLabelActive: { color: colors.primary, fontWeight: '700' },
  optionPrice: { fontSize: 13, fontWeight: '700', color: '#6B5E50' },
  optionsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0ECE6' },
  optionsTotal: { fontSize: 22, fontWeight: '900', color: '#1A1208' },
  optionsConfirmBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  optionsConfirmText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // Rating summary
  ratingSummary: { flexDirection: 'row', backgroundColor: '#FAF7F2', borderRadius: 16, padding: 16, marginBottom: 14, gap: 20, borderWidth: 1, borderColor: '#F0ECE6' },
  ratingSummaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  ratingSummaryNum: { fontSize: 36, fontWeight: '900', color: '#1A1208' },
  ratingSummaryStars: { flexDirection: 'row', gap: 2 },
  ratingSummaryCount: { fontSize: 11, color: '#A89A8A', fontWeight: '500', marginTop: 2 },
  ratingSummaryBars: { flex: 1, justifyContent: 'center', gap: 5 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingBarLabel: { fontSize: 12, fontWeight: '700', color: '#A89A8A', width: 12, textAlign: 'center' },
  ratingBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EDE8E2', overflow: 'hidden' },
  ratingBarFill: { height: '100%', borderRadius: 3, backgroundColor: '#EF9F27' },

  // ── Action Buttons (Takip Et, Mesaj, Özel Sipariş)
  actionBtnsRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  followBtnActive: { backgroundColor: colors.primary },
  followBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  followBtnTextActive: { color: '#fff' },
  messageBtnInline: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F0ECE6',
  },
  messageBtnInlineText: { fontSize: 13, fontWeight: '700', color: '#6B5E50' },
  customOrderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
  },
  customOrderBtnText: { fontSize: 13, fontWeight: '700', color: '#1565C0' },

  // ── Campaigns
  campaignsSection: { marginTop: 12 },
  campaignsScroll: { paddingHorizontal: 16, gap: 10 },
  campaignCard: {
    width: 220,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  campaignTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  campaignBadge: { fontSize: 24 },
  campaignTypePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  campaignTypeText: { fontSize: 10, fontWeight: '800' },
  campaignTitle: { fontSize: 14, fontWeight: '800' },
  campaignDesc: { fontSize: 12, color: '#6B5E50', lineHeight: 17 },
  campaignValid: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  // ── Trust & Stats
  trustSection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 14 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    minWidth: '46%' as any,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statEmoji: { fontSize: 22 },
  statNum: { fontSize: 18, fontWeight: '900', color: '#1A1208' },
  statLabel: { fontSize: 11, color: '#6B5E50', fontWeight: '600', textAlign: 'center' },

  monthStatsRow: {
    flexDirection: 'row',
    backgroundColor: '#FAF7F2',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  monthStatItem: { flex: 1, alignItems: 'center', gap: 4 },
  monthStatNum: { fontSize: 18, fontWeight: '900', color: '#1A1208' },
  monthStatLabel: { fontSize: 11, color: '#8A7E72', fontWeight: '500', textAlign: 'center' },
  monthStatDivider: { width: 1, backgroundColor: '#E8E2DA', marginVertical: 4 },

  popularItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  popularItemIcon: { fontSize: 28 },
  popularItemLabel: { fontSize: 11, color: '#8A7E72', fontWeight: '500' },
  popularItemName: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  popularItemCount: { fontSize: 16, fontWeight: '900', color: '#EF9F27' },

  trustBadgesRow: { gap: 8 },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF7F2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  trustBadgeIcon: { fontSize: 16 },
  trustBadgeText: { fontSize: 12, color: '#6B5E50', fontWeight: '600', flex: 1 },

  // ── Menu Tags (Alerjen, Kalori, Stok)
  menuTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  calorieBadge: {
    backgroundColor: '#F5F0EA',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  calorieBadgeText: { fontSize: 9, fontWeight: '700', color: '#8A7E72' },
  dietBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dietBadgeText: { fontSize: 9, fontWeight: '700' },
  allergenBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  allergenBadgeText: { fontSize: 9, fontWeight: '700', color: '#E65100' },
  stockBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stockBadgeSoldOut: { backgroundColor: '#FFEBEE' },
  stockBadgeText: { fontSize: 9, fontWeight: '700', color: '#2E7D32' },
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
    backgroundColor: '#EF9F27',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  topReviewBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  helpfulCountHighlight: { fontSize: 13, fontWeight: '700', color: '#EF9F27' },
  reviewMenuTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5F0EA',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reviewMenuTagText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  sellerReplyCard: {
    backgroundColor: '#F0FFF4',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#2E7D32',
  },
  sellerReplyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  sellerReplyIcon: { fontSize: 12 },
  sellerReplyLabel: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  sellerReplyText: { fontSize: 12, color: '#4E342E', lineHeight: 17 },
  reviewActions: { flexDirection: 'row', marginTop: 4 },
  helpfulBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0EA',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  helpfulBtnActive: { backgroundColor: '#E3F2FD' },
  helpfulBtnText: { fontSize: 11, fontWeight: '600', color: '#8A7E72' },
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
  deliveryIcon: { fontSize: 20, marginTop: 2 },
  deliveryLabel: { fontSize: 11, fontWeight: '500', marginBottom: 2 },
  deliveryValue: { fontSize: 13, fontWeight: '600' },
  deliveryFreeNote: { fontSize: 11, fontWeight: '500', color: '#2E7D32' },
  deliveryDivider: { height: 1, backgroundColor: '#F0ECE6', marginHorizontal: 14 },
  deliveryZonesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  deliveryZoneChip: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deliveryZoneText: { fontSize: 12, fontWeight: '600', color: '#1565C0' },

  // ── Seller Story
  storySection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  storyCard: {
    backgroundColor: '#FAF7F2',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  storyMotivation: { fontSize: 16, fontWeight: '800', color: colors.primary, fontStyle: 'italic', textAlign: 'center' },
  storyText: { fontSize: 13, lineHeight: 20 },
  expertiseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  expertiseTag: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  expertiseTagText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  socialRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  socialBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  socialBtnText: { fontSize: 12, fontWeight: '700', color: '#1A1208' },

  // ── Message BottomSheet
  msgSubtitle: { fontSize: 13, marginBottom: 12 },
  msgInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    minHeight: 80,
    marginBottom: 10,
  },
  msgQuickBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  msgQuickBtn: {
    backgroundColor: '#F5F0EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  msgQuickBtnText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  msgSendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  msgSendBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
