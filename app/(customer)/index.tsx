import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

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
import { CartButton, SearchField, TopBar } from '@/components/shared/TopBar';
import { useTheme } from '@/lib/theme-context';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { haversineKm, isInDeliveryArea } from '@/lib/geo';
import { fetchCategoryMatches, fetchMenuItems, fetchOrderHistory, fetchSellerCampaignMap, type CouponRow, type SellerHourRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { gridItemWidth, useResponsive } from '@/lib/responsive';
import { track } from '@/lib/analytics';
import { categoryLabel, type MenuCategoryKey } from '@/lib/menu-categories';
import { CATEGORY_IMAGES, sellerPhoto } from '@/lib/food-images';
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
};

type Dish = {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  priceCents: number;
  imageUrl: string | null;
};

type SortKey = 'recommended' | 'rating' | 'speed';
type SellerType = 'all' | 'home' | 'restaurant';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Önerilen' },
  { key: 'rating', label: 'En yüksek puan' },
  { key: 'speed', label: 'Teslimat süresi' },
];

const TYPES: { key: SellerType; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'home', label: 'Ev Yemeği' },
  { key: 'restaurant', label: 'Restoran' },
];

// ─── Categories ───────────────────────────────────────────────────────────────

/** Dokununca o kategorideki yemekler açılır (food-category ekranı). */
const CATEGORIES: { cat: MenuCategoryKey; image: number }[] = [
  { cat: 'ana', image: CATEGORY_IMAGES.ev },
  { cat: 'borek', image: CATEGORY_IMAGES.borek },
  { cat: 'izgara', image: CATEGORY_IMAGES.izgara },
  { cat: 'tatli', image: CATEGORY_IMAGES.tatli },
  { cat: 'kahvalti', image: CATEGORY_IMAGES.kahvalti },
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

function toCard(seller: SellerRow): RestaurantCardData {
  return {
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
  const [search, setSearch] = useState('');
  const [sellerType, setSellerType] = useState<SellerType>('all');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('Konum seç');
  const [pickingLocation, setPickingLocation] = useState(false);
  const [campaigns, setCampaigns] = useState<Record<string, CouponRow>>({});
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyCampaign, setOnlyCampaign] = useState(false);
  const [onlyFree, setOnlyFree] = useState(false);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [categoryMatches, setCategoryMatches] = useState<CategoryMatch[]>([]);

  useEffect(() => {
    requestLocation();
    loadSellers();
    fetchSellerCampaignMap().then(setCampaigns).catch(() => {});
  }, []);

  function applyLocation(loc: UserLocation) {
    setLocationName(`${loc.district}, ${loc.city}`);
    if (loc.latitude && loc.longitude) {
      setUserLat(loc.latitude);
      setUserLon(loc.longitude);
    }
  }

  async function requestLocation() {
    const saved = await getSavedLocation();
    if (saved) {
      applyLocation(saved);
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Promise.race<Location.LocationObject>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      setUserLat(loc.coords.latitude);
      setUserLon(loc.coords.longitude);
      const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (addr) {
        const parts = [addr.subregion ?? addr.district, addr.city].filter(Boolean);
        if (parts.length > 0) setLocationName(parts.join(', '));
      }
    } catch {}
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

  // Yeni verilen sipariş ana sayfaya dönünce hesaba katılsın.
  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));
  useFocusEffect(useCallback(() => { track('view_home'); }, []));

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadSellers(), loadHistory(), fetchSellerCampaignMap().then(setCampaigns).catch(() => {})]);
    setRefreshing(false);
  }

  const userCoords = userLat != null && userLon != null ? { latitude: userLat, longitude: userLon } : null;

  // Teslimat alanı dışındaki satıcılar listelenmez; konum bilinmiyorsa hepsi görünür.
  const areaSellers = useMemo(
    () => sellers.filter(seller => isSellerListed(seller) && isInDeliveryArea(seller, userCoords)),
    [sellers, userLat, userLon],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    const list = areaSellers.filter(seller => {
      if (sellerType !== 'all' && (seller.seller_type ?? 'home') !== sellerType) return false;
      if (q && !(
        seller.display_name.toLocaleLowerCase('tr').includes(q) ||
        (seller.bio ?? '').toLocaleLowerCase('tr').includes(q) ||
        (seller.district ?? '').toLocaleLowerCase('tr').includes(q)
      )) return false;
      if (onlyOpen && !isOpen(seller)) return false;
      if (onlyCampaign && !campaigns[seller.id]) return false;
      if (onlyFree && seller.delivery_fee_cents !== 0) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortKey === 'rating') return Number(b.rating_avg) - Number(a.rating_avg);
      if (sortKey === 'speed') return (a.delivery_time_max ?? 40) - (b.delivery_time_max ?? 40);
      if (userLat == null || userLon == null) return 0;
      const da = a.latitude != null ? haversineKm(userLat, userLon, a.latitude, a.longitude!) : 9999;
      const db = b.latitude != null ? haversineKm(userLat, userLon, b.latitude, b.longitude!) : 9999;
      return da - db;
    });
  }, [areaSellers, sellerType, search, onlyOpen, onlyCampaign, onlyFree, sortKey, campaigns, userLat, userLon]);

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

  const anyFilter = onlyOpen || onlyCampaign || onlyFree || sellerType !== 'all';
  const clearFilters = () => { setOnlyOpen(false); setOnlyCampaign(false); setOnlyFree(false); setSellerType('all'); setSearch(''); };
  const goSeller = (id: string) => router.push(`/(customer)/seller/${id}` as any);
  const goExplore = () => router.push('/(customer)/explore' as any);
  const goCategory = (cat?: string) => router.push({ pathname: '/(customer)/food-category', params: cat ? { cat } : {} } as any);

  const mainWidth = isDesktop ? pageWidth - 32 - SIDEBAR_WIDTH - 24 : pageWidth - 32;
  const cardWidth = gridItemWidth(mainWidth, 3, 16, 0);
  const dishWidth = gridItemWidth(pageWidth, 2, 10, 16);
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

  const searchField = (
    <SearchField value={search} onChangeText={setSearch} placeholder="Bugün ne yesek?" />
  );

  const categories = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.catRow, isDesktop && s.rowDesktop]}>
      {CATEGORIES.map(item => (
        <Pressable
          key={item.cat}
          style={[s.catPill, { backgroundColor: t.surface }]}
          onPress={() => goCategory(item.cat)}
          accessibilityRole="button"
          accessibilityLabel={categoryLabel(item.cat)}
        >
          <Image source={item.image} style={s.catImage} resizeMode="cover" />
          <Text style={[s.catLabel, { color: t.text }]} numberOfLines={1}>{categoryLabel(item.cat)}</Text>
        </Pressable>
      ))}
    </ScrollView>
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

  const forYouSection = forYou.length > 0 ? (
    <>
      {sectionHead('Sana özel')}
      {isDesktop ? (
        <View style={s.grid}>
          {forYou.map(({ seller, reason }) => (
            <RestaurantCard key={seller.id} data={toCard(seller)} campaign={campaigns[seller.id]} width={cardWidth} note={reason} onPress={() => goSeller(seller.id)} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.forYouRow}>
          {forYou.map(({ seller, reason }) => (
            <RestaurantCard key={seller.id} data={toCard(seller)} campaign={campaigns[seller.id]} width={FOR_YOU_CARD_WIDTH} note={reason} onPress={() => goSeller(seller.id)} />
          ))}
        </ScrollView>
      )}
    </>
  ) : null;

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />;
  const locationModal = (
    <Modal visible={pickingLocation} animationType="slide" onRequestClose={() => setPickingLocation(false)}>
      <LocationPicker onDone={(loc) => { applyLocation(loc); setPickingLocation(false); }} />
    </Modal>
  );

  if (isDesktop) {
    return (
      <View style={[s.safe, { backgroundColor: t.background }]}>
        {locationModal}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollDesktop} keyboardShouldPersistTaps="handled" refreshControl={refresh}>
          <View style={s.desktopTop}>
            <View style={s.desktopAddress}>{address}</View>
            <View style={s.desktopSearch}>{searchField}</View>
          </View>

          <View style={s.columns}>
            <View style={[s.sidebar, { backgroundColor: t.surface }]}>
              <Text style={[s.sideTitle, { color: t.heading }]}>Filtrele</Text>
              <Text style={[s.sideLabel, { color: t.text }]}>Sıralama</Text>
              {SORTS.map(opt => {
                const on = sortKey === opt.key;
                return (
                  <Pressable key={opt.key} style={s.sideRow} onPress={() => setSortKey(opt.key)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <View style={[s.radio, { borderColor: on ? t.primary : t.surfaceBorder }]}>
                      {on ? <View style={[s.radioDot, { backgroundColor: t.primary }]} /> : null}
                    </View>
                    <Text style={[s.sideText, { color: t.text }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
              <View style={[s.sideDivider, { backgroundColor: t.divider }]} />
              <Text style={[s.sideLabel, { color: t.text }]}>Filtreler</Text>
              {([['Şimdi açık', onlyOpen, setOnlyOpen], ['Kampanyalı', onlyCampaign, setOnlyCampaign], ['Ücretsiz teslimat', onlyFree, setOnlyFree]] as const).map(([label, value, set]) => (
                <Pressable key={label} style={s.sideRow} onPress={() => set(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
                  <View style={[s.check, { borderColor: value ? t.primary : t.surfaceBorder, backgroundColor: value ? t.primary : 'transparent' }]}>
                    {value ? <Ionicons name="checkmark" size={14} color={t.onBrand} /> : null}
                  </View>
                  <Text style={[s.sideText, { color: t.text }]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.main}>
              <Pressable
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
              </Pressable>

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

              {sectionHead('Kategoriler', () => goCategory())}
              {categories}

              {searching ? null : forYouSection}

              <View style={s.listHead}>
                <Text style={[s.sectionTitle, { color: t.heading }]}>{listTitle}</Text>
                <Text style={[s.count, { color: t.textMuted }]}>{visible.length} sonuç</Text>
              </View>
              {visible.length === 0 ? empty : (
                <View style={s.grid}>
                  {visible.map(seller => (
                    <RestaurantCard key={seller.id} data={toCard(seller)} campaign={campaigns[seller.id]} width={cardWidth} onPress={() => goSeller(seller.id)} />
                  ))}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      {locationModal}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarSpace }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refresh}
      >
        <TopBar leading={<Logo size={26} tone="onBrand" inline />} right={<CartButton />}>
          {address}
          {searchField}
        </TopBar>

        {searching ? null : (
          <>
            <View style={[s.quick, { backgroundColor: t.surface }]}>
              <Pressable style={[s.quickRow, { borderBottomColor: t.divider, borderBottomWidth: 1 }]} onPress={() => { if (requireAuth()) router.push('/(customer)/orders' as any); }} accessibilityRole="button">
                <Ionicons name="repeat" size={20} color={t.text} />
                <Text style={[s.quickText, { color: t.text }]}>Son siparişimi tekrarla</Text>
              </Pressable>
              <Pressable style={s.quickRow} onPress={() => { if (requireAuth()) router.push('/(customer)/loyalty' as any); }} accessibilityRole="button">
                <Ionicons name="pricetag-outline" size={20} color={t.text} />
                <Text style={[s.quickText, { color: t.text }]}>Kuponlarım</Text>
              </Pressable>
            </View>

            {sectionHead('Kategoriler', () => goCategory())}
            {categories}

            {forYouSection}

            {dishes.length > 0 ? (
              <>
                {sectionHead('Yakınındaki lezzetler', goExplore)}
                <View style={[s.dishGrid, s.pad]}>
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
            ) : null}
          </>
        )}

        <View style={[s.listHead, s.pad]}>
          <Text style={[s.sectionTitle, { color: t.heading }]}>{listTitle}</Text>
          <Text style={[s.count, { color: t.textMuted }]}>{visible.length} sonuç</Text>
        </View>
        {visible.length === 0 ? empty : (
          <View style={s.list}>
            {visible.map(seller => (
              <RestaurantCard key={seller.id} data={toCard(seller)} campaign={campaigns[seller.id]} onPress={() => goSeller(seller.id)} />
            ))}
          </View>
        )}
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

  desktopTop: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  desktopAddress: { flexShrink: 1 },
  desktopSearch: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24, marginTop: 16 },
  sidebar: { width: SIDEBAR_WIDTH, borderRadius: 16, padding: 16, position: 'sticky' as any, top: 12 },
  sideTitle: { fontSize: 18, fontFamily: fonts.display, marginBottom: 12 },
  sideLabel: { fontSize: 14, fontFamily: fonts.bold, marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  sideText: { fontSize: 14, fontFamily: fonts.regular },
  sideDivider: { height: 1, marginVertical: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
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
