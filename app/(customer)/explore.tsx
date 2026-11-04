import { useCallback, useEffect, useState } from 'react';
import {
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
import { colors } from '@/constants/theme';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import {
  getSearchHistory,
  addSearchTerm,
  removeSearchTerm,
  clearSearchHistory,
  POPULAR_SEARCHES,
} from '@/lib/search-history';
import FoodImage from '@/components/shared/FoodImage';
import { RestaurantCard } from '@/components/shared/RestaurantCard';
import { sellerPhoto } from '@/lib/food-images';
import { fetchSellersWithHours, fetchSellerCampaignMap, searchMenuItems, type CouponRow, type SellerHourRow, type SellerRow, type MenuItemRow } from '@/lib/db';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { useFavorites } from '@/lib/favorites-context';
import { gridItemWidth, useResponsive } from '@/lib/responsive';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { isInDeliveryArea, usableCoords } from '@/lib/geo';
import { getSavedLocation } from '@/components/shared/LocationPicker';

type ExploreSeller = {
  id: string;
  display_name: string;
  bio: string;
  district: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  category: string;
  deliveryMin: number;
  deliveryMax: number;
  deliveryFee: number | null;
  minOrder: number;
  open: boolean;
  photo: string | null;
};

function sellerToExplore(row: SellerRow & { seller_hours?: SellerHourRow[] }): ExploreSeller {
  return {
    id: row.id,
    display_name: row.display_name,
    bio: row.bio ?? '',
    district: row.district ?? '',
    city: row.city ?? '',
    rating_avg: Number(row.rating_avg) || 0,
    rating_count: row.rating_count,
    category: row.seller_type === 'restaurant' ? 'Restoran' : 'Ev Yemeği',
    deliveryMin: row.delivery_time_min ?? 30,
    deliveryMax: row.delivery_time_max ?? 45,
    deliveryFee: row.delivery_fee_cents ?? null,
    minOrder: row.min_order_cents ?? 0,
    open: !row.is_paused && isOpenAt(row.seller_hours ?? [], istanbulClock()),
    photo: sellerPhoto(row),
  };
}


const TYPES = ['Tümü', 'Ev Yemeği', 'Restoran'];

type Filter = 'rating' | 'speed' | 'campaign' | 'open';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'rating', label: 'En yüksek puan' },
  { key: 'speed', label: 'En hızlı' },
  { key: 'campaign', label: 'Kampanyalı' },
  { key: 'open', label: 'Şimdi açık' },
];


