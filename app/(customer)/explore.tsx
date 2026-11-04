import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { HOME_SELLERS_ENABLED, isSellerListed } from '@/constants/business';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import {
  getSearchHistory,
  addSearchTerm,
  removeSearchTerm,
  clearSearchHistory,
  POPULAR_SEARCHES,
} from '@/lib/search-history';
import { useTabBarSpace } from '@/components/shared/ChainTabBar';
import FoodImage from '@/components/shared/FoodImage';
import { FoodFilterChips, FoodLabels } from '@/components/shared/FoodFilters';
import { RestaurantCard } from '@/components/shared/RestaurantCard';
import { SearchField, TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { sellerPhoto } from '@/lib/food-images';
import { fetchSellersWithHours, fetchSellerCampaignMap, searchMenuItems, type CouponRow, type SellerHourRow, type SellerRow, type MenuItemRow } from '@/lib/db';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { track } from '@/lib/analytics';
import { categoryLabel } from '@/lib/menu-categories';
import { dietaryLabels, matchesFoodFilters, toggleKey, type FoodFilterKey } from '@/lib/dietary';
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
  mealCards: boolean;
  pickup: boolean;
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
    mealCards: (row.meal_cards ?? []).length > 0,
    pickup: !!row.pickup_enabled,
  };
}


const TYPES = ['Tümü', 'Ev Yemeği', 'Restoran'];

const searchListedFoods = (term: string) =>
  searchMenuItems(term).then(items => items.filter(item => isSellerListed(item.seller)));

type Filter = 'rating' | 'speed' | 'campaign' | 'open' | 'meal_card' | 'pickup';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'rating', label: 'En yüksek puan' },
  { key: 'speed', label: 'En hızlı' },
  { key: 'campaign', label: 'Kampanyalı' },
  { key: 'open', label: 'Şimdi açık' },
  { key: 'meal_card', label: 'Yemek kartı geçer' },
  { key: 'pickup', label: 'Gelip al' },
];

/** Tam lirada kuruş yazılmaz: ₺260, ₺42,50 */
function priceTL(cents: number): string {
  return cents % 100 === 0 ? `₺${cents / 100}` : `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

/** İlçe adına bulunma eki: Kadıköy'de, Beşiktaş'ta, Beyoğlu'nda */
function locative(name: string): string {
  const lower = name.toLocaleLowerCase('tr');
  const vowels = lower.match(/[aıoueiöü]/g);
  const a = vowels && 'aıou'.includes(vowels[vowels.length - 1]) ? 'a' : 'e';
  if (/(oğlu|burnu|önü|düzü)$/.test(lower)) return `${name}'nd${a}`;
  return `${name}'${/[fstkçşhp]$/.test(lower) ? 't' : 'd'}${a}`;
}

type ChipProps = {
  label: string;
  on: boolean;
  role?: 'button' | 'tab';
  onPress: () => void;
};

