import { useEffect, useMemo, useState } from 'react';
import {
  Image,
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { LocationPicker, getSavedLocation, type UserLocation } from '@/components/shared/LocationPicker';
import { HomeScreenSkeleton } from '@/components/shared/Skeleton';
import { campaignLabel, RestaurantCard, type RestaurantCardData } from '@/components/shared/RestaurantCard';
import { useTheme } from '@/lib/theme-context';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { haversineKm, isInDeliveryArea } from '@/lib/geo';
import { fetchSellerCampaignMap, type CouponRow, type SellerHourRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { gridItemWidth, useResponsive } from '@/lib/responsive';
import { CATEGORY_IMAGES, sellerPhoto } from '@/lib/food-images';

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

type SortKey = 'recommended' | 'rating' | 'speed';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Önerilen' },
  { key: 'rating', label: 'En yüksek puan' },
  { key: 'speed', label: 'Teslimat süresi' },
];

// ─── Categories ───────────────────────────────────────────────────────────────

/** Dokununca o kategorideki yemekler açılır (food-category ekranı). */
const CATEGORIES = [
  { id: 'ev', label: 'Ev Yemeği', cat: 'Ana Yemekler', image: CATEGORY_IMAGES.ev },
  { id: 'borek', label: 'Börek', cat: 'Börekler', image: CATEGORY_IMAGES.borek },
  { id: 'izgara', label: 'Izgara', cat: 'Izgaralar', image: CATEGORY_IMAGES.izgara },
  { id: 'tatli', label: 'Tatlı', cat: 'Tatlılar', image: CATEGORY_IMAGES.tatli },
  { id: 'kahvalti', label: 'Kahvaltı', cat: 'Kahvaltılar', image: CATEGORY_IMAGES.kahvalti },
];

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CustomerHomeScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const { requireAuth } = useRequireAuth();
  const { isDesktop, pageWidth } = useResponsive();
  const [search, setSearch] = useState('');
  const [sellerTab, setSellerTab] = useState<'home' | 'restaurant'>('home');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
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

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadSellers(), fetchSellerCampaignMap().then(setCampaigns).catch(() => {})]);
    setRefreshing(false);
  }

  const userCoords = userLat != null && userLon != null ? { latitude: userLat, longitude: userLon } : null;

  // Teslimat alanı dışındaki satıcılar listelenmez; konum bilinmiyorsa hepsi görünür.
  const tabSellers = useMemo(
    () => sellers.filter(seller => (seller.seller_type ?? 'home') === sellerTab && isInDeliveryArea(seller, userCoords)),
    [sellers, sellerTab, userLat, userLon],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    const list = tabSellers.filter(seller => {
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
  }, [tabSellers, search, onlyOpen, onlyCampaign, onlyFree, sortKey, campaigns, userLat, userLon]);

  const withCampaign = tabSellers.filter(seller => campaigns[seller.id]);
  const anyFilter = onlyOpen || onlyCampaign || onlyFree;
  const clearFilters = () => { setOnlyOpen(false); setOnlyCampaign(false); setOnlyFree(false); setSearch(''); };
  const goSeller = (id: string) => router.push(`/(customer)/seller/${id}` as any);
  const nextSort = () => {
    const i = SORTS.findIndex(x => x.key === sortKey);
    setSortKey(SORTS[(i + 1) % SORTS.length].key);
  };

  const mainWidth = isDesktop ? pageWidth - 32 - SIDEBAR_WIDTH - 32 : pageWidth - 32;
  const cardWidth = gridItemWidth(mainWidth, 3, 20, 0);
  const sortLabel = SORTS.find(x => x.key === sortKey)?.label ?? '';
  const listTitle = search.trim() ? 'Arama sonuçları' : sellerTab === 'home' ? 'Tüm mutfaklar' : 'Tüm restoranlar';

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: t.surface }]} edges={['top']}>
        <HomeScreenSkeleton />
      </SafeAreaView>
    );
  }

  const header = (
    <View style={[s.header, isDesktop && s.headerDesktop, { borderBottomColor: t.divider }]}>
      <View style={s.topRow}>
        <Pressable style={s.address} onPress={() => setPickingLocation(true)} accessibilityRole="button" accessibilityLabel={`Teslimat adresi: ${locationName}. Değiştir`}>
          <Ionicons name="location-outline" size={20} color={t.primary} />
          <Text style={[s.addressText, { color: t.text }]} numberOfLines={1}>{locationName}</Text>
          <Ionicons name="chevron-down" size={16} color={t.textSecondary} />
        </Pressable>
        <Pressable style={[s.iconBtn, { backgroundColor: t.chip }]} onPress={() => router.push('/(customer)/notifications' as any)} accessibilityRole="button" accessibilityLabel="Bildirimler">
          <Ionicons name="notifications-outline" size={20} color={t.text} />
        </Pressable>
      </View>

      <View style={[s.searchBar, { backgroundColor: t.chip }]}>
        <Ionicons name="search" size={18} color={t.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: t.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder={sellerTab === 'home' ? 'Mutfak veya semt ara' : 'Restoran veya semt ara'}
          placeholderTextColor={t.textMuted}
          returnKeyType="search"
          accessibilityLabel="Ara"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
            <Ionicons name="close-circle" size={20} color={t.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.tabs}>
        {([['home', 'Ev Yemeği', 'restaurant-outline'], ['restaurant', 'Restoran', 'storefront-outline']] as const).map(([key, label, icon]) => {
          const on = sellerTab === key;
          return (
            <Pressable
              key={key}
              style={[s.tab, on && { borderBottomColor: t.brand }]}
              onPress={() => setSellerTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={icon} size={18} color={on ? t.heading : t.textSecondary} />
              <Text style={[s.tabText, { color: on ? t.heading : t.textSecondary }, on && s.tabTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const promo = (
    <Pressable
      style={[s.promo, { backgroundColor: t.brand }]}
      onPress={() => { if (requireAuth()) router.push('/(customer)/loyalty' as any); }}
      accessibilityRole="button"
      accessibilityLabel="Davet koduyla 15 lira indirim"
    >
      <View style={s.promoBody}>
        <Text style={[s.promoTitle, isDesktop && s.promoTitleDesktop]}>₺15 indirim</Text>
        <Text style={s.promoSub}>Davet koduyla, ₺50 ve üzeri siparişte</Text>
      </View>
      <Image source={CATEGORY_IMAGES.izgara} style={[s.promoImage, isDesktop && s.promoImageDesktop]} resizeMode="cover" />
    </Pressable>
  );

  const categories = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.catRow, isDesktop && s.rowDesktop]}>
      {CATEGORIES.map(item => (
        <Pressable
          key={item.id}
          style={s.catTile}
          onPress={() => router.push({ pathname: '/(customer)/food-category', params: { cat: item.cat } } as any)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <Image source={item.image} style={[s.catImage, { borderColor: t.surfaceBorder }]} resizeMode="cover" />
          <Text style={[s.catLabel, { color: t.text }]} numberOfLines={1}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const deals = !search.trim() && withCampaign.length > 0 ? (
    <>
      <Text style={[s.sectionTitle, { color: t.heading }, !isDesktop && s.pad]}>Kampanyalar</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.dealRow, isDesktop && s.rowDesktop]}>
        {withCampaign.map(seller => (
          <Pressable key={seller.id} style={s.dealCard} onPress={() => goSeller(seller.id)} accessibilityRole="button">
            <Text style={s.dealCardTitle} numberOfLines={1}>{campaignLabel(campaigns[seller.id])}</Text>
            <Text style={s.dealCardSub} numberOfLines={1}>{seller.display_name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  ) : null;

  const empty = (
    <View style={s.empty}>
      <Ionicons name={search.trim() || anyFilter ? 'search-outline' : sellerTab === 'restaurant' ? 'storefront-outline' : 'restaurant-outline'} size={44} color={t.textMuted} />
      <Text style={[s.emptyTitle, { color: t.heading }]}>
        {search.trim() || anyFilter ? 'Bunu bulamadık' : sellerTab === 'restaurant' ? 'Restoranlar yolda' : 'Mutfaklar yolda'}
      </Text>
      <Text style={[s.emptySub, { color: t.textSecondary }]}>
        {search.trim() || anyFilter ? 'Filtreleri değiştirip tekrar dene.' : 'Sofra henüz boş. Bölgene teslimat yapan satıcılar eklendikçe burada görünecek.'}
      </Text>
      {search.trim() || anyFilter ? (
        <Pressable style={s.emptyBtn} onPress={clearFilters} accessibilityRole="button">
          <Text style={s.emptyBtnText}>Filtreleri temizle</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.surface }]} edges={['top']}>
      <Modal visible={pickingLocation} animationType="slide" onRequestClose={() => setPickingLocation(false)}>
        <LocationPicker onDone={(loc) => { applyLocation(loc); setPickingLocation(false); }} />
      </Modal>

      <ScrollView
        style={{ backgroundColor: t.surface }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {header}

        {isDesktop ? (
          <View style={s.columns}>
            <View style={[s.sidebar, { borderColor: t.surfaceBorder }]}>
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
                    {value ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <Text style={[s.sideText, { color: t.text }]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.main}>
              {promo}
              <Text style={[s.sectionTitle, { color: t.heading }]}>Ne yemek istersin?</Text>
              {categories}
              {deals}
              <View style={s.listHead}>
                <Text style={[s.sectionTitle, s.sectionTitleFlat, { color: t.heading }]}>{listTitle}</Text>
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
        ) : (
          <>
            <View style={s.pad}>{promo}</View>
            <Text style={[s.sectionTitle, s.pad, { color: t.heading }]}>Ne yemek istersin?</Text>
            {categories}
            {deals}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              <Pressable style={[s.chip, { borderColor: t.surfaceBorder }]} onPress={nextSort} accessibilityRole="button" accessibilityLabel={`Sıralama: ${sortLabel}. Değiştir`}>
                <Ionicons name="swap-vertical" size={15} color={t.text} />
                <Text style={[s.chipText, { color: t.text }]}>{sortLabel}</Text>
              </Pressable>
              {([['Şimdi açık', onlyOpen, setOnlyOpen], ['Kampanyalı', onlyCampaign, setOnlyCampaign], ['Ücretsiz teslimat', onlyFree, setOnlyFree]] as const).map(([label, value, set]) => (
                <Pressable
                  key={label}
                  style={[s.chip, { borderColor: value ? t.brand : t.surfaceBorder, backgroundColor: value ? t.brand : 'transparent' }]}
                  onPress={() => set(!value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: value }}
                >
                  <Text style={[s.chipText, { color: value ? '#fff' : t.text }]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[s.listHead, s.pad]}>
              <Text style={[s.sectionTitle, s.sectionTitleFlat, { color: t.heading }]}>{listTitle}</Text>
              <Text style={[s.count, { color: t.textMuted }]}>{visible.length} sonuç</Text>
            </View>
            {visible.length === 0 ? empty : (
              <View style={s.list}>
                {visible.map(seller => (
                  <RestaurantCard key={seller.id} data={toCard(seller)} campaign={campaigns[seller.id]} onPress={() => goSeller(seller.id)} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 248;

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 32 },
  pad: { paddingHorizontal: 16 },

  header: { paddingHorizontal: 16, paddingTop: 8, borderBottomWidth: 1 },
  headerDesktop: { paddingTop: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  address: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  addressText: { flexShrink: 1, fontSize: 15, fontFamily: fonts.bold },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  searchBar: { height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 8 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.regular, padding: 0 },
  tabs: { flexDirection: 'row', gap: 24, marginTop: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, fontFamily: fonts.medium },
  tabTextOn: { fontFamily: fonts.bold },

  promo: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, marginTop: 14 },
  promoBody: { flex: 1, minWidth: 0 },
  promoTitle: { fontSize: 26, lineHeight: 31, fontFamily: fonts.display, color: '#F7C948', letterSpacing: -0.6 },
  promoTitleDesktop: { fontSize: 36, lineHeight: 42 },
  promoSub: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold, color: '#fff', marginTop: 2 },
  promoImage: { width: 72, height: 72, borderRadius: 36 },
  promoImageDesktop: { width: 96, height: 96, borderRadius: 48 },

  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 20, marginBottom: 10 },
  sectionTitleFlat: { marginTop: 0, marginBottom: 0 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  count: { fontSize: 12, fontFamily: fonts.medium },

  catRow: { paddingHorizontal: 16, gap: 12 },
  rowDesktop: { paddingHorizontal: 0 },
  catTile: { width: 72, alignItems: 'center' },
  catImage: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, backgroundColor: '#fff', marginBottom: 6 },
  catLabel: { fontSize: 12, fontFamily: fonts.medium },

  dealRow: { paddingHorizontal: 16, gap: 10 },
  dealCard: { width: 220, borderRadius: 14, padding: 12, backgroundColor: '#CE3A1F' },
  dealCardTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#fff' },
  dealCardSub: { fontSize: 12, fontFamily: fonts.regular, color: '#fff', marginTop: 2 },

  chips: { paddingHorizontal: 16, gap: 8, paddingTop: 16 },
  chip: { height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: fonts.semibold },

  list: { paddingHorizontal: 16, gap: 20 },

  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 32, paddingHorizontal: 16, paddingTop: 2 },
  sidebar: { width: SIDEBAR_WIDTH, marginTop: 14, borderWidth: 1, borderRadius: 16, padding: 16, position: 'sticky' as any, top: 12 },
  sideTitle: { fontSize: 18, fontFamily: fonts.display, marginBottom: 12 },
  sideLabel: { fontSize: 14, fontFamily: fonts.bold, marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  sideText: { fontSize: 14, fontFamily: fonts.regular },
  sideDivider: { height: 1, marginVertical: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },

  empty: { alignItems: 'center', paddingTop: 32, paddingBottom: 20, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyBtn: { marginTop: 12, backgroundColor: colors.primary, paddingHorizontal: 20, height: 44, justifyContent: 'center', borderRadius: 22 },
  emptyBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
});
