import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
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

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

type DemoSeller = {
  id: string;
  display_name: string;
  district: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  distance: string;
  stock: number;
  deliveryMin: number;
  menuPreview: string;
  category: string;
};

const DEMO_SELLERS: DemoSeller[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", district: 'Kadıköy', city: 'İstanbul', rating_avg: 4.8, rating_count: 124, distance: '0.6 km', stock: 6, deliveryMin: 20, menuPreview: 'Mercimek çorbası, kuru fasulye, pilav', category: 'Ev yemeği' },
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', district: 'Bornova', city: 'İzmir', rating_avg: 4.6, rating_count: 87, distance: '1.2 km', stock: 4, deliveryMin: 30, menuPreview: 'Zeytinyağlı enginar, ıspanaklı börek, dolma', category: 'Ev yemeği' },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', district: 'Üsküdar', city: 'İstanbul', rating_avg: 4.9, rating_count: 203, distance: '0.9 km', stock: 8, deliveryMin: 25, menuPreview: 'Hamsi tava, kuymak, mısır ekmeği', category: 'Ev yemeği' },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', district: 'Çankaya', city: 'Ankara', rating_avg: 4.7, rating_count: 56, distance: '2.1 km', stock: 3, deliveryMin: 45, menuPreview: 'Çikolatalı pasta, kurabiye kutusu, sütlaç', category: 'Tatlı' },
  { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', district: 'Nilüfer', city: 'Bursa', rating_avg: 4.5, rating_count: 41, distance: '1.8 km', stock: 10, deliveryMin: 35, menuPreview: 'Izgara köfte, tavuk şiş, karışık ızgara', category: 'Ev yemeği' },
];

const CATEGORIES = ['Tümü', 'Ev yemeği', 'Tatlı', 'Kahvaltı', 'Catering'];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Günaydın! Bugün ne yesek?';
  if (h >= 12 && h < 17) return 'İyi öğleden sonralar!';
  if (h >= 17 && h < 21) return 'İyi akşamlar!';
  return 'İyi geceler!';
}

export default function CustomerHomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const filtered = DEMO_SELLERS.filter(s => {
    const matchCat = activeCategory === 'Tümü' || s.category === activeCategory;
    const matchSearch =
      !search.trim() ||
      s.display_name.toLowerCase().includes(search.toLowerCase()) ||
      s.district.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Turuncu header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.locRow}>
            <View style={styles.locPin} />
            <Text style={styles.locText}>Kadıköy, İstanbul</Text>
            <Text style={styles.locArrow}>▾</Text>
          </View>
          <View style={styles.notifBtn}>
            <View style={styles.notifDot} />
          </View>
        </View>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.subGreeting}>Yakınındaki ev yemekleri seni bekliyor</Text>
      </View>

      {/* Arama */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Yemek veya satıcı ara..."
            placeholderTextColor="#AAAAAA"
            returnKeyType="search"
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* Kategori pilleri */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cats}
            >
              {CATEGORIES.map(cat => (
                <Pressable
                  key={cat}
                  style={[styles.cat, activeCategory === cat && styles.catActive]}
                  onPress={() => setActiveCategory(cat)}
                >
                  <Text style={[styles.catText, activeCategory === cat && styles.catTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Günün öne çıkanı */}
            <View style={styles.dailyBanner}>
              <Text style={styles.dailyLabel}>Bugünün öne çıkanı</Text>
              <Text style={styles.dailyTitle}>Ayşe Hanım'ın zeytinyağlı sarması</Text>
              <Text style={styles.dailySub}>Kadıköy · Sadece 6 porsiyon kaldı</Text>
            </View>

            {/* Bölüm başlığı */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Yakınındaki satıcılar</Text>
              <Text style={styles.sectionLink}>Tümünü gör</Text>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
            onPress={() => router.push(`/(customer)/seller/${item.id}`)}
          >
            {/* Görsel alanı */}
            <View style={styles.cardImg}>
              <View style={styles.cardImgPlaceholder} />
              <View style={styles.badgeApproved}>
                <Text style={styles.badgeApprovedText}>✓ Onaylı mutfak</Text>
              </View>
              <View style={styles.badgeStock}>
                <Text style={styles.badgeStockText}>{item.stock} porsiyon</Text>
              </View>
            </View>

            {/* Bilgi alanı */}
            <View style={styles.cardBody}>
              <Text style={styles.cardName}>{item.display_name}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.star}>★</Text>
                <Text style={styles.metaText}>
                  {item.rating_avg} ({item.rating_count} değerlendirme)
                </Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{item.distance}</Text>
              </View>
              <Text style={styles.menuPreview} numberOfLines={1}>
                {item.menuPreview}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.deliveryText}>~{item.deliveryMin} dk · Teslimat dahil</Text>
                <Pressable
                  style={styles.orderBtn}
                  onPress={() => router.push(`/(customer)/seller/${item.id}`)}
                >
                  <Text style={styles.orderBtnText}>Sipariş ver</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyTitle}>Sonuç bulunamadı</Text>
            <Text style={styles.emptyBody}>Farklı bir kategori veya arama deneyin.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locPin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  locText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  locArrow: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  notifBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  greeting: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 3 },
  subGreeting: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },

  searchWrap: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  searchBar: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 0.5,
    borderColor: '#E8E4DD',
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 13, color: '#2D2D2D' },

  list: { paddingBottom: 24 },

  cats: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  cat: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#E8E4DD',
    backgroundColor: '#fff',
  },
  catActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catText: { fontSize: 12, fontWeight: '500', color: '#777' },
  catTextActive: { color: '#fff' },

  dailyBanner: {
    marginHorizontal: 16,
    backgroundColor: '#FAEEDA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#EF9F27',
  },
  dailyLabel: { fontSize: 11, fontWeight: '600', color: '#854F0B', marginBottom: 2 },
  dailyTitle: { fontSize: 13, fontWeight: '700', color: '#412402' },
  dailySub: { fontSize: 11, color: '#854F0B', marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#2D2D2D' },
  sectionLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#F0EBE3',
    overflow: 'hidden',
  },
  cardImg: {
    height: 100,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardImgPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    opacity: 0.25,
  },
  badgeApproved: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#E1F5EE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#5DCAA5',
  },
  badgeApprovedText: { fontSize: 10, fontWeight: '600', color: '#085041' },
  badgeStock: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FAEEDA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeStockText: { fontSize: 10, fontWeight: '600', color: '#633806' },

  cardBody: { padding: 12 },
  cardName: { fontSize: 14, fontWeight: '700', color: '#2D2D2D', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5 },
  star: { fontSize: 12, color: colors.amber },
  metaText: { fontSize: 11, color: '#888' },
  metaDot: { fontSize: 11, color: '#CCCCCC' },
  menuPreview: { fontSize: 12, color: '#888', marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deliveryText: { fontSize: 11, color: '#AAAAAA' },
  orderBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  orderBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#2D2D2D', marginTop: 12 },
  emptyBody: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 6 },
});