export default function ExploreScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [filter, setFilter] = useState<Filter>('rating');
  const [campaigns, setCampaigns] = useState<Record<string, CouponRow>>({});
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isDesktop, pageWidth } = useResponsive();
  const cardWidth = isDesktop ? gridItemWidth(pageWidth, 3, 16, 16) : pageWidth - 32;
  const { requireAuth } = useRequireAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [allSellers, setAllSellers] = useState<ExploreSeller[]>([]);
  const [searchMode, setSearchMode] = useState<'sellers' | 'foods'>('sellers');
  const [foodResults, setFoodResults] = useState<(MenuItemRow & { seller: SellerRow })[]>([]);

  useEffect(() => {
    getSearchHistory().then(setHistory);
    loadSellers();
  }, []);

  async function loadSellers() {
    try {
      const [rows, saved] = await Promise.all([fetchSellersWithHours(), getSavedLocation().catch(() => null)]);
      fetchSellerCampaignMap().then(setCampaigns).catch(() => {});
      const coords = usableCoords(saved);
      setAllSellers(rows.filter(row => isInDeliveryArea(row, coords)).map(sellerToExplore));
    } catch {
      // Keep empty
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSellers();
    setRefreshing(false);
  }, []);

  const submitSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setSearch(trimmed);
    setSearchFocused(false);
    addSearchTerm(trimmed).then(() => getSearchHistory().then(setHistory));
    if (searchMode === 'foods') {
      searchMenuItems(trimmed).then(setFoodResults).catch(() => setFoodResults([]));
    }
  }, [searchMode]);

  const removeHistoryItem = useCallback((term: string) => {
    removeSearchTerm(term).then(() => getSearchHistory().then(setHistory));
  }, []);

  const clearHistory = useCallback(() => {
    clearSearchHistory().then(() => setHistory([]));
  }, []);

  // Trigger food search when mode switches to foods or search text changes
  useEffect(() => {
    if (searchMode === 'foods' && search.trim().length > 0) {
      searchMenuItems(search.trim()).then(setFoodResults).catch(() => setFoodResults([]));
    } else if (searchMode === 'foods') {
      setFoodResults([]);
    }
  }, [searchMode, search]);

  const showHistoryPanel = searchFocused && search.trim() === '';

  const filtered = allSellers.filter(s => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      q === '' ||
      s.display_name.toLowerCase().includes(q) ||
      s.bio.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q);
    const matchCat = activeCategory === 'Tümü' || s.category === activeCategory;
    const matchFilter = filter === 'campaign' ? !!campaigns[s.id] : filter === 'open' ? s.open : true;
    return matchSearch && matchCat && matchFilter;
  }).sort((a, b) => (filter === 'speed' ? a.deliveryMin - b.deliveryMin : b.rating_avg - a.rating_avg));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.surfaceBorder }]}>
        <Text style={[styles.headerTitle, { color: t.text }]}>Keşfet</Text>
        <Text style={[styles.headerSub, { color: t.textMuted }]}>{allSellers.length} satıcı mevcut</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
          <Ionicons name="search" size={18} color={t.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: t.text }]}
            placeholder="Satıcı, yemek veya ilçe ara..."
            placeholderTextColor={t.textMuted}
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            onSubmitEditing={() => submitSearch(search)}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <View style={styles.clearBtnWrap}>
                <Text style={styles.clearBtnText}>✕</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Search History / Popular */}
      {showHistoryPanel && (
        <View style={styles.historyPanel}>
          {history.length > 0 && (
            <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <Text style={[styles.historySectionTitle, { color: t.textSecondary }]}>Son Aramalar</Text>
                <Pressable onPress={clearHistory} hitSlop={8}>
                  <Text style={styles.historyClear}>Temizle</Text>
                </Pressable>
              </View>
              {history.map(term => (
                <View key={term} style={styles.historyRow}>
                  <Pressable style={styles.historyItem} onPress={() => submitSearch(term)}>
                    <Ionicons name="time-outline" size={16} color={t.textMuted} />
                    <Text style={[styles.historyText, { color: t.text }]}>{term}</Text>
                  </Pressable>
                  <Pressable onPress={() => removeHistoryItem(term)} hitSlop={8}>
                    <Ionicons name="close" size={16} color={t.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.historySection}>
            <Text style={[styles.historySectionTitle, { color: t.textSecondary }]}>Popüler Aramalar</Text>
            <View style={styles.popularWrap}>
              {POPULAR_SEARCHES.map(term => (
                <Pressable key={term} style={[styles.popularPill, { borderColor: t.surfaceBorder }]} onPress={() => submitSearch(term)}>
                  <Text style={[styles.popularText, { color: t.textSecondary }]}>{term}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Search Mode Toggle */}
      <View style={[styles.toggleRow, isDesktop && styles.toggleRowDesktop]}>
        <Pressable
          style={[styles.toggleBtn, searchMode === 'sellers' && styles.toggleBtnActive]}
          onPress={() => setSearchMode('sellers')}
        >
          <Text style={[styles.toggleBtnText, searchMode === 'sellers' && styles.toggleBtnTextActive]}>Satıcılar</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, searchMode === 'foods' && styles.toggleBtnActive]}
          onPress={() => setSearchMode('foods')}
        >
          <Text style={[styles.toggleBtnText, searchMode === 'foods' && styles.toggleBtnTextActive]}>Yemekler</Text>
        </Pressable>
      </View>

      {/* Tür */}
      {searchMode === 'sellers' ? (
        <View style={styles.typeRow}>
          {TYPES.map(type => (
            <Pressable key={type} style={[styles.typeTab, activeCategory === type && { borderBottomColor: t.text }]} onPress={() => setActiveCategory(type)} accessibilityRole="tab" accessibilityState={{ selected: activeCategory === type }}>
              <Text style={[styles.typeTabText, { color: activeCategory === type ? t.text : t.textSecondary }, activeCategory === type && styles.typeTabTextOn]}>{type}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Filtreler */}
      {searchMode === 'sellers' ? (
        <View style={[styles.filterWrap, { borderBottomColor: t.divider }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            {FILTERS.map(f => {
              const on = filter === f.key;
              return (
                <Pressable key={f.key} style={[styles.filterChip, { borderColor: on ? '#151A16' : t.surfaceBorder, backgroundColor: on ? t.brand : t.surface }]} onPress={() => setFilter(f.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.filterChipText, { color: on ? '#fff' : t.text }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Results */}
      <ScrollView
        contentContainerStyle={[styles.list, isDesktop && searchMode === 'sellers' && styles.listGrid]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {searchMode === 'foods' ? (
          /* ── Food Results ── */
          foodResults.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={52} color="#A3ACA5" />
              <Text style={styles.emptyTitle}>Sonuç bulunamadı</Text>
              <Text style={styles.emptySub}>Bir yemek adı arayın</Text>
            </View>
          ) : (
            foodResults.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.foodCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, pressed && styles.sellerCardPressed]}
                onPress={() => router.push(`/(customer)/seller/${item.seller_id}` as any)}
              >
                <FoodImage
                  imageUrl={item.image_url}
                  size={60}
                  borderRadius={16}
                />
                <View style={styles.foodCardBody}>
                  <Text style={[styles.foodTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.foodPrice}>{(item.price_cents / 100).toFixed(2)} TL</Text>
                  <Text style={[styles.foodSeller, { color: t.textMuted }]} numberOfLines={1}>
                    {(item.seller as any)?.display_name ?? 'Satıcı'}
                  </Text>
                  {item.category ? (
                    <View style={[styles.metaChip, styles.catChip, { alignSelf: 'flex-start', marginTop: 2 }]}>
                      <Text style={styles.foodCategory}>{item.category}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))
          )
        ) : (
          /* ── Seller Results ── */
          filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={52} color="#A3ACA5" />
              <Text style={styles.emptyTitle}>Sonuç bulunamadı</Text>
              <Text style={styles.emptySub}>Farklı bir arama veya kategori deneyin</Text>
              <Pressable
                style={styles.resetBtn}
                onPress={() => { setSearch(''); setActiveCategory('Tümü'); }}
              >
                <Text style={styles.resetBtnText}>Filtreleri Temizle</Text>
              </Pressable>
            </View>
          ) : (
            filtered.map((seller) => {
              const fav = isFavorite(seller.id);
              return (
                <RestaurantCard
                  key={seller.id}
                  width={isDesktop ? cardWidth : undefined}
                  campaign={campaigns[seller.id]}
                  data={{
                    name: seller.display_name,
                    photo: seller.photo,
                    ratingAvg: seller.rating_avg,
                    ratingCount: seller.rating_count,
                    typeLabel: seller.category,
                    timeMin: seller.deliveryMin,
                    timeMax: seller.deliveryMax,
                    deliveryFeeCents: seller.deliveryFee,
                    minOrderCents: seller.minOrder,
                    open: seller.open,
                  }}
                  favorite={{ active: fav, onToggle: () => { if (requireAuth()) toggleFavorite(seller.id); } }}
                  onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                />
              );
            })
          )
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  headerTitle: { fontSize: 24, fontFamily: fonts.display, color: '#17402F', letterSpacing: -0.5 },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', marginTop: 2 },

  searchWrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  searchIcon: { fontFamily: fonts.regular, fontSize: 16 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: '#151A16', padding: 0 },
  clearBtnWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#EDEFE8', alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { fontSize: 11, color: '#6B766F', fontFamily: fonts.bold },
  filterScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },

  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 20 },

  cardEmoji: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardEmojiText: { fontFamily: fonts.regular, fontSize: 30 },
  catChip: { backgroundColor: colors.primary + '18' },
  catChipText: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary },

  arrow: { fontSize: 20, color: '#A3ACA5', fontFamily: fonts.semibold, flexShrink: 0 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
  resetBtn: { marginTop: 8, backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  resetBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },

  // Search history
  historyPanel: { paddingHorizontal: 16, paddingBottom: 8 },
  historySection: { marginBottom: 14 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historySectionTitle: { fontSize: 13, fontFamily: fonts.bold },
  historyClear: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  historyText: { fontSize: 14, fontFamily: fonts.medium },
  popularWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  popularPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, backgroundColor: '#fff' },
  popularText: { fontSize: 13, fontFamily: fonts.semibold },

  toggleRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingTop: 8, paddingBottom: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6DE' },
  toggleBtnActive: { backgroundColor: '#17402F', borderColor: '#151A16' },
  toggleBtnText: { fontSize: 14, fontFamily: fonts.bold, color: '#6B766F' },
  toggleBtnTextActive: { color: '#fff' },

  foodCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E3E6DE', padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  foodCardBody: { flex: 1, gap: 3 },
  foodTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16' },
  foodPrice: { fontSize: 15, fontFamily: fonts.extrabold, color: colors.primary },
  foodSeller: { fontSize: 12, color: '#6B766F', fontFamily: fonts.medium },
  foodCategory: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary },
  typeRow: { flexDirection: 'row', gap: 20, paddingHorizontal: 16 },
  typeTab: { paddingTop: 8, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  typeTabText: { fontSize: 14, fontFamily: fonts.regular },
  typeTabTextOn: { fontFamily: fonts.bold },
  filterWrap: { borderBottomWidth: 1 },
  filterChip: { height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 13, fontFamily: fonts.semibold },
  listGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  toggleRowDesktop: { maxWidth: 432 },
  sellerCardPressed: { opacity: 0.85 },
  metaChip: { backgroundColor: '#EFF2EA', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  metaChipText: { fontSize: 11, fontFamily: fonts.medium, color: '#56605A' },
});
