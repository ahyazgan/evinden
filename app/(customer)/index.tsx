import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { HOME_SELLERS_ENABLED, isSellerListed } from '@/constants/business';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTabBarSpace } from '@/components/shared/ChainTabBar';
import FoodImage from '@/components/shared/FoodImage';
import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { Logo } from '@/components/shared/Logo';
import { HomeScreenSkeleton } from '@/components/shared/Skeleton';
import { RestaurantCard, type RestaurantCardData } from '@/components/shared/RestaurantCard';
import { CAMPAIGN_CARD_WIDTH, CampaignCard } from '@/components/shared/CampaignCard';
import { HomeFilterPanel } from '@/components/shared/HomeFilterPanel';
import { SiteFooter } from '@/components/shared/SiteFooter';
import { CartButton, SearchField, TopBar } from '@/components/shared/TopBar';
import { useTheme } from '@/lib/theme-context';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { haversineKm, isInDeliveryArea } from '@/lib/geo';
import { fetchActiveOrder, fetchCategoryMatches, fetchHomeCampaigns, fetchMenuItems, fetchOrderHistory, fetchReferralPaused, searchMenuItems, type ActiveOrder, type CouponRow, type SellerHourRow } from '@/lib/db';
import { cuisineIcon, cuisineLabel, cuisineLabels } from '@/lib/cuisines';
import { useFavorites } from '@/lib/favorites-context';
import { EMPTY_FILTERS, activeFilterCount, cuisineCounts, isLocalFavorite, matchesFilters, sortSellers, type HomeFilters, type HomeSeller } from '@/lib/home-filters';
import { fonts } from '@/lib/fonts';
import { gridItemWidth, useResponsive } from '@/lib/responsive';
import { track } from '@/lib/analytics';
import { CATEGORY_IMAGES, CUISINE_IMAGES, PHOTO_CUISINES, sellerPhoto } from '@/lib/food-images';
import { neighbourhoodStars, newlyOpened, sortByCuisineOrder } from '@/lib/cuisine-order';
import { favouriteCategories, recommend, type CategoryMatch, type HistoryOrder } from '@/lib/recommendations';

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerRow = {
  id: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  rating_avg: number;
  rating_count: number;
  is_active: boolean;
  is_paused?: boolean;
  seller_hours?: SellerHourRow[];
  logo_url?: string | null;
  cover_url?: string | null;
  delivery_fee_cents?: number;
  seller_type?: 'home' | 'restaurant';
  min_order_cents?: number;
  delivery_time_min?: number;
  delivery_time_max?: number;
  delivery_radius_km?: number;
  cuisines?: string[];
  meal_cards?: string[];
  pickup_enabled?: boolean;
  /** Katılım tarihi: "Yeni açılanlar" satırı için */
  created_at?: string;
};

type Dish = {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  priceCents: number;
  imageUrl: string | null;
};

type SellerType = 'all' | 'home' | 'restaurant';

const TYPES: { key: SellerType; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'home', label: 'Ev Yemeği' },
  { key: 'restaurant', label: 'Restoran' },
];


/** Ana sayfadaki yemek vitrini */
const DISH_SELLERS = 6;
const DISHES_PER_SELLER = 2;
const MAX_DISHES = 8;

/** Sana özel: telefonda yana kayar, masaüstünde listenin üstünde tek sıra kalır. */
const FOR_YOU_PHONE = 6;
const FOR_YOU_DESKTOP = 3;
const FOR_YOU_CARD_WIDTH = 264;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOpen(seller: SellerRow): boolean {
  return !seller.is_paused && isOpenAt(seller.seller_hours ?? [], istanbulClock());
}

/** Süren siparişin müşteriye söylenen durumu */
const ACTIVE_STATUS: Record<string, string> = {
  pending: 'Restoranın onayı bekleniyor',
  accepted: 'Restoran siparişini onayladı',
  preparing: 'Siparişin hazırlanıyor',
  ready: 'Siparişin hazır',
  out_for_delivery: 'Siparişin yolda',
};

/** Telefondaki hızlı filtreler. Geri kalanı filtre penceresindedir. */
const QUICK_FILTERS: { label: string; on: (f: HomeFilters) => boolean; flip: (f: HomeFilters) => Partial<HomeFilters> }[] = [
  { label: 'Şimdi açık', on: f => f.open, flip: f => ({ open: !f.open }) },
  { label: 'Kampanyalı', on: f => f.campaign, flip: f => ({ campaign: !f.campaign }) },
  { label: '4 puan ve üzeri', on: f => f.minRating === 4, flip: f => ({ minRating: f.minRating === 4 ? null : 4 }) },
  { label: 'Ücretsiz teslimat', on: f => f.freeDelivery, flip: f => ({ freeDelivery: !f.freeDelivery }) },
  { label: 'Yemek kartı', on: f => f.mealCard, flip: f => ({ mealCard: !f.mealCard }) },
];

function toCard(seller: SellerRow, km: number | null = null): RestaurantCardData {
  const ratingAvg = Number(seller.rating_avg) || 0;
  return {
    cuisines: cuisineLabels(seller.cuisines),
    distanceKm: km,
    mealCards: (seller.meal_cards ?? []).length > 0,
    localFavorite: isLocalFavorite(ratingAvg, seller.rating_count),
    name: seller.display_name,
    photo: sellerPhoto(seller),
    ratingAvg: Number(seller.rating_avg) || 0,
    ratingCount: seller.rating_count,
    typeLabel: seller.seller_type === 'restaurant' ? 'Restoran' : 'Ev yemeği',
    timeMin: seller.delivery_time_min ?? 25,
    timeMax: seller.delivery_time_max ?? 40,
    deliveryFeeCents: seller.delivery_fee_cents ?? null,
    minOrderCents: seller.min_order_cents ?? 0,
    open: isOpen(seller),
  };
}

