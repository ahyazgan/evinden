import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import FoodImage from '@/components/shared/FoodImage';
import { FoodFilterChips, FoodLabels } from '@/components/shared/FoodFilters';
import { TopBar } from '@/components/shared/TopBar';
import { isSellerListed } from '@/constants/business';
import { fetchSellers, fetchMenuItems } from '@/lib/db';
import { dietaryLabels, matchesFoodFilters, toggleKey, type FoodFilterKey } from '@/lib/dietary';
import { categoryLabel, MENU_CATEGORIES, menuCategoryKey, type MenuCategoryKey } from '@/lib/menu-categories';
import { fonts } from '@/lib/fonts';
import { gridItemWidth, useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

type FoodItem = {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  priceCents: number;
  /** Anahtar: satıcı kodu ve eski ad aynı kategoride toplanır. */
  category: MenuCategoryKey;
  imageUrl: string | null;
  dietary: string[];
  allergens: string[] | null;
};

type CategoryFilter = MenuCategoryKey | 'all';

const FOOD_CATEGORIES: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  ...MENU_CATEGORIES.map(c => ({ key: c.id as CategoryFilter, label: c.label })),
];

/** Bağlantıdaki değer anahtar da eski ad da olabilir. */
const filterFromParam = (cat?: string): CategoryFilter => (cat ? menuCategoryKey(cat) : 'all');

type SortKey = 'default' | 'price_asc' | 'price_desc';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Varsayılan' },
  { key: 'price_asc', label: '₺ Artan' },
  { key: 'price_desc', label: '₺ Azalan' },
];

