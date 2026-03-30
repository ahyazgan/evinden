import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { fetchSellers, fetchMenuItems } from '@/lib/db';

type FoodItem = {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  imageUrl: string | null;
};

const FOOD_CATEGORIES = [
  { key: 'Tümü', icon: 'restaurant-outline' },
  { key: 'Çorbalar', icon: 'cafe-outline' },
  { key: 'Ana Yemekler', icon: 'flame-outline' },
  { key: 'Izgaralar', icon: 'bonfire-outline' },
  { key: 'Kahvaltılar', icon: 'sunny-outline' },
  { key: 'Tatlılar', icon: 'ice-cream-outline' },
  { key: 'Pastalar', icon: 'gift-outline' },
  { key: 'Börekler', icon: 'pizza-outline' },
  { key: 'Zeytinyağlılar', icon: 'leaf-outline' },
  { key: 'Hamur İşleri', icon: 'ellipse-outline' },
];

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function FoodCategoryScreen() {
  const { cat } = useLocalSearchParams<{ cat?: string }>();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState(cat || 'Tümü');
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc'>('default');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [foods, setFoods] = useState<FoodItem[]>([]);

  const loadFoods = async () => {
    try {
      const sellers = await fetchSellers();
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
                category: item.category ?? 'Diğer',
                imageUrl: item.image_url,
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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFoods();
    setRefreshing(false);
  };

  const filtered = foods
    .filter((f) => activeCategory === 'Tümü' || f.category === activeCategory)
    .sort((a, b) => {
      if (sortBy === 'price_asc') return a.priceCents - b.priceCents;
      if (sortBy === 'price_desc') return b.priceCents - a.priceCents;
      return 0;
    });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.navBar}>
        <Pressable style={s.navBack} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <Text style={s.navTitle}>Yemek Kategorileri</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Category pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.catScroll}
        style={s.catRow}
      >
        {FOOD_CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            style={[s.catPill, activeCategory === c.key && s.catPillActive]}
            onPress={() => setActiveCategory(c.key)}
          >
            <Ionicons
              name={c.icon as any}
              size={14}
              color={activeCategory === c.key ? '#fff' : '#6B5E50'}
            />
            <Text style={[s.catPillText, activeCategory === c.key && s.catPillTextActive]}>
              {c.key}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort row */}
      <View style={s.sortRow}>
        <Text style={s.resultCount}>{filtered.length} yemek</Text>
        <View style={s.sortBtns}>
          {(['default', 'price_asc', 'price_desc'] as const).map((key) => {
            const labels = { default: 'Varsayılan', price_asc: '₺ Artan', price_desc: '₺ Azalan' };
            return (
              <Pressable
                key={key}
                style={[s.sortPill, sortBy === key && s.sortPillActive]}
                onPress={() => setSortBy(key)}
              >
                <Text style={[s.sortPillText, sortBy === key && s.sortPillTextActive]}>
                  {labels[key]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Yemekler yükleniyor...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          {filtered.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="search-outline" size={52} color="#E8E2DA" />
              <Text style={s.emptyTitle}>Bu kategoride yemek yok</Text>
            </View>
          ) : (
            filtered.map((food) => (
              <Pressable
                key={food.id}
                style={s.foodCard}
                onPress={() => router.push(`/(customer)/seller/${food.sellerId}` as any)}
              >
                <View style={s.foodInitialCircle}>
                  <Text style={s.foodInitialText}>
                    {food.title.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={s.foodBody}>
                  <Text style={s.foodTitle} numberOfLines={1}>
                    {food.title}
                  </Text>
                  <Text style={s.foodDesc} numberOfLines={1}>
                    {food.description}
                  </Text>
                  <View style={s.foodMeta}>
                    <Text style={s.foodPrice}>{priceTL(food.priceCents)}</Text>
                    <Text style={s.foodSeller} numberOfLines={1}>
                      {food.sellerName}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#C4B8AA" />
              </Pressable>
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  catRow: { flexGrow: 0, backgroundColor: '#fff' },
  catScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F7F3EE',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  catPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  catPillText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  catPillTextActive: { color: '#fff' },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  resultCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },
  sortBtns: { flexDirection: 'row', gap: 6 },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F7F3EE',
  },
  sortPillActive: { backgroundColor: colors.primary },
  sortPillText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  sortPillTextActive: { color: '#fff' },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: '#A89A8A', fontWeight: '500' },

  list: { padding: 16, gap: 8 },

  foodCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  foodInitialCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  foodInitialText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  foodBody: { flex: 1, gap: 3 },
  foodTitle: { fontSize: 14, fontWeight: '700', color: '#1A1208' },
  foodDesc: { fontSize: 12, color: '#A89A8A' },
  foodMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  foodPrice: { fontSize: 14, fontWeight: '800', color: colors.primary },
  foodSeller: { fontSize: 11, color: '#6B5E50', flex: 1 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
});