/** Sayfa zeminindeki seçim çipi: etkin koyu, diğerleri beyaz */
function Chip({ label, on, role = 'button', onPress }: ChipProps) {
  const { colors: t } = useTheme();
  return (
    <Pressable
      style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
    </Pressable>
  );
}

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
  const foodWidth = isDesktop ? gridItemWidth(pageWidth, 2, 16, 16) : undefined;
  const tabBarSpace = useTabBarSpace();
  const { requireAuth } = useRequireAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [allSellers, setAllSellers] = useState<ExploreSeller[]>([]);
  const [district, setDistrict] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<'sellers' | 'foods'>('sellers');
  const [foodResults, setFoodResults] = useState<(MenuItemRow & { seller: SellerRow })[]>([]);
  const [foodFilters, setFoodFilters] = useState<FoodFilterKey[]>([]);

  useEffect(() => {
    getSearchHistory().then(setHistory);
  }, []);

  // Konum ana sayfada değişmiş olabilir: ekran her açıldığında tazelenir.
  useFocusEffect(useCallback(() => { loadSellers(); }, []));

  async function loadSellers() {
    try {
      const [rows, saved] = await Promise.all([fetchSellersWithHours(), getSavedLocation().catch(() => null)]);
      fetchSellerCampaignMap().then(setCampaigns).catch(() => {});
      const coords = usableCoords(saved);
      // Konum servisi ilçeyi çözemezse "Bilinmeyen" kaydeder: başlıkta yazılmaz.
      setDistrict(saved?.district && saved.district !== 'Bilinmeyen' ? saved.district : null);
      setAllSellers(rows.filter(row => isSellerListed(row) && isInDeliveryArea(row, coords)).map(sellerToExplore));
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
    // Aranan metin kaydedilmez: adres veya isim içerebilir.
    track('search', { mode: searchMode, length: trimmed.length });
    addSearchTerm(trimmed).then(() => getSearchHistory().then(setHistory));
    if (searchMode === 'foods') {
      searchListedFoods(trimmed).then(setFoodResults).catch(() => setFoodResults([]));
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
      searchListedFoods(search.trim()).then(setFoodResults).catch(() => setFoodResults([]));
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
    const matchFilter = filter === 'campaign' ? !!campaigns[s.id]
      : filter === 'open' ? s.open
      : filter === 'meal_card' ? s.mealCards
      : filter === 'pickup' ? s.pickup
      : true;
    return matchSearch && matchCat && matchFilter;
  }).sort((a, b) => (filter === 'speed' ? a.deliveryMin - b.deliveryMin : b.rating_avg - a.rating_avg));

  const visibleFoods = foodResults.filter(item => matchesFoodFilters(item, foodFilters));

  const subtitle = allSellers.length > 0
    ? `${district ? `${locative(district)} ` : ''}${allSellers.length} restoran`
    : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar title="Keşfet" subtitle={subtitle} cart>
        <SearchField
          placeholder="Restoran, yemek veya semt ara"
          value={search}
          onChangeText={setSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          onSubmitEditing={() => submitSearch(search)}
        />
      </TopBar>

      <ScrollView
        contentContainerStyle={{ paddingBottom: isDesktop ? 32 : tabBarSpace }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
        }
      >
        {/* Search History / Popular */}
        {showHistoryPanel && (
          <View style={[styles.historyPanel, { backgroundColor: t.surface }, isDesktop && styles.historyPanelDesktop]}>
            {history.length > 0 && (
              <View>
                <View style={styles.historyHeader}>
                  <Text style={[styles.historySectionTitle, { color: t.textSecondary }]}>Son aramalar</Text>
                  <Pressable style={styles.historyClear} onPress={clearHistory} accessibilityRole="button" accessibilityLabel="Son aramaları temizle">
                    <Text style={[styles.historyClearText, { color: t.text }]}>Temizle</Text>
                  </Pressable>
                </View>
                {history.map(term => (
                  <View key={term} style={styles.historyRow}>
                    <Pressable style={styles.historyItem} onPress={() => submitSearch(term)} accessibilityRole="button" accessibilityLabel={`${term} ara`}>
                      <Ionicons name="time-outline" size={16} color={t.textSecondary} />
                      <Text style={[styles.historyText, { color: t.text }]} numberOfLines={1}>{term}</Text>
                    </Pressable>
                    <Pressable style={styles.historyRemove} onPress={() => removeHistoryItem(term)} accessibilityRole="button" accessibilityLabel={`${term} aramasını sil`}>
                      <Ionicons name="close" size={18} color={t.textSecondary} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <View>
              <Text style={[styles.historySectionTitle, styles.popularTitle, { color: t.textSecondary }]}>Popüler aramalar</Text>
              <View style={styles.popularWrap}>
                {POPULAR_SEARCHES.map(term => (
                  <Pressable key={term} style={[styles.chip, { backgroundColor: t.background }]} onPress={() => submitSearch(term)} accessibilityRole="button" accessibilityLabel={`${term} ara`}>
                    <Text style={[styles.chipText, { color: t.text }]}>{term}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Arama türü ve satıcı türü */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chipRow}>
          <Chip label="Restoranlar" role="tab" on={searchMode === 'sellers'} onPress={() => setSearchMode('sellers')} />
          <Chip label="Yemekler" role="tab" on={searchMode === 'foods'} onPress={() => setSearchMode('foods')} />
          {HOME_SELLERS_ENABLED && searchMode === 'sellers' ? (
            <>
              <View style={[styles.chipDivider, { backgroundColor: t.surfaceBorder }]} />
              {TYPES.map(type => (
                <Chip key={type} label={type} role="tab" on={activeCategory === type} onPress={() => setActiveCategory(type)} />
              ))}
            </>
          ) : null}
        </ScrollView>

        {/* Filtreler */}
        {searchMode === 'sellers' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.chipRow, styles.chipRowNext]}>
            {FILTERS.map(f => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </ScrollView>
        ) : (
          <FoodFilterChips
            active={foodFilters}
            onToggle={key => setFoodFilters(prev => toggleKey(prev, key))}
            contentStyle={[styles.chipRow, styles.chipRowNext]}
          />
        )}

        {/* Results */}
        <View style={[styles.list, isDesktop && styles.listGrid]}>
          {searchMode === 'foods' ? (
            /* ── Food Results ── */
            foodResults.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={44} color={t.textMuted} />
                <Text style={[styles.emptyTitle, { color: t.heading }]}>Sonuç bulunamadı</Text>
                <Text style={[styles.emptySub, { color: t.textSecondary }]}>Bir yemek adı ara.</Text>
              </View>
            ) : visibleFoods.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={44} color={t.textMuted} />
                <Text style={[styles.emptyTitle, { color: t.heading }]}>Bu filtrelere uyan yemek yok</Text>
                <View style={styles.emptyAction}>
                  <Button label="Filtreleri temizle" onPress={() => setFoodFilters([])} />
                </View>
              </View>
            ) : (
              visibleFoods.map((item) => {
                const sellerName = (item.seller as any)?.display_name ?? 'Satıcı';
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.foodCard, { backgroundColor: t.surface }, foodWidth ? { width: foodWidth } : null, pressed && styles.pressed]}
                    onPress={() => router.push(`/(customer)/seller/${item.seller_id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${sellerName}, ${priceTL(item.price_cents)}`}
                  >
                    <FoodImage imageUrl={item.image_url} size={76} borderRadius={38} />
                    <View style={styles.foodCardBody}>
                      <Text style={[styles.foodTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
                      <Text style={[styles.foodSeller, { color: t.textSecondary }]} numberOfLines={1}>{sellerName}</Text>
                      <Text style={[styles.foodPrice, { color: t.text }]}>{priceTL(item.price_cents)}</Text>
                      {item.category ? (
                        <Text style={[styles.foodCategory, { color: t.textSecondary }]} numberOfLines={1}>{categoryLabel(item.category)}</Text>
                      ) : null}
                      <FoodLabels labels={dietaryLabels(item)} />
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
                  </Pressable>
                );
              })
            )
          ) : (
            /* ── Seller Results ── */
            filtered.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={44} color={t.textMuted} />
                <Text style={[styles.emptyTitle, { color: t.heading }]}>Sonuç bulunamadı</Text>
                <Text style={[styles.emptySub, { color: t.textSecondary }]}>Farklı bir arama veya filtre dene.</Text>
                <View style={styles.emptyAction}>
                  <Button label="Filtreleri temizle" onPress={() => { setSearch(''); setActiveCategory('Tümü'); setFilter('rating'); }} />
                </View>
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  chipRow: { paddingHorizontal: 16, paddingTop: 12, gap: 8, alignItems: 'center' },
  chipRowNext: { paddingTop: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  chipDivider: { width: 1, height: 24, marginHorizontal: 2 },

  list: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  listGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  pressed: { opacity: 0.85 },

  empty: { width: '100%', alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyAction: { marginTop: 12 },

  // Search history
  historyPanel: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 14, gap: 14 },
  historyPanelDesktop: { maxWidth: 640 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historySectionTitle: { fontSize: 13, fontFamily: fonts.bold },
  historyClear: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  historyClearText: { fontSize: 13, fontFamily: fonts.semibold },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, minHeight: 44 },
  historyText: { flexShrink: 1, fontSize: 14, fontFamily: fonts.medium },
  historyRemove: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  popularTitle: { marginBottom: 10 },
  popularWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  foodCard: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', gap: 12, alignItems: 'center' },
  foodCardBody: { flex: 1, minWidth: 0 },
  foodTitle: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  foodSeller: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },
  foodPrice: { fontSize: 15, lineHeight: 20, fontFamily: fonts.extrabold, marginTop: 4 },
  foodCategory: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },
});
