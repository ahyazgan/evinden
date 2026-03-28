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
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler.', district: 'Beşiktaş', city: 'İstanbul', rating_avg: 4.6, rating_count: 87, category: 'Ev Yemeği', emoji: '🥟', bg: '#E8F5E9', deliveryMin: 40 },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Karadeniz mutfağının eşsiz tatları: mısır ekmeği, hamsi tava, kuymak.', district: 'Üsküdar', city: 'İstanbul', rating_avg: 4.9, rating_count: 203, category: 'Ev Yemeği', emoji: '🐟', bg: '#E3F2FD', deliveryMin: 25 },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar.', district: 'Bakırköy', city: 'İstanbul', rating_avg: 4.7, rating_count: 56, category: 'Tatlı', emoji: '🎂', bg: '#FCE4EC', deliveryMin: 45 },
  { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara.', district: 'Şişli', city: 'İstanbul', rating_avg: 4.5, rating_count: 41, category: 'Izgara', emoji: '🥩', bg: '#FBE9E7', deliveryMin: 30 },
  { id: 'demo-6', display_name: 'Elif Anne Kahvaltı', bio: 'Serpme kahvaltı, gözleme ve köy kahvaltısı. Her sabah taze hazırlanır.', district: 'Sarıyer', city: 'İstanbul', rating_avg: 4.8, rating_count: 92, category: 'Kahvaltı', emoji: '🍳', bg: '#FFFDE7', deliveryMin: 25 },
];

const CATEGORIES = [
  { key: 'Tümü',      icon: '🍽️' },
  { key: 'Ev Yemeği', icon: '🍲' },
  { key: 'Kahvaltı',  icon: '🍳' },
  { key: 'Tatlı',     icon: '🍰' },
  { key: 'Izgara',    icon: '🥩' },
];

export default function ExploreScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');

  const filtered = ALL_SELLERS.filter(s => {
    const matchSearch =
      search.trim() === '' ||
      s.display_name.toLowerCase().includes(search.toLowerCase()) ||
      s.bio.toLowerCase().includes(search.toLowerCase()) ||
      s.district.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === 'Tümü' || s.category === activeCategory;
    return matchSearch && matchCat;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Keşfet</Text>
        <Text style={styles.headerSub}>{ALL_SELLERS.length} satıcı mevcut</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Satıcı, yemek veya ilçe ara..."
            placeholderTextColor="#C4B8AA"
            value={search}
            onChangeText={setSearch}
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

      {/* Results header */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filtered.length === 0
            ? 'Sonuç bulunamadı'
            : `${filtered.length} satıcı bulundu`}
        </Text>
      </View>

      {/* Results */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
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
              style={({ pressed }) => [styles.sellerCard, pressed && styles.sellerCardPressed]}
              onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
            >
              <View style={[styles.cardEmoji, { backgroundColor: seller.bg }]}>
                <Text style={styles.cardEmojiText}>{seller.emoji}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName} numberOfLines={1}>{seller.display_name}</Text>
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingText}>★ {seller.rating_avg.toFixed(1)}</Text>
                    <Text style={styles.ratingCount}> ({seller.rating_count})</Text>
                  </View>
                </View>
                <Text style={styles.cardBio} numberOfLines={2}>{seller.bio}</Text>
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
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208' },
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
  cardName: { flex: 1, fontSize: 14, fontWeight: '800', color: '#1A1208' },
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
});