/** Tam lirada kuruş yazılmaz: ₺260, ₺42,50 */
function priceTL(cents: number): string {
  return cents % 100 === 0 ? `₺${cents / 100}` : `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function FoodCategoryScreen() {
  const { cat } = useLocalSearchParams<{ cat?: string }>();
  const router = useRouter();
  const { colors: t } = useTheme();
  const { isDesktop, pageWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const chipScroll = useRef<ScrollView>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>(() => filterFromParam(cat));
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [foodFilters, setFoodFilters] = useState<FoodFilterKey[]>([]);

  const loadFoods = async () => {
    try {
      const sellers = (await fetchSellers()).filter(isSellerListed);
      const allFoods: FoodItem[] = [];

      await Promise.all(
        sellers.map(async (seller) => {
          try {
            const menuItems = await fetchMenuItems(seller.id);
            for (const item of menuItems) {
              if (!item.is_available) continue;
              allFoods.push({
                id: item.id,
                sellerId: seller.id,
                sellerName: seller.display_name,
                title: item.title,
                description: item.description ?? '',
                priceCents: item.price_cents,
                category: menuCategoryKey(item.category),
                imageUrl: item.image_url,
                dietary: item.dietary ?? [],
                allergens: item.allergens ?? null,
              });
            }
          } catch {
            // skip seller on error
          }
        }),
      );

      setFoods(allFoods);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFoods();
  }, []);

  // Sekme ekranı açık kalır: ana sayfadan başka bir kategoriye gelince seçim de değişmeli.
  useEffect(() => {
    setActiveCategory(filterFromParam(cat));
  }, [cat]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFoods();
    setRefreshing(false);
  };

  const inCategory = foods.filter((f) => activeCategory === 'all' || f.category === activeCategory);
  const filtered = inCategory
    .filter((f) => matchesFoodFilters(f, foodFilters))
    .sort((a, b) => {
      if (sortBy === 'price_asc') return a.priceCents - b.priceCents;
      if (sortBy === 'price_desc') return b.priceCents - a.priceCents;
      return 0;
    });

  const rowWidth = isDesktop ? gridItemWidth(pageWidth, pageWidth >= 1040 ? 3 : 2, 12, 16) : undefined;

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar back cart title={activeCategory === 'all' ? 'Yemek Kategorileri' : categoryLabel(activeCategory)}>
        <ScrollView
          ref={chipScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.catBleed}
          contentContainerStyle={s.catRow}
        >
          {FOOD_CATEGORIES.map(({ key, label }) => {
            const on = activeCategory === key;
            // Masaüstünde üst alan koyu değil: çipler sayfa zemininde durur.
            const bg = isDesktop ? (on ? t.brand : t.surface) : on ? t.accent : t.panel;
            const fg = isDesktop ? (on ? t.onBrand : t.text) : on ? t.onAccent : t.onBrand;
            return (
              <Pressable
                key={key}
                style={[s.chip, { backgroundColor: bg }]}
                onPress={() => setActiveCategory(key)}
                // Ana sayfadan gelinen kategori şeridin sonunda kalmasın.
                onLayout={on ? (e) => chipScroll.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 16), animated: false }) : undefined}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, { color: fg }]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </TopBar>

      <View style={s.sortRow}>
        <Text style={[s.resultCount, { color: t.textSecondary }]}>{filtered.length} yemek</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sortScroll} contentContainerStyle={s.sortBtns}>
          {SORTS.map(({ key, label }) => {
            const on = sortBy === key;
            return (
              <Pressable
                key={key}
                style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
                onPress={() => setSortBy(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FoodFilterChips
        active={foodFilters}
        onToggle={(key) => setFoodFilters((prev) => toggleKey(prev, key))}
        style={s.filterScroll}
        contentStyle={s.filterRow}
      />

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={[s.loadingText, { color: t.textSecondary }]}>Yemekler yükleniyor...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.list, isDesktop && s.grid, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
          }
        >
          {filtered.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="search-outline" size={44} color={t.textMuted} />
              <Text style={[s.emptyTitle, { color: t.heading }]}>
                {inCategory.length > 0 ? 'Bu filtrelere uyan yemek yok' : 'Bu kategoride yemek yok'}
              </Text>
            </View>
          ) : (
            filtered.map((food) => (
              <Pressable
                key={food.id}
                style={({ pressed }) => [s.foodCard, { backgroundColor: t.surface }, rowWidth ? { width: rowWidth } : null, pressed && s.pressed]}
                onPress={() => router.push(`/(customer)/seller/${food.sellerId}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`${food.title}, ${food.sellerName}, ${priceTL(food.priceCents)}`}
              >
                <FoodImage imageUrl={food.imageUrl} size={76} borderRadius={38} />
                <View style={s.foodBody}>
                  <Text style={[s.foodTitle, { color: t.text }]} numberOfLines={1}>{food.title}</Text>
                  <Text style={[s.foodSeller, { color: t.textSecondary }]} numberOfLines={1}>{food.sellerName}</Text>
                  <Text style={[s.foodPrice, { color: t.text }]}>{priceTL(food.priceCents)}</Text>
                  <FoodLabels labels={dietaryLabels(food)} />
                </View>
                <View style={[s.plus, { backgroundColor: t.brand }]}>
                  <Ionicons name="add" size={20} color={t.onBrand} />
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  catBleed: { marginHorizontal: -16, marginTop: 2 },
  catRow: { paddingHorizontal: 16, gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingTop: 12 },
  resultCount: { fontSize: 12, fontFamily: fonts.medium },
  sortScroll: { flex: 1 },
  sortBtns: { flexGrow: 1, justifyContent: 'flex-end', gap: 8, paddingRight: 16 },

  filterScroll: { flexGrow: 0, marginTop: 8 },
  filterRow: { paddingHorizontal: 16 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, fontFamily: fonts.medium },

  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  foodCard: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { opacity: 0.85 },
  foodBody: { flex: 1, minWidth: 0 },
  foodTitle: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  foodSeller: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },
  foodPrice: { fontSize: 15, lineHeight: 20, fontFamily: fonts.extrabold, marginTop: 4 },
  plus: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  empty: { width: '100%', alignItems: 'center', paddingTop: 48, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
});
