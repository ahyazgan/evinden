import { useState } from 'react';
import {
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

type FoodItem = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerEmoji: string;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  badge?: string;
  deliveryMin: number;
};

const ALL_FOODS: FoodItem[] = [
  // demo-1
  { id: 'm1-1', sellerId: 'demo-1', sellerName: "Ayşe'nin Ev Yemekleri", sellerEmoji: '🍲', title: 'Mercimek Çorbası', description: 'Günlük taze kırmızı mercimek çorbası', priceCents: 4500, category: 'Çorbalar', badge: 'popular', deliveryMin: 30 },
  { id: 'm1-2', sellerId: 'demo-1', sellerName: "Ayşe'nin Ev Yemekleri", sellerEmoji: '🍲', title: 'Kuru Fasulye + Pilav', description: 'Geleneksel tarif, tereyağlı pirinç pilavı', priceCents: 8000, category: 'Ana Yemekler', badge: 'popular', deliveryMin: 30 },
  { id: 'm1-3', sellerId: 'demo-1', sellerName: "Ayşe'nin Ev Yemekleri", sellerEmoji: '🍲', title: 'İzmir Köfte', description: 'Domates soslu fırın köfte', priceCents: 9500, category: 'Ana Yemekler', deliveryMin: 30 },
  { id: 'm1-4', sellerId: 'demo-1', sellerName: "Ayşe'nin Ev Yemekleri", sellerEmoji: '🍲', title: 'Karışık Salata', description: 'Mevsim yeşillikleri', priceCents: 3500, category: 'Salatalar', deliveryMin: 30 },
  // demo-2
  { id: 'm2-1', sellerId: 'demo-2', sellerName: 'Fatma Hanım Mutfağı', sellerEmoji: '🥟', title: 'Zeytinyağlı Enginar', description: 'Taze enginar, havuç ve bezelye', priceCents: 7000, category: 'Zeytinyağlılar', badge: 'popular', deliveryMin: 40 },
  { id: 'm2-2', sellerId: 'demo-2', sellerName: 'Fatma Hanım Mutfağı', sellerEmoji: '🥟', title: 'Ispanaklı Börek', description: 'El açması yufka, lor peyniri', priceCents: 6500, category: 'Börekler', deliveryMin: 40 },
  { id: 'm2-3', sellerId: 'demo-2', sellerName: 'Fatma Hanım Mutfağı', sellerEmoji: '🥟', title: 'Zeytinyağlı Dolma', description: 'Fıstıklı ve kuş üzümlü', priceCents: 7500, category: 'Zeytinyağlılar', badge: 'new', deliveryMin: 40 },
  // demo-3
  { id: 'm3-1', sellerId: 'demo-3', sellerName: 'Mehmet Usta Karadeniz', sellerEmoji: '🐟', title: 'Hamsi Tava', description: 'Taze hamsi, mısır ununda', priceCents: 11000, category: 'Ana Yemekler', badge: 'popular', deliveryMin: 25 },
  { id: 'm3-2', sellerId: 'demo-3', sellerName: 'Mehmet Usta Karadeniz', sellerEmoji: '🐟', title: 'Kuymak', description: 'Mısır unu ve kaşar peyniri', priceCents: 8500, category: 'Ana Yemekler', deliveryMin: 25 },
  { id: 'm3-4', sellerId: 'demo-3', sellerName: 'Mehmet Usta Karadeniz', sellerEmoji: '🐟', title: 'Karalahana Çorbası', description: 'Geleneksel Karadeniz usulü', priceCents: 5000, category: 'Çorbalar', badge: 'new', deliveryMin: 25 },
  // demo-4
  { id: 'm4-1', sellerId: 'demo-4', sellerName: 'Zeynep Pasta & Tatlı', sellerEmoji: '🎂', title: 'Çikolatalı Yaş Pasta', description: 'Bitter çikolata ganajlı', priceCents: 35000, category: 'Pastalar', badge: 'popular', deliveryMin: 45 },
  { id: 'm4-2', sellerId: 'demo-4', sellerName: 'Zeynep Pasta & Tatlı', sellerEmoji: '🎂', title: 'Kurabiye Kutusu', description: '12 adet karışık el yapımı', priceCents: 15000, category: 'Tatlılar', deliveryMin: 45 },
  { id: 'm4-3', sellerId: 'demo-4', sellerName: 'Zeynep Pasta & Tatlı', sellerEmoji: '🎂', title: 'Fırın Sütlaç', description: 'Geleneksel fırında pişirilmiş', priceCents: 8000, category: 'Tatlılar', badge: 'new', deliveryMin: 45 },
  // demo-5
  { id: 'm5-1', sellerId: 'demo-5', sellerName: 'Hüseyin Bey Izgara', sellerEmoji: '🥩', title: 'Izgara Köfte', description: 'El yapımı dana köfte, mangalda', priceCents: 12000, category: 'Izgaralar', badge: 'popular', deliveryMin: 30 },
  { id: 'm5-2', sellerId: 'demo-5', sellerName: 'Hüseyin Bey Izgara', sellerEmoji: '🥩', title: 'Tavuk Şiş', description: '3 şiş marine tavuk', priceCents: 13500, category: 'Izgaralar', deliveryMin: 30 },
  { id: 'm5-3', sellerId: 'demo-5', sellerName: 'Hüseyin Bey Izgara', sellerEmoji: '🥩', title: 'Karışık Izgara Tabağı', description: 'Köfte, tavuk şiş, kanat', priceCents: 18000, category: 'Izgaralar', deliveryMin: 30 },
  // demo-6
  { id: 'm6-1', sellerId: 'demo-6', sellerName: 'Elif Anne Kahvaltı', sellerEmoji: '🍳', title: 'Serpme Kahvaltı', description: 'Peynir, zeytin, bal, kaymak', priceCents: 25000, category: 'Kahvaltılar', badge: 'popular', deliveryMin: 25 },
  { id: 'm6-2', sellerId: 'demo-6', sellerName: 'Elif Anne Kahvaltı', sellerEmoji: '🍳', title: 'Gözleme', description: 'El açması yufka', priceCents: 6000, category: 'Hamur İşleri', deliveryMin: 25 },
  { id: 'm6-3', sellerId: 'demo-6', sellerName: 'Elif Anne Kahvaltı', sellerEmoji: '🍳', title: 'Menemen', description: 'Domates, biber ve yumurta', priceCents: 5500, category: 'Kahvaltılar', deliveryMin: 25 },
];

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

  const filtered = ALL_FOODS
    .filter(f => activeCategory === 'Tümü' || f.category === activeCategory)
    .sort((a, b) => {
      if (sortBy === 'price_asc') return a.priceCents - b.priceCents;
      if (sortBy === 'price_desc') return b.priceCents - a.priceCents;
      return 0;
    });

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

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
        {FOOD_CATEGORIES.map(c => (
          <Pressable
            key={c.key}
            style={[s.catPill, activeCategory === c.key && s.catPillActive]}
            onPress={() => setActiveCategory(c.key)}
          >
            <Ionicons name={c.icon as any} size={14} color={activeCategory === c.key ? '#fff' : '#6B5E50'} />
            <Text style={[s.catPillText, activeCategory === c.key && s.catPillTextActive]}>{c.key}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Sort row */}
      <View style={s.sortRow}>
        <Text style={s.resultCount}>{filtered.length} yemek</Text>
        <View style={s.sortBtns}>
          {(['default', 'price_asc', 'price_desc'] as const).map(key => {
            const labels = { default: 'Varsayılan', price_asc: '₺ Artan', price_desc: '₺ Azalan' };
            return (
              <Pressable key={key} style={[s.sortPill, sortBy === key && s.sortPillActive]} onPress={() => setSortBy(key)}>
                <Text style={[s.sortPillText, sortBy === key && s.sortPillTextActive]}>{labels[key]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="search-outline" size={52} color="#E8E2DA" />
            <Text style={s.emptyTitle}>Bu kategoride yemek yok</Text>
          </View>
        ) : (
          filtered.map(food => (
            <Pressable
              key={food.id}
              style={s.foodCard}
              onPress={() => router.push(`/(customer)/seller/${food.sellerId}` as any)}
            >
              <View style={s.foodEmoji}>
                <Text style={s.foodEmojiText}>{food.sellerEmoji}</Text>
              </View>
              <View style={s.foodBody}>
                <View style={s.foodTitleRow}>
                  <Text style={s.foodTitle} numberOfLines={1}>{food.title}</Text>
                  {food.badge === 'popular' && <View style={[s.foodBadge, { backgroundColor: '#FFF3E0' }]}><Text style={[s.foodBadgeText, { color: '#E65100' }]}>🔥</Text></View>}
                  {food.badge === 'new' && <View style={[s.foodBadge, { backgroundColor: '#E8F5E9' }]}><Text style={[s.foodBadgeText, { color: '#2E7D32' }]}>✨</Text></View>}
                </View>
                <Text style={s.foodDesc} numberOfLines={1}>{food.description}</Text>
                <View style={s.foodMeta}>
                  <Text style={s.foodPrice}>{priceTL(food.priceCents)}</Text>
                  <Text style={s.foodSeller}>{food.sellerName}</Text>
                  <Text style={s.foodTime}>{food.deliveryMin} dk</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#C4B8AA" />
            </Pressable>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  navBack: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  catRow: { flexGrow: 0, backgroundColor: '#fff' },
  catScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#F7F3EE', borderWidth: 1, borderColor: '#EDE8E2',
  },
  catPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  catPillText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  catPillTextActive: { color: '#fff' },

  sortRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  resultCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },
  sortBtns: { flexDirection: 'row', gap: 6 },
  sortPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F7F3EE' },
  sortPillActive: { backgroundColor: colors.primary },
  sortPillText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  sortPillTextActive: { color: '#fff' },

  list: { padding: 16, gap: 8 },

  foodCard: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#EDE8E2',
    padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  foodEmoji: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: '#FAF7F2',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  foodEmojiText: { fontSize: 24 },
  foodBody: { flex: 1, gap: 3 },
  foodTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  foodTitle: { fontSize: 14, fontWeight: '700', color: '#1A1208', flex: 1 },
  foodBadge: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  foodBadgeText: { fontSize: 10 },
  foodDesc: { fontSize: 12, color: '#A89A8A' },
  foodMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  foodPrice: { fontSize: 14, fontWeight: '800', color: colors.primary },
  foodSeller: { fontSize: 11, color: '#6B5E50', flex: 1 },
  foodTime: { fontSize: 11, color: '#A89A8A' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
});
