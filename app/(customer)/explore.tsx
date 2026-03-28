import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

type DemoSeller = {
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
};

const ALL_SELLERS: DemoSeller[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri.', district: 'Kadıköy', city: 'İstanbul', rating_avg: 4.8, rating_count: 124, category: 'Ev Yemeği', emoji: '🍲', bg: '#FFF3E0', deliveryMin: 30 },
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler.', district: 'Bornova', city: 'İzmir', rating_avg: 4.6, rating_count: 87, category: 'Ev Yemeği', emoji: '🥗', bg: '#E8F5E9', deliveryMin: 40 },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Karadeniz mutfağının eşsiz tatları: mısır ekmeği, hamsi tava, kuymak.', district: 'Üsküdar', city: 'İstanbul', rating_avg: 4.9, rating_count: 203, category: 'Ev Yemeği', emoji: '🐟', bg: '#E3F2FD', deliveryMin: 35 },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar.', district: 'Çankaya', city: 'Ankara', rating_avg: 4.7, rating_count: 56, category: 'Tatlı', emoji: '🎂', bg: '#FCE4EC', deliveryMin: 60 },
  { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara.', district: 'Nilüfer', city: 'Bursa', rating_avg: 4.5, rating_count: 41, category: 'Izgara', emoji: '🥩', bg: '#FBE9E7', deliveryMin: 45 },
  { id: 'demo-1', display_name: 'Naciye Teyze Börek', bio: 'Taş fırında pişirilmiş el açması börekler, her gün taze.', district: 'Beşiktaş', city: 'İstanbul', rating_avg: 4.9, rating_count: 312, category: 'Kahvaltı', emoji: '🥐', bg: '#F3E5F5', deliveryMin: 25 },
  { id: 'demo-2', display_name: 'Güneş Kahvaltı Sofrası', bio: 'Zengin serpme kahvaltı, organik ürünler, köy yumurtası.', district: 'Nişantaşı', city: 'İstanbul', rating_avg: 4.7, rating_count: 89, category: 'Kahvaltı', emoji: '🍳', bg: '#FFFDE7', deliveryMin: 50 },
];

const CATEGORIES = ['Tümü', 'Ev Yemeği', 'Kahvaltı', 'Tatlı', 'Izgara'];

export default function ExploreScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');

  const filtered = ALL_SELLERS.filter(s => {
    const matchSearch =
      search.trim() === '' ||
      s.display_name.toLowerCase().includes(search.toLowerCase()) ||
      s.bio.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === 'Tümü' || s.category === activeCategory;
    return matchSearch && matchCat;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Keşfet</Text>
        <Text style={styles.headerSub}>Tüm satıcılara göz at</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Satıcı veya yemek ara..."
            placeholderTextColor="#C4B8AA"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Text style={styles.clearBtn}>✕</Text>
            </Pressable>
          ) : null}
        </View>
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
            key={cat}
            style={[styles.catPill, activeCategory === cat && styles.catPillActive]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.catPillText, activeCategory === cat && styles.catPillTextActive]}>
              {cat}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Results */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>Sonuç bulunamadı</Text>
            <Text style={styles.emptySub}>Farklı bir arama deneyin</Text>
          </View>
        ) : (
          filtered.map((seller, idx) => (
            <Pressable
              key={seller.id + idx}
              style={styles.sellerCard}
              onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
            >
              <View style={[styles.cardEmoji, { backgroundColor: seller.bg }]}>
                <Text style={styles.cardEmojiText}>{seller.emoji}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName} numberOfLines={1}>{seller.display_name}</Text>
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingText}>⭐ {seller.rating_avg.toFixed(1)}</Text>
                  </View>
                </View>
                <Text style={styles.cardBio} numberOfLines={2}>{seller.bio}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.metaTag}>📍 {seller.district}</Text>
                  <Text style={styles.metaTag}>🕐 {seller.deliveryMin} dk</Text>
                  <View style={styles.catTag}>
                    <Text style={styles.catTagText}>{seller.category}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          ))
        )}
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
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
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
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1208' },
  clearBtn: { fontSize: 13, color: '#A89A8A', fontWeight: '700' },

  categoryRow: { flexGrow: 0, marginBottom: 16 },
  categoryScroll: { paddingHorizontal: 16, gap: 8 },
  catPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  catPillActive: {
    backgroundColor: '#1A1208',
    borderColor: '#1A1208',
  },
  catPillText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  catPillTextActive: { color: '#fff' },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  sellerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  cardEmoji: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardEmojiText: { fontSize: 28 },
  cardBody: { flex: 1, gap: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { flex: 1, fontSize: 14, fontWeight: '800', color: '#1A1208' },
  ratingBadge: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  ratingText: { fontSize: 11, fontWeight: '700', color: '#F57F17' },
  cardBio: { fontSize: 12, color: '#A89A8A', lineHeight: 17 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  metaTag: { fontSize: 11, color: '#A89A8A' },
  catTag: {
    backgroundColor: '#F5F0EA',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  catTagText: { fontSize: 10, fontWeight: '700', color: '#6B5E50' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },
});