const lira = (cents: number) => `₺${(cents / 100).toFixed(0)}`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CustomerHomeScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { session, requireAuth } = useRequireAuth();
  const userId = session?.userId ?? null;
  const { isDesktop, pageWidth } = useResponsive();
  const tabBarSpace = useTabBarSpace();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [search, setSearch] = useState('');
  const [sellerType, setSellerType] = useState<SellerType>('all');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('Konum seç');
  const [locationChosen, setLocationChosen] = useState(false);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [campaignList, setCampaignList] = useState<CouponRow[]>([]);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [referralPaused, setReferralPaused] = useState(true);
  const [dishMatches, setDishMatches] = useState<Record<string, string>>({});
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filters, setFilters] = useState<HomeFilters>(EMPTY_FILTERS);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [categoryMatches, setCategoryMatches] = useState<CategoryMatch[]>([]);

  useEffect(() => {
    // Girişte konum sorulmaz: kayıtlı konum varsa kullanılır, yoksa kişi üstteki "Konum seç"ten seçer.
    getSavedLocation().then(saved => { if (saved) applyLocation(saved); }).catch(() => {});
    loadSellers();
    fetchHomeCampaigns().then(setCampaignList).catch(() => {});
    fetchReferralPaused().then(setReferralPaused).catch(() => {});
  }, []);

  function applyLocation(loc: UserLocation) {
    setLocationName(`${loc.district}, ${loc.city}`);
    setLocationChosen(true);
    // Yeni seçimin koordinatı yoksa eskisi kalmaz: başlık bir yeri, liste başka bir yeri göstermesin.
    setUserLat(loc.latitude || null);
    setUserLon(loc.longitude || null);
  }

  async function loadSellers() {
    try {
      const { data, error } = await supabase
        .from('sellers')
        .select('*, seller_hours(*)')
        .eq('is_active', true)
        .order('rating_avg', { ascending: false });
      if (!error && data) setSellers(data as SellerRow[]);
    } catch {
      // Keep empty
    } finally {
      setLoading(false);
    }
  }

  const loadHistory = useCallback(async () => {
    if (!userId) {
      setHistory([]);
      return;
    }
    // Öneri bölümü ana sayfayı bekletmez ve hata vermez: geçmiş okunamazsa bölüm görünmez.
    setHistory(await fetchOrderHistory(userId).catch(() => []));
  }, [userId]);

  const loadActiveOrder = useCallback(async () => {
    setActiveOrder(userId ? await fetchActiveOrder(userId).catch(() => null) : null);
  }, [userId]);

  // Yeni verilen sipariş ana sayfaya dönünce hesaba katılsın.
  useFocusEffect(useCallback(() => { loadHistory(); loadActiveOrder(); }, [loadHistory, loadActiveOrder]));
  useFocusEffect(useCallback(() => { track('view_home'); }, []));

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadSellers(), loadHistory(), loadActiveOrder(), fetchHomeCampaigns().then(setCampaignList).catch(() => {})]);
    setRefreshing(false);
  }

  const userCoords = userLat != null && userLon != null ? { latitude: userLat, longitude: userLon } : null;

  // Teslimat alanı dışındaki satıcılar listelenmez; konum bilinmiyorsa hepsi görünür.
  const areaSellers = useMemo(
    () => sellers.filter(seller => isSellerListed(seller) && isInDeliveryArea(seller, userCoords)),
    [sellers, userLat, userLon],
  );

  // Restoran başına tek kampanya kartta görünür; liste yakında biteni öne alır.
  const campaigns = useMemo(() => {
    const map: Record<string, CouponRow> = {};
    for (const c of campaignList) if (c.seller_id && !map[c.seller_id]) map[c.seller_id] = c;
    return map;
  }, [campaignList]);

  const distanceOf = useCallback((seller: SellerRow): number | null => {
    if (userLat == null || userLon == null || seller.latitude == null || seller.longitude == null) return null;
    return haversineKm(userLat, userLon, seller.latitude, seller.longitude);
  }, [userLat, userLon]);

  const homeRows = useMemo(() => areaSellers.map(seller => {
    const row: HomeSeller & { seller: SellerRow } = {
      seller,
      id: seller.id,
      name: seller.display_name,
      cuisines: seller.cuisines ?? [],
      open: isOpen(seller),
      hasCampaign: !!campaigns[seller.id],
      ratingAvg: Number(seller.rating_avg) || 0,
      ratingCount: seller.rating_count,
      timeMax: seller.delivery_time_max ?? 40,
      minOrderCents: seller.min_order_cents ?? 0,
      deliveryFeeCents: seller.delivery_fee_cents ?? null,
      mealCards: (seller.meal_cards ?? []).length > 0,
      pickup: !!seller.pickup_enabled,
      km: distanceOf(seller),
    };
    return row;
  }), [areaSellers, campaigns, distanceOf]);

  // Yemek adıyla da aranır: "lahmacun" yazınca menüsünde olan restoranlar çıkar.
  const searchTerm = search.trim();
  useEffect(() => {
    if (searchTerm.length < 2) {
      setDishMatches({});
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchMenuItems(searchTerm)
        .then(items => {
          if (!active) return;
          const found: Record<string, string> = {};
          for (const item of items) if (!found[item.seller_id]) found[item.seller_id] = item.title;
          setDishMatches(found);
        })
        .catch(() => { if (active) setDishMatches({}); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchTerm]);

  const visible = useMemo(() => {
    const q = searchTerm.toLocaleLowerCase('tr');
    const list = homeRows.filter(({ seller }) => {
      if (sellerType !== 'all' && (seller.seller_type ?? 'home') !== sellerType) return false;
      if (q && !(
        seller.display_name.toLocaleLowerCase('tr').includes(q) ||
        (seller.bio ?? '').toLocaleLowerCase('tr').includes(q) ||
        (seller.district ?? '').toLocaleLowerCase('tr').includes(q) ||
        cuisineLabels(seller.cuisines).toLocaleLowerCase('tr').includes(q) ||
        dishMatches[seller.id]
      )) return false;
      return true;
    }).filter(row => matchesFilters(row, filters));
    return sortSellers(list, filters.sort);
  }, [homeRows, sellerType, searchTerm, dishMatches, filters]);

  const cuisineOptions = useMemo(() => cuisineCounts(homeRows), [homeRows]);
  // "Ne yesek?": en çok sipariş edilen önde, mevsim ve saate göre (lib/cuisine-order). Bölgede henüz
  // restoran yoksa fotoğraflı mutfaklar gösterilir; dokununca filtre uygulanır.
  const cuisineTiles = useMemo(
    () => sortByCuisineOrder(cuisineOptions.length > 0 ? cuisineOptions : PHOTO_CUISINES.map(id => ({ id, count: 0 }))),
    [cuisineOptions],
  );
  const railRows = useMemo(
    () => homeRows.map(row => ({ ...row, createdAt: row.seller.created_at ?? null })),
    [homeRows],
  );
  const stars = useMemo(() => neighbourhoodStars(railRows), [railRows]);
  const newcomers = useMemo(() => newlyOpened(railRows), [railRows]);
  const popularSellers = useMemo(() => sortSellers(homeRows, 'reviews').slice(0, 5), [homeRows]);

  // Bölgede geçerli olan kampanyalar: başka bölgedeki restoranın kampanyası gösterilmez.
  const campaignCards = useMemo(() => {
    const names = new Map(areaSellers.map(seller => [seller.id, seller.display_name]));
    return campaignList.filter(c => !c.seller_id || names.has(c.seller_id)).map(c => ({
      coupon: c,
      sellerName: c.seller_id ? names.get(c.seller_id) ?? null : null,
    }));
  }, [campaignList, areaSellers]);

  // Yakındaki açık mutfakların yemekleri vitrine çıkar.
  const dishSellerIds = useMemo(
    () => areaSellers.filter(isOpen).slice(0, DISH_SELLERS).map(seller => seller.id).join(','),
    [areaSellers],
  );

  useEffect(() => {
    if (!dishSellerIds) {
      setDishes([]);
      return;
    }
    let active = true;
    const chosen = dishSellerIds.split(',').map(id => areaSellers.find(seller => seller.id === id)).filter(Boolean) as SellerRow[];
    Promise.all(
      chosen.map(seller => fetchMenuItems(seller.id)
        .then(items => items.filter(item => item.is_available).slice(0, DISHES_PER_SELLER).map(item => ({
          id: item.id,
          sellerId: seller.id,
          sellerName: seller.display_name,
          title: item.title,
          priceCents: item.price_cents,
          imageUrl: item.image_url,
        })))
        .catch(() => [] as Dish[])),
    ).then(lists => {
      if (active) setDishes(lists.flat().slice(0, MAX_DISHES));
    });
    return () => { active = false; };
  }, [dishSellerIds]);

  // Hiç gidilmemiş restoranlar içinden, en çok seçilen kategoriyi menüsünde gerçekten bulunduranlar.
  const favouriteKey = useMemo(() => JSON.stringify(favouriteCategories(history).map(f => f.category)), [history]);
  const newSellerIds = useMemo(() => {
    const visited = new Set(history.map(order => order.sellerId));
    return areaSellers.filter(seller => !visited.has(seller.id)).map(seller => seller.id).join(',');
  }, [areaSellers, history]);

  useEffect(() => {
    const favourites: string[] = JSON.parse(favouriteKey);
    if (favourites.length === 0 || !newSellerIds) {
      setCategoryMatches([]);
      return;
    }
    let active = true;
    fetchCategoryMatches(newSellerIds.split(','), favourites)
      .catch(() => [] as CategoryMatch[])
      .then(matches => { if (active) setCategoryMatches(matches); });
    return () => { active = false; };
  }, [favouriteKey, newSellerIds]);

  const forYou = useMemo(() => {
    const byId = new Map(areaSellers.map(seller => [seller.id, seller]));
    return recommend({
      orders: history,
      sellers: areaSellers.map(seller => ({ id: seller.id, open: isOpen(seller) })),
      categoryMatches,
      limit: isDesktop ? FOR_YOU_DESKTOP : FOR_YOU_PHONE,
    }).map(rec => ({ ...rec, seller: byId.get(rec.sellerId)! }));
  }, [history, areaSellers, categoryMatches, isDesktop]);

  const filterCount = activeFilterCount(filters);
  const anyFilter = filterCount > 0 || sellerType !== 'all';
  const clearFilters = () => { setFilters({ ...EMPTY_FILTERS, sort: filters.sort }); setSellerType('all'); setSearch(''); };
  const patchFilters = (patch: Partial<HomeFilters>) => setFilters(f => ({ ...f, ...patch }));
  const toggleCuisineFilter = (id: string) => setFilters(f => ({
    ...f,
    cuisines: f.cuisines.includes(id) ? f.cuisines.filter(c => c !== id) : [...f.cuisines, id],
  }));
  const hasLocation = userLat != null && userLon != null;
  const favoriteProp = (id: string) => ({
    active: isFavorite(id),
    onToggle: () => { if (requireAuth()) toggleFavorite(id); },
  });
  const goSeller = (id: string) => router.push(`/(customer)/seller/${id}` as any);
  const goExplore = () => router.push('/(customer)/explore' as any);

  const mainWidth = isDesktop ? pageWidth - 32 - SIDEBAR_WIDTH - 24 : pageWidth - 32;
  const cardWidth = gridItemWidth(mainWidth, 3, 16, 0);
  const dishWidth = isDesktop ? gridItemWidth(mainWidth, 4, 10, 0) : gridItemWidth(pageWidth, 2, 10, 16);
  const searching = search.trim().length > 0;
  const listTitle = searching ? 'Arama sonuçları' : 'Tüm restoranlar';

  if (loading) {
    return (
      <View style={[s.safe, { backgroundColor: t.background }]}>
        <HomeScreenSkeleton />
      </View>
    );
  }

  const address = (
    <Pressable style={s.address} onPress={() => setPickingLocation(true)} accessibilityRole="button" accessibilityLabel={`Teslimat adresi: ${locationName}. Değiştir`}>
      <Ionicons name="location" size={18} color={isDesktop ? t.text : t.accent} />
      <Text style={[s.addressText, { color: isDesktop ? t.text : t.onBrand }]} numberOfLines={1}>{locationName}</Text>
      <Ionicons name="chevron-down" size={16} color={isDesktop ? t.textSecondary : t.onBrandSoft} />
    </Pressable>
  );

  const sectionHead = (title: string, onAll?: () => void) => (
    <View style={[s.sectionHead, !isDesktop && s.pad]}>
      <Text style={[s.sectionTitle, { color: t.heading }]}>{title}</Text>
      {onAll ? (
        <Pressable style={s.allLink} onPress={onAll} accessibilityRole="link" accessibilityLabel={`${title}: tümü`}>
          <Text style={[s.allText, { color: t.textSecondary }]}>Tümü</Text>
          <Ionicons name="arrow-forward" size={16} color={t.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );

  const searchField = (
    <SearchField
      value={search}
      onChangeText={setSearch}
      placeholder="Restoran, mutfak veya yemek ara"
      onFocus={() => {
        if (blurTimer.current) clearTimeout(blurTimer.current);
        setSearchFocused(true);
      }}
      // Öneriye dokunma önce odağı alır: pencere dokunuştan önce kapanmasın.
      onBlur={() => { blurTimer.current = setTimeout(() => setSearchFocused(false), 200); }}
    />
  );

  const showSuggestions = searchFocused && !searching && (cuisineOptions.length > 0 || popularSellers.length > 0);
  const suggestions = showSuggestions ? (
    <View style={[s.suggest, { backgroundColor: t.surface }, isDesktop ? s.suggestDesktop : s.suggestPhone]}>
      {cuisineOptions.length > 0 ? (
        <>
          <Text style={[s.suggestTitle, { color: t.textSecondary }]}>Mutfaklar</Text>
          <View style={s.suggestChips}>
            {cuisineOptions.slice(0, 8).map(c => (
              <Pressable
                key={c.id}
                style={[s.filterChip, { backgroundColor: t.background }]}
                onPress={() => { patchFilters({ cuisines: [c.id] }); setSearchFocused(false); }}
                accessibilityRole="button"
              >
                <Text style={[s.filterChipText, { color: t.text }]}>{cuisineLabel(c.id)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {popularSellers.length > 0 ? (
        <>
          <Text style={[s.suggestTitle, { color: t.textSecondary }]}>Popüler restoranlar</Text>
          {popularSellers.map(row => (
            <Pressable key={row.id} style={s.suggestRow} onPress={() => goSeller(row.id)} accessibilityRole="link">
              <Ionicons name="restaurant-outline" size={18} color={t.textSecondary} />
              <Text style={[s.suggestText, { color: t.text }]} numberOfLines={1}>{row.name}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  ) : null;

  const quickFilters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
      <Pressable
        style={[s.filterChip, s.filterChipIcon, { backgroundColor: filterCount > 0 ? t.brand : t.surface }]}
        onPress={() => setFilterSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={filterCount > 0 ? `Filtrele ve sırala, ${filterCount} filtre açık` : 'Filtrele ve sırala'}
      >
        <Ionicons name="options-outline" size={16} color={filterCount > 0 ? t.onBrand : t.text} />
        <Text style={[s.filterChipText, { color: filterCount > 0 ? t.onBrand : t.text }]}>
          {filterCount > 0 ? `Filtrele (${filterCount})` : 'Filtrele'}
        </Text>
      </Pressable>
      {QUICK_FILTERS.map(q => {
        const on = q.on(filters);
        return (
          <Pressable
            key={q.label}
            style={[s.filterChip, { backgroundColor: on ? t.brand : t.surface }]}
            onPress={() => patchFilters(q.flip(filters))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Text style={[s.filterChipText, { color: on ? t.onBrand : t.text }]}>{q.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const activeStrip = activeOrder ? (
    <Pressable
      style={[s.strip, { backgroundColor: t.accent }]}
      onPress={() => router.push(`/(customer)/order/${activeOrder.id}` as any)}
      accessibilityRole="link"
    >
      <Ionicons name="bicycle-outline" size={22} color={t.onAccent} />
      <View style={s.stripBody}>
        <Text style={[s.stripTitle, { color: t.onAccent }]} numberOfLines={1}>{ACTIVE_STATUS[activeOrder.status] ?? 'Siparişin sürüyor'}</Text>
        {activeOrder.sellerName ? <Text style={[s.stripSub, { color: t.onAccent }]} numberOfLines={1}>{activeOrder.sellerName}</Text> : null}
      </View>
      <Text style={[s.stripAction, { color: t.onAccent }]}>Takip et</Text>
      <Ionicons name="chevron-forward" size={18} color={t.onAccent} />
    </Pressable>
  ) : null;

  const noticeStrip = !locationChosen ? (
    <Pressable style={[s.strip, { backgroundColor: t.surface }]} onPress={() => setPickingLocation(true)} accessibilityRole="button">
      <Ionicons name="location-outline" size={22} color={t.text} />
      <View style={s.stripBody}>
        <Text style={[s.stripTitle, { color: t.text }]} numberOfLines={1}>Konumunu seç</Text>
        <Text style={[s.stripSub, { color: t.textSecondary }]} numberOfLines={2}>Sana teslimat yapan restoranları ve uzaklıklarını gösterelim.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
    </Pressable>
  ) : !userId ? (
    <Pressable style={[s.strip, { backgroundColor: t.surface }]} onPress={() => router.push('/(auth)/login' as any)} accessibilityRole="link">
      <Ionicons name="person-circle-outline" size={22} color={t.text} />
      <View style={s.stripBody}>
        <Text style={[s.stripTitle, { color: t.text }]} numberOfLines={1}>Giriş yap</Text>
        <Text style={[s.stripSub, { color: t.textSecondary }]} numberOfLines={2}>Sipariş vermek ve kuponlarını görmek için giriş yap.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
    </Pressable>
  ) : null;

  const campaignSection = campaignCards.length > 0 ? (
    <>
      {sectionHead(`Kampanyalar (${campaignCards.length})`, () => router.push('/(customer)/campaign' as any))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.forYouRow, isDesktop && s.rowDesktop]}>
        {campaignCards.map(({ coupon, sellerName }) => (
          <CampaignCard
            key={coupon.id}
            coupon={coupon}
            sellerName={sellerName}
            onPress={() => {
              if (coupon.seller_id) goSeller(coupon.seller_id);
              else router.push('/(customer)/campaign' as any);
            }}
          />
        ))}
      </ScrollView>
    </>
  ) : null;

  const cuisineSection = (
    <>
      {sectionHead('Ne yesek?')}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.cuisineRow, isDesktop && s.rowDesktop]}>
        {cuisineTiles.map(c => {
          const on = filters.cuisines.includes(c.id);
          const photo = CUISINE_IMAGES[c.id];
          return (
            <Pressable
              key={c.id}
              style={[s.cuisine, { backgroundColor: on ? t.brand : t.surface }]}
              onPress={() => toggleCuisineFilter(c.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c.count > 0 ? `${cuisineLabel(c.id)}, ${c.count} restoran` : cuisineLabel(c.id)}
            >
              {photo ? (
                <View style={[s.cuisinePhotoRing, { borderColor: on ? t.accent : 'transparent' }]}>
                  <Image source={photo} style={s.cuisinePhoto} resizeMode="cover" accessibilityIgnoresInvertColors />
                </View>
              ) : (
                <View style={[s.cuisineIcon, { backgroundColor: on ? t.accent : t.background }]}>
                  <Ionicons name={cuisineIcon(c.id)} size={24} color={on ? t.onAccent : t.text} />
                </View>
              )}
              <Text style={[s.cuisineLabel, { color: on ? t.onBrand : t.text }]} numberOfLines={2}>{cuisineLabel(c.id)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );


  const empty = (
    <View style={s.empty}>
      <Ionicons name={searching || anyFilter ? 'search-outline' : 'restaurant-outline'} size={44} color={t.textMuted} />
      <Text style={[s.emptyTitle, { color: t.heading }]}>{searching || anyFilter ? 'Bunu bulamadık' : 'Restoranlar yolda'}</Text>
      <Text style={[s.emptySub, { color: t.textSecondary }]}>
        {searching || anyFilter ? 'Filtreleri değiştirip tekrar dene.' : 'Sofra henüz boş. Bölgene teslimat yapan restoranlar eklendikçe burada görünecek.'}
      </Text>
      {searching || anyFilter ? (
        <Pressable style={[s.emptyBtn, { backgroundColor: t.primary }]} onPress={clearFilters} accessibilityRole="button">
          <Text style={[s.emptyBtnText, { color: t.onBrand }]}>Filtreleri temizle</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const quickLinks = (
    <View style={[s.quick, { backgroundColor: t.surface }, isDesktop && s.quickDesktop]}>
      <Pressable style={[s.quickRow, !isDesktop && { borderBottomColor: t.divider, borderBottomWidth: 1 }, isDesktop && s.quickRowDesktop]} onPress={() => { if (requireAuth()) router.push('/(customer)/orders' as any); }} accessibilityRole="button">
        <Ionicons name="repeat" size={20} color={t.text} />
        <Text style={[s.quickText, { color: t.text }]}>Son siparişimi tekrarla</Text>
      </Pressable>
      <Pressable style={[s.quickRow, isDesktop && s.quickRowDesktop]} onPress={() => { if (requireAuth()) router.push('/(customer)/loyalty' as any); }} accessibilityRole="button">
        <Ionicons name="pricetag-outline" size={20} color={t.text} />
        <Text style={[s.quickText, { color: t.text }]}>Kuponlarım</Text>
      </Pressable>
    </View>
  );

  const dishSection = dishes.length > 0 ? (
    <>
      {sectionHead('Yakınındaki lezzetler', goExplore)}
      <View style={[s.dishGrid, !isDesktop && s.pad]}>
        {dishes.map(dish => (
          <Pressable
            key={dish.id}
            style={[s.dish, { width: dishWidth, backgroundColor: t.surface }]}
            onPress={() => goSeller(dish.sellerId)}
            accessibilityRole="button"
            accessibilityLabel={`${dish.title}, ${dish.sellerName}, ${lira(dish.priceCents)}`}
          >
            <FoodImage imageUrl={dish.imageUrl} size={dishWidth - 20} height={dishWidth - 44} borderRadius={12} />
            <Text style={[s.dishTitle, { color: t.text }]} numberOfLines={1}>{dish.title}</Text>
            <View style={s.dishMeta}>
              <Text style={[s.dishSeller, { color: t.textSecondary }]} numberOfLines={1}>{dish.sellerName}</Text>
              <Text style={[s.dishPrice, { color: t.text }]}>{lira(dish.priceCents)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  ) : null;

  const restaurantCta = (
    <Pressable
      style={[s.cta, { backgroundColor: t.surface }, !isDesktop && s.ctaPhone]}
      onPress={() => { if (requireAuth()) router.push('/(customer)/seller-apply' as any); }}
      accessibilityRole="link"
    >
      <Ionicons name="storefront-outline" size={22} color={t.text} />
      <View style={s.stripBody}>
        <Text style={[s.stripTitle, { color: t.text }]}>Restoranın mı var?</Text>
        <Text style={[s.stripSub, { color: t.textSecondary }]}>Afiyetli'ye ekle, mahallendeki müşterilere ulaş.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
    </Pressable>
  );

  const filterModal = (
    <Modal visible={filterSheet} animationType="slide" transparent onRequestClose={() => setFilterSheet(false)}>
      <View style={s.sheetBackdrop}>
        <View style={[s.sheet, { backgroundColor: t.surface }]}>
          <View style={[s.sheetHead, { borderBottomColor: t.divider }]}>
            <Text style={[s.sideTitle, s.sheetTitle, { color: t.heading }]}>Filtrele ve sırala</Text>
            <Pressable style={s.sheetClose} onPress={() => setFilterSheet(false)} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={24} color={t.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
            <HomeFilterPanel filters={filters} onChange={setFilters} cuisineOptions={cuisineOptions} hasLocation={hasLocation} />
          </ScrollView>
          <View style={[s.sheetFoot, { borderTopColor: t.divider }]}>
            <Pressable style={[s.emptyBtn, s.sheetBtn, { backgroundColor: t.primary }]} onPress={() => setFilterSheet(false)} accessibilityRole="button">
              <Text style={[s.emptyBtnText, { color: t.onBrand }]}>{visible.length} restoranı göster</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const forYouSection = forYou.length > 0 ? (
    <>
      {sectionHead('Sana özel')}
      {isDesktop ? (
        <View style={s.grid}>
          {forYou.map(({ seller, reason }) => (
            <RestaurantCard key={seller.id} data={toCard(seller, distanceOf(seller))} campaign={campaigns[seller.id]} width={cardWidth} note={reason} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.forYouRow}>
          {forYou.map(({ seller, reason }) => (
            <RestaurantCard key={seller.id} data={toCard(seller, distanceOf(seller))} campaign={campaigns[seller.id]} width={FOR_YOU_CARD_WIDTH} note={reason} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
          ))}
        </ScrollView>
      )}
    </>
  ) : null;

  /** Restoran vitrini: telefonda yana kayar, masaüstünde ızgara. */
  const sellerRail = (title: string, rows: { seller: SellerRow; note?: string }[]) => (rows.length === 0 ? null : (
    <>
      {sectionHead(title)}
      {isDesktop ? (
        <View style={s.grid}>
          {rows.map(({ seller, note }) => (
            <RestaurantCard key={seller.id} data={toCard(seller, distanceOf(seller))} campaign={campaigns[seller.id]} width={cardWidth} note={note} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.forYouRow}>
          {rows.map(({ seller, note }) => (
            <RestaurantCard key={seller.id} data={toCard(seller, distanceOf(seller))} campaign={campaigns[seller.id]} width={FOR_YOU_CARD_WIDTH} note={note} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
          ))}
        </ScrollView>
      )}
    </>
  ));
  // Semtin yıldızları: puanı yüksek ve yeterince puanlanmış restoranlar (Trendyol Go "Semtin Yıldızı" gibi).
  const starsSection = stars.length >= 2 ? sellerRail('Semtin yıldızları', stars.map(r => ({ seller: r.seller }))) : null;
  // Yeni açılanlar: son 30 günde katılan restoranlar ilk haftalarında görünür olsun.
  const newcomersSection = sellerRail('Yeni açılanlar', newcomers.map(r => ({ seller: r.seller })));

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />;
  const locationModal = (
    <Modal visible={pickingLocation} animationType="slide" onRequestClose={() => setPickingLocation(false)}>
      {/* Her açılışta temiz başlar: eski arama ve dönen düğme kalmaz. */}
      {pickingLocation ? <LocationPicker onDone={(loc) => { applyLocation(loc); setPickingLocation(false); }} onClose={() => setPickingLocation(false)} /> : null}
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={[s.safe, { backgroundColor: t.background }]}>
        {locationModal}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollDesktop} keyboardShouldPersistTaps="handled" refreshControl={refresh}>
          <View style={s.desktopTop}>
            <View style={s.desktopAddress}>{address}</View>
            <View style={s.desktopSearch}>
              {searchField}
              {suggestions}
            </View>
          </View>
          {activeStrip ? <View style={s.stripDesktop}>{activeStrip}</View> : null}
          {noticeStrip ? <View style={s.stripDesktop}>{noticeStrip}</View> : null}

          <View style={s.columns}>
            <View style={[s.sidebar, { backgroundColor: t.surface }]}>
              <Text style={[s.sideTitle, { color: t.heading }]}>Filtrele ve sırala</Text>
              <HomeFilterPanel filters={filters} onChange={setFilters} cuisineOptions={cuisineOptions} hasLocation={hasLocation} />
            </View>

            <View style={s.main}>
              {referralPaused || searching ? null : <Pressable
                style={[s.promo, { backgroundColor: t.brand }]}
                onPress={() => { if (requireAuth()) router.push('/(customer)/loyalty' as any); }}
                accessibilityRole="button"
                accessibilityLabel="Davet koduyla 15 lira indirim"
              >
                <View style={s.promoBody}>
                  <Text style={[s.promoTitle, { color: t.accent }]}>₺15 indirim</Text>
                  <Text style={[s.promoSub, { color: t.onBrand }]}>Davet koduyla, ₺50 ve üzeri siparişte</Text>
                </View>
                <Image source={CATEGORY_IMAGES.izgara} style={s.promoImage} resizeMode="cover" />
              </Pressable>}

              {searching ? null : quickLinks}
              {searching ? null : campaignSection}

              {HOME_SELLERS_ENABLED ? (
                <View style={s.typeRow}>
                  {TYPES.map(type => {
                    const on = sellerType === type.key;
                    return (
                      <Pressable
                        key={type.key}
                        style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
                        onPress={() => setSellerType(type.key)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{type.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {searching ? null : cuisineSection}

              {searching ? null : forYouSection}
              {searching ? null : starsSection}
              {searching ? null : newcomersSection}
              {searching ? null : dishSection}

              <View style={s.listHead}>
                <Text style={[s.sectionTitle, { color: t.heading }]}>{listTitle}</Text>
                <Text style={[s.count, { color: t.textMuted }]}>{visible.length} sonuç</Text>
              </View>
              {visible.length === 0 ? empty : (
                <View style={s.grid}>
                  {visible.map(({ seller, km }) => (
                    <RestaurantCard key={seller.id} data={toCard(seller, km)} campaign={campaigns[seller.id]} width={cardWidth} note={dishMatches[seller.id] ? `Menüde: ${dishMatches[seller.id]}` : undefined} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
                  ))}
                </View>
              )}
              <View style={s.ctaDesktop}>{restaurantCta}</View>
            </View>
          </View>
          <SiteFooter />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      {locationModal}
      {filterModal}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarSpace }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refresh}
      >
        <TopBar leading={<Logo size={26} tone="onBrand" inline />} right={<CartButton />}>
          {address}
          <View style={s.searchRow}>
            <View style={s.searchFlex}>{searchField}</View>
            <Pressable
              style={[s.filterBtn, { backgroundColor: t.panel }]}
              onPress={() => setFilterSheet(true)}
              accessibilityRole="button"
              accessibilityLabel={filterCount > 0 ? `Filtrele ve sırala, ${filterCount} filtre açık` : 'Filtrele ve sırala'}
            >
              <Ionicons name="options-outline" size={22} color={t.onBrand} />
              {filterCount > 0 ? (
                <View style={[s.filterBadge, { backgroundColor: t.accent }]}>
                  <Text style={[s.filterBadgeText, { color: t.onAccent }]}>{filterCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </TopBar>
        {suggestions}
        {activeStrip ? <View style={s.stripPhone}>{activeStrip}</View> : null}
        {noticeStrip ? <View style={s.stripPhone}>{noticeStrip}</View> : null}

        {searching ? null : (
          <>
            {quickLinks}

            {campaignSection}

            {cuisineSection}

            {forYouSection}

            {starsSection}

            {newcomersSection}

            {dishSection}
          </>
        )}

        <View style={[s.listHead, s.pad]}>
          <Text style={[s.sectionTitle, { color: t.heading }]}>{listTitle}</Text>
          <Text style={[s.count, { color: t.textMuted }]}>{visible.length} sonuç</Text>
        </View>
        {quickFilters}
        {visible.length === 0 ? empty : (
          <View style={s.list}>
            {visible.map(({ seller, km }) => (
              <RestaurantCard key={seller.id} data={toCard(seller, km)} campaign={campaigns[seller.id]} note={dishMatches[seller.id] ? `Menüde: ${dishMatches[seller.id]}` : undefined} favorite={favoriteProp(seller.id)} onPress={() => goSeller(seller.id)} />
            ))}
          </View>
        )}
        {restaurantCta}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 248;

const s = StyleSheet.create({
  safe: { flex: 1 },
  scrollDesktop: { paddingBottom: 32, paddingHorizontal: 16 },
  pad: { paddingHorizontal: 16 },

  address: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  addressText: { flexShrink: 1, fontSize: 14, fontFamily: fonts.semibold },

  quick: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingHorizontal: 14 },
  quickDesktop: { marginHorizontal: 0, marginTop: 0, flexDirection: 'row', gap: 16, marginBottom: 2 },
  quickRowDesktop: { flex: 1 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  quickText: { fontSize: 14, fontFamily: fonts.semibold },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, minHeight: 44 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  allText: { fontSize: 13, fontFamily: fonts.semibold },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  count: { fontSize: 12, fontFamily: fonts.medium },

  catRow: { paddingHorizontal: 16, gap: 8 },
  forYouRow: { paddingHorizontal: 16, gap: 12 },
  rowDesktop: { paddingHorizontal: 0 },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 6, paddingRight: 14, borderRadius: 14 },
  catImage: { width: 36, height: 36, borderRadius: 18 },
  catLabel: { fontSize: 13, fontFamily: fonts.semibold },

  dishGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dish: { borderRadius: 16, padding: 10 },
  dishTitle: { fontSize: 14, lineHeight: 18, fontFamily: fonts.bold, marginTop: 8 },
  dishMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 },
  dishSeller: { flexShrink: 1, fontSize: 12, fontFamily: fonts.regular },
  dishPrice: { fontSize: 14, fontFamily: fonts.extrabold },

  list: { paddingHorizontal: 16, gap: 12 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchFlex: { flex: 1, minWidth: 0 },
  filterBtn: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  filterBadge: { position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 11, fontFamily: fonts.extrabold },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  filterChip: { height: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filterChipIcon: { flexDirection: 'row', gap: 6 },
  filterChipText: { fontSize: 13, fontFamily: fonts.semibold },

  strip: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  stripBody: { flex: 1, minWidth: 0 },
  stripTitle: { fontSize: 14, fontFamily: fonts.bold },
  stripSub: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular },
  stripAction: { fontSize: 13, fontFamily: fonts.bold },
  stripPhone: { marginHorizontal: 16, marginTop: 12 },
  stripDesktop: { marginTop: 12 },

  suggest: { borderRadius: 16, padding: 14, gap: 8 },
  suggestPhone: { marginHorizontal: 16, marginTop: 12 },
  suggestDesktop: { position: 'absolute', top: 54, left: 0, right: 0, zIndex: 30, shadowColor: '#151A16', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  suggestTitle: { fontSize: 12, fontFamily: fonts.bold, marginTop: 2 },
  suggestChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  suggestText: { flexShrink: 1, fontSize: 14, fontFamily: fonts.medium },

  cuisineRow: { paddingHorizontal: 16, gap: 10 },
  cuisine: { width: 92, minHeight: 104, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', gap: 8 },
  cuisineIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  cuisinePhotoRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  cuisinePhoto: { width: 56, height: 56, borderRadius: 28 },
  cuisineLabel: { fontSize: 12, lineHeight: 15, fontFamily: fonts.semibold, textAlign: 'center' },

  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  ctaPhone: { marginHorizontal: 16, marginTop: 16 },
  ctaDesktop: { marginTop: 20 },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,26,22,0.5)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: 1 },
  sheetTitle: { marginBottom: 0 },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { padding: 16 },
  sheetFoot: { padding: 12, borderTopWidth: 1 },
  sheetBtn: { marginTop: 0, alignItems: 'center' },

  desktopTop: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16, zIndex: 20 },
  desktopAddress: { flexShrink: 1 },
  desktopSearch: { flex: 1, minWidth: 0, zIndex: 20 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24, marginTop: 16 },
  // Filtreler ekrandan uzun: sütun kendi içinde kayar, yapışık kalır.
  sidebar: { width: SIDEBAR_WIDTH, borderRadius: 16, padding: 16, position: 'sticky' as any, top: 12, maxHeight: 'calc(100vh - 104px)' as any, overflow: 'auto' as any },
  sideTitle: { fontSize: 18, fontFamily: fonts.display, marginBottom: 12 },
  main: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },

  promo: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 22 },
  promoBody: { flex: 1, minWidth: 0 },
  promoTitle: { fontSize: 36, lineHeight: 42, fontFamily: fonts.display, letterSpacing: -0.6 },
  promoSub: { fontSize: 15, lineHeight: 20, fontFamily: fonts.semibold, marginTop: 2 },
  promoImage: { width: 104, height: 104, borderRadius: 52 },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  empty: { alignItems: 'center', paddingTop: 32, paddingBottom: 20, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyBtn: { marginTop: 12, paddingHorizontal: 20, height: 46, justifyContent: 'center', borderRadius: 12 },
  emptyBtnText: { fontFamily: fonts.bold, fontSize: 14 },
});
