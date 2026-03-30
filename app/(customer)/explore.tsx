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
import { getSellerImage } from '@/lib/food-images';
import { fetchSellers, searchMenuItems, type SellerRow, type MenuItemRow } from '@/lib/db';

type ExploreSeller = {
  id: string;
  display_name: string;
  bio: string;
  district: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  category: string;
  emoji: string;
  bg: string;
  deliveryMin: number;
  logo_url?: string | null;
};

function sellerToExplore(row: SellerRow): ExploreSeller {
  const img = getSellerImage(row.id);
  return {
    id: row.id,
    display_name: row.display_name,
    bio: row.bio ?? '',
    district: row.district ?? '',
    city: row.city ?? '',
    rating_avg: row.rating_avg,
    rating_count: row.rating_count,
    category: 'Ev Yemeği',
    emoji: img.emoji,
    bg: img.bg,
    deliveryMin: 30,
    logo_url: row.logo_url,
  };
}

const CATEGORIES = [
  { key: 'Tümü',      icon: '🍽️' },
  { key: 'Ev Yemeği', icon: '🍲' },
  { key: 'Kahvaltı',  icon: '🍳' },
  { key: 'Tatlı',     icon: '🍰' },
  { key: 'Izgara',    icon: '🥩' },
];

export default function ExploreScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [sortBy, setSortBy] = useState<'default' | 'rating' | 'speed' | 'count'>('default');
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
      const rows = await fetchSellers();
      if (rows.length > 0) {
        setAllSellers(rows.map(sellerToExplore));
      }
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
    return matchSearch && matchCat;
  }).sort((a, b) => {
    if (sortBy === 'speed') return a.deliveryMin - b.deliveryMin;
    if (sortBy === 'rating') return b.rating_avg - a.rating_avg;
    if (sortBy === 'count') return b.rating_count - a.rating_count;
    return 0;
  });

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
      <View style={styles.toggleRow}>
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

      {/* Category pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
        style={styles.categoryRow}
      >
        {CATEGORIES.map(cat => (
          <Pressable
            key={cat.key}
            style={[styles.catPill, activeCategory === cat.key && styles.catPillActive]}
            onPress={() => setActiveCategory(cat.key)}
          >
            <Text style={styles.catIcon}>{cat.icon}</Text>
            <Text style={[styles.catPillText, activeCategory === cat.key && styles.catPillTextActive]}>
              {cat.key}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort / Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
        style={styles.filterRow}
      >
        <Pressable style={[styles.filterPill, sortBy === 'speed' && styles.filterPillActive]} onPress={() => setSortBy(s => s === 'speed' ? 'default' : 'speed')}>
          <Text style={[styles.filterPillText, sortBy === 'speed' && styles.filterPillTextActive]}>🚀 En Hızlısı</Text>
        </Pressable>
        <Pressable style={[styles.filterPill, sortBy === 'rating' && styles.filterPillActive]} onPress={() => setSortBy(s => s === 'rating' ? 'default' : 'rating')}>
          <Text style={[styles.filterPillText, sortBy === 'rating' && styles.filterPillTextActive]}>⭐ Yüksek Puanlı</Text>
        </Pressable>
        <Pressable style={[styles.filterPill, sortBy === 'count' && styles.filterPillActive]} onPress={() => setSortBy(s => s === 'count' ? 'default' : 'count')}>
          <Text style={[styles.filterPillText, sortBy === 'count' && styles.filterPillTextActive]}>💬 En Çok Yorum</Text>
        </Pressable>
      </ScrollView>

      {/* Results header */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {searchMode === 'foods'
            ? (foodResults.length === 0 ? 'Sonuç bulunamadı' : `${foodResults.length} yemek bulundu`)
            : (filtered.length === 0 ? 'Sonuç bulunamadı' : `${filtered.length} satıcı bulundu`)}
        </Text>
      </View>

      {/* Results */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {searchMode === 'foods' ? (
          /* ── Food Results ── */
          foodResults.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={52} color="#C4B8AA" />
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
                  emoji="🍽️"
                  bg="#FFF8E1"
                  size={60}
                  borderRadius={16}
                />
                <View style={styles.foodCardBody}>
                  <Text style={[styles.foodTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.foodPrice}>{(item.price_cents / 100).toFixed(2)} TL</Text>
                  <Text style={[styles.foodSeller, { color: t.textMuted }]} numberOfLines={1}>
                    {(item.seller as any)?.display_name ?? 'Satici'}
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
              <Ionicons name="search-outline" size={52} color="#C4B8AA" />
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
            filtered.map((seller) => (
              <Pressable
                key={seller.id}
                style={({ pressed }) => [styles.sellerCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, pressed && styles.sellerCardPressed]}
                onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
              >
                <FoodImage
                  imageUrl={seller.logo_url}
                  localImage={getSellerImage(seller.id).image}
                  emoji={seller.emoji}
                  bg={seller.bg}
                  size={60}
                  borderRadius={16}
                />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.cardName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
                    <View style={styles.ratingBadge}>
                      <Text style={styles.ratingText}>★ {seller.rating_avg.toFixed(1)}</Text>
                      <Text style={styles.ratingCount}> ({seller.rating_count})</Text>
                    </View>
                  </View>
                  <Text style={[styles.cardBio, { color: t.textMuted }]} numberOfLines={2}>{seller.bio}</Text>
                  <View style={styles.cardMeta}>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>📍 {seller.district}</Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>🕐 {seller.deliveryMin} dk</Text>
                    </View>
                    <View style={[styles.metaChip, styles.catChip]}>
                      <Text style={styles.catChipText}>{seller.category}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))
          )
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  searchWrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1208', padding: 0 },
  clearBtnWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#F0ECE6', alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { fontSize: 11, color: '#A89A8A', fontWeight: '700' },

  categoryRow: { flexGrow: 0 },
  categoryScroll: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  catPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  catIcon: { fontSize: 14 },
  catPillText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  catPillTextActive: { color: '#fff' },

  filterRow: { flexGrow: 0, marginTop: 4, marginBottom: 4 },
  filterScroll: { paddingHorizontal: 16, gap: 8, paddingBottom: 6 },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterPillText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  filterPillTextActive: { color: '#fff' },

  resultsHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  resultsText: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },

  list: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },

  sellerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  sellerCardPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },

  cardEmoji: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardEmojiText: { fontSize: 30 },
  cardBody: { flex: 1, gap: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { flex: 1, fontSize: 14, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  ratingText: { fontSize: 11, fontWeight: '700', color: '#EF9F27' },
  ratingCount: { fontSize: 10, color: '#A89A8A' },
  cardBio: { fontSize: 12, color: '#A89A8A', lineHeight: 17 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  metaChip: { backgroundColor: '#F7F3EE', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  metaChipText: { fontSize: 11, color: '#6B5E50', fontWeight: '500' },
  catChip: { backgroundColor: colors.primary + '18' },
  catChipText: { fontSize: 11, fontWeight: '700', color: colors.primary },

  arrow: { fontSize: 20, color: '#C4B8AA', fontWeight: '600', flexShrink: 0 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },
  resetBtn: { marginTop: 8, backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  resetBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Search history
  historyPanel: { paddingHorizontal: 16, paddingBottom: 8 },
  historySection: { marginBottom: 14 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  historySectionTitle: { fontSize: 13, fontWeight: '700' },
  historyClear: { fontSize: 12, fontWeight: '600', color: colors.primary },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  historyText: { fontSize: 14, fontWeight: '500' },
  popularWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  popularPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, backgroundColor: '#fff' },
  popularText: { fontSize: 13, fontWeight: '600' },

  toggleRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingTop: 8, paddingBottom: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE8E2' },
  toggleBtnActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  toggleBtnText: { fontSize: 14, fontWeight: '700', color: '#A89A8A' },
  toggleBtnTextActive: { color: '#fff' },

  foodCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDE8E2', padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  foodCardBody: { flex: 1, gap: 3 },
  foodTitle: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  foodPrice: { fontSize: 15, fontWeight: '800', color: colors.primary },
  foodSeller: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },
  foodCategory: { fontSize: 11, fontWeight: '700', color: colors.primary },
});
