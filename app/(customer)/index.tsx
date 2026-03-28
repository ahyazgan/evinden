import { useState } from 'react';
import {
  FlatList,
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
import { useAuth } from '@/lib/auth-context';

type DemoSeller = {
  id: string;
  display_name: string;
  short_name: string;
  district: string;
  rating: number;
  distance: string;
  deliveryMin: number;
  startingPrice: number;
  emoji: string;
  bgColor: string;
  tags: string[];
  category: string;
};

const DEMO_SELLERS: DemoSeller[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", short_name: 'Ayşe H.', district: 'Kadıköy', rating: 4.8, distance: '1.5 km', deliveryMin: 20, startingPrice: 6500, emoji: '🍲', bgColor: '#F5EDE4', tags: ['Ev yemeği', 'Çorba', 'Pilav'], category: 'Ev yemeği' },
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', short_name: 'Fatma H.', district: 'Moda', rating: 4.9, distance: '0.8 km', deliveryMin: 25, startingPrice: 8500, emoji: '🥘', bgColor: '#E8F5EE', tags: ['Zeytinyağlı', 'Çorba', 'Tatlı'], category: 'Ev yemeği' },
  { id: 'demo-3', display_name: 'Zeynep Hanım', short_name: 'Zeynep H.', district: 'Moda', rating: 4.7, distance: '1.2 km', deliveryMin: 30, startingPrice: 12000, emoji: '🥙', bgColor: '#FFF5F2', tags: ['Mantı', 'Börek'], category: 'Ev yemeği' },
  { id: 'demo-4', display_name: 'Mehmet Usta Karadeniz', short_name: 'Mehmet U.', district: 'Üsküdar', rating: 4.9, distance: '0.9 km', deliveryMin: 25, startingPrice: 11000, emoji: '🐟', bgColor: '#EEF5FF', tags: ['Balık', 'Karadeniz'], category: 'Ev yemeği' },
  { id: 'demo-5', display_name: 'Zeynep Pasta & Tatlı', short_name: 'Zeynep P.', district: 'Çankaya', rating: 4.7, distance: '2.1 km', deliveryMin: 45, startingPrice: 15000, emoji: '🎂', bgColor: '#FFF0F8', tags: ['Pasta', 'Tatlı'], category: 'Tatlı' },
];

const CATEGORIES = [
  { label: 'Ev yemeği', emoji: '🍲', color: '#FFF5F2' },
  { label: 'Kahvaltı', emoji: '🥐', color: '#F0FFF8' },
  { label: 'Tatlı', emoji: '🍮', color: '#FFF8EC' },
  { label: 'Pasta', emoji: '🎂', color: '#F5F0FF' },
  { label: 'Catering', emoji: '🍱', color: '#FFF0F5' },
];

function priceTL(cents: number): string {
  return `${(cents / 100).toFixed(0)}₺`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Günaydın,\nbugün ne yesek?';
  if (h >= 12 && h < 17) return 'Öğle vakti,\nne yesek?';
  if (h >= 17 && h < 21) return 'Akşam oldu,\nne yesek?';
  return 'Gece geç,\nne yesek?';
}

export default function CustomerHomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Ev yemeği');

  const filtered = DEMO_SELLERS.filter(s =>
    (activeCategory === 'Tümü' || s.category === activeCategory) &&
    (!search.trim() || s.display_name.toLowerCase().includes(search.toLowerCase())),
  );

  const initial = profile?.name?.charAt(0).toUpperCase() ?? 'M';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Üst bar ── */}
        <View style={styles.topBar}>
          <View style={styles.locRow}>
            <View style={styles.locPin} />
            <Text style={styles.locName}>Kadıköy, Moda</Text>
            <Text style={styles.locArr}>▾</Text>
          </View>
          <View style={styles.topRight}>
            <View style={styles.notif}>
              <View style={styles.notifDot} />
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          </View>
        </View>

        {/* ── Selam ── */}
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.subGreeting}>26 onaylı satıcı yakında</Text>

        {/* ── Arama ── */}
        <View style={styles.searchBar}>
          <View style={styles.searchCircle} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Yemek veya satıcı ara..."
            placeholderTextColor="#C8B8A8"
          />
          <View style={styles.filterBtn}>
            <View style={styles.filterDot} />
          </View>
        </View>

        {/* ── Turuncu banner ── */}
        <View style={styles.banner}>
          <View style={styles.bannerCircle1} />
          <View style={styles.bannerCircle2} />
          <Text style={styles.bannerTag}>Bugün öne çıkan</Text>
          <Text style={styles.bannerTitle}>{"Fatma Hanım'ın\nözel sarması"}</Text>
          <Pressable
            style={styles.bannerBtn}
            onPress={() => router.push('/(customer)/seller/demo-2')}
          >
            <Text style={styles.bannerBtnText}>Sipariş ver →</Text>
          </Pressable>
          <View style={styles.bannerDots}>
            <View style={[styles.bdot, styles.bdotActive]} />
            <View style={styles.bdot} />
            <View style={styles.bdot} />
          </View>
        </View>

        {/* ── Kategoriler ── */}
        <Text style={styles.secTitle}>Kategoriler</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catsRow}
        >
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.label}
              style={styles.catItem}
              onPress={() => setActiveCategory(cat.label)}
            >
              <View style={[
                styles.catIcon,
                { backgroundColor: cat.color },
                activeCategory === cat.label && styles.catIconActive,
              ]}>
                <Text style={{ fontSize: 22 }}>{cat.emoji}</Text>
              </View>
              <Text style={[
                styles.catLabel,
                activeCategory === cat.label && styles.catLabelActive,
              ]}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Öne çıkan ürün ── */}
        <Pressable
          style={styles.special}
          onPress={() => router.push('/(customer)/seller/demo-2')}
        >
          <View style={styles.specialImg}>
            <Text style={{ fontSize: 32 }}>🥘</Text>
            <View style={styles.specialBadge}>
              <Text style={styles.specialBadgeText}>6 kaldı</Text>
            </View>
          </View>
          <View style={styles.specialInfo}>
            <Text style={styles.specialTag}>Hızlı teslimat · ~20 dk</Text>
            <Text style={styles.specialName}>Zeytinyağlı sarma</Text>
            <Text style={styles.specialSeller}>Fatma Hanım · Moda</Text>
            <View style={styles.specialRow}>
              <Text style={styles.specialPrice}>85₺</Text>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Canlı</Text>
              </View>
            </View>
          </View>
        </Pressable>

        {/* ── Popüler bu hafta ── */}
        <View style={styles.secHead}>
          <Text style={styles.secTitle}>Popüler bu hafta</Text>
          <Text style={styles.secLink}>Tümü →</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hscroll}
        >
          {DEMO_SELLERS.slice(0, 3).map(s => (
            <Pressable
              key={s.id}
              style={styles.hcard}
              onPress={() => router.push(`/(customer)/seller/${s.id}`)}
            >
              <View style={[styles.hcardImg, { backgroundColor: s.bgColor }]}>
                <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
                <View style={styles.hcardOk}>
                  <Text style={styles.hcardOkText}>✓ Onaylı</Text>
                </View>
              </View>
              <View style={styles.hcardBody}>
                <Text style={styles.hcardName}>{s.short_name}</Text>
                <Text style={styles.hcardMeta}>★ {s.rating} · {s.distance}</Text>
                <Text style={styles.hcardPrice}>{priceTL(s.startingPrice)}'den</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Yakınındaki satıcılar ── */}
        <View style={styles.secHead}>
          <Text style={styles.secTitle}>Yakınındaki satıcılar</Text>
          <Text style={styles.secLink}>Haritada gör →</Text>
        </View>

        {filtered.map(s => (
          <Pressable
            key={s.id}
            style={styles.vc}
            onPress={() => router.push(`/(customer)/seller/${s.id}`)}
          >
            <View style={[styles.vcImg, { backgroundColor: s.bgColor }]}>
              <Text style={{ fontSize: 24 }}>{s.emoji}</Text>
            </View>
            <View style={styles.vcInfo}>
              <Text style={styles.vcName}>{s.display_name}</Text>
              <Text style={styles.vcMeta}>{s.distance} · ~{s.deliveryMin} dk · Teslimat dahil</Text>
              <View style={styles.vcTags}>
                {s.tags.slice(0, 3).map(t => (
                  <View key={t} style={styles.vtg}>
                    <Text style={styles.vtgText}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.vcRight}>
              <Text style={styles.vcRating}><Text style={styles.vcStar}>★</Text> {s.rating}</Text>
              <Pressable style={styles.vcBtn} onPress={() => router.push(`/(customer)/seller/${s.id}`)}>
                <Text style={styles.vcBtnText}>Sipariş</Text>
              </Pressable>
              <View style={styles.vcOk}>
                <Text style={styles.vcOkText}>Onaylı</Text>
              </View>
            </View>
          </Pressable>
        ))}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { padding: 18, paddingBottom: 32 },

  // Üst bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locPin: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  locName: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  locArr: { fontSize: 10, color: '#A89A8A', marginLeft: 1 },
  topRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  notif: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE8E2', alignItems: 'center', justifyContent: 'center' },
  notifDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Selam
  greeting: { fontSize: 22, fontWeight: '700', color: '#1A1208', lineHeight: 28, marginBottom: 3, fontFamily: 'serif' },
  subGreeting: { fontSize: 11, color: '#A89A8A', marginBottom: 14 },

  // Arama
  searchBar: { backgroundColor: '#fff', borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#EDE8E2', marginBottom: 14 },
  searchCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#C8B8A8' },
  searchInput: { flex: 1, fontSize: 12, color: '#1A1208' },
  filterBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#FAF7F2', borderWidth: 1, borderColor: '#EDE8E2', alignItems: 'center', justifyContent: 'center' },
  filterDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#A89A8A', shadowOffset: { width: 0, height: 5 }, shadowColor: '#A89A8A', shadowOpacity: 1 },

  // Banner
  banner: { backgroundColor: colors.primary, borderRadius: 18, padding: 16, marginBottom: 16, height: 100, justifyContent: 'center', overflow: 'hidden', position: 'relative' },
  bannerCircle1: { position: 'absolute', right: -10, top: -10, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.07)' },
  bannerCircle2: { position: 'absolute', right: 20, bottom: -20, width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.05)' },
  bannerTag: { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#fff', lineHeight: 20, marginBottom: 8, fontFamily: 'serif' },
  bannerBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start' },
  bannerBtnText: { fontSize: 10, color: '#fff', fontWeight: '500' },
  bannerDots: { position: 'absolute', bottom: 12, right: 14, flexDirection: 'row', gap: 4 },
  bdot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  bdotActive: { width: 14, backgroundColor: '#fff' },

  // Kategoriler
  catsRow: { gap: 10, paddingBottom: 4, marginBottom: 14 },
  catItem: { alignItems: 'center', gap: 5 },
  catIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  catIconActive: { borderColor: colors.primary },
  catLabel: { fontSize: 10, color: '#7A6A5A', fontWeight: '500' },
  catLabelActive: { color: colors.primary },

  // Öne çıkan
  special: { backgroundColor: '#fff', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#EDE8E2', flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 16 },
  specialImg: { width: 70, height: 70, borderRadius: 14, backgroundColor: '#F5EDE4', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  specialBadge: { position: 'absolute', bottom: -5, right: -5, backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1.5, borderColor: '#FAF7F2' },
  specialBadgeText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  specialInfo: { flex: 1 },
  specialTag: { fontSize: 9, fontWeight: '600', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 3 },
  specialName: { fontSize: 14, fontWeight: '700', color: '#1A1208', marginBottom: 2, fontFamily: 'serif' },
  specialSeller: { fontSize: 10, color: '#A89A8A', marginBottom: 6 },
  specialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  specialPrice: { fontSize: 14, fontWeight: '600', color: colors.primary },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.success },
  liveText: { fontSize: 10, color: '#A89A8A' },

  // Bölüm başlıkları
  secHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  secTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208', fontFamily: 'serif', marginBottom: 10 },
  secLink: { fontSize: 11, color: colors.primary, fontWeight: '500' },

  // Yatay scroll kartlar
  hscroll: { gap: 10, paddingBottom: 4, marginBottom: 16 },
  hcard: { width: 130, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#EDE8E2' },
  hcardImg: { height: 80, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  hcardOk: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(250,247,242,0.95)', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#9FE1CB' },
  hcardOkText: { fontSize: 9, color: '#085041', fontWeight: '600' },
  hcardBody: { padding: 8 },
  hcardName: { fontSize: 12, fontWeight: '700', color: '#1A1208', marginBottom: 1, fontFamily: 'serif' },
  hcardMeta: { fontSize: 9, color: '#A89A8A' },
  hcardPrice: { fontSize: 11, fontWeight: '600', color: colors.primary, marginTop: 4 },

  // Dikey satıcı kartları
  vc: { backgroundColor: '#fff', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: '#EDE8E2', marginBottom: 8 },
  vcImg: { width: 56, height: 56, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  vcInfo: { flex: 1 },
  vcName: { fontSize: 13, fontWeight: '700', color: '#1A1208', marginBottom: 2, fontFamily: 'serif' },
  vcMeta: { fontSize: 10, color: '#A89A8A', marginBottom: 5 },
  vcTags: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  vtg: { backgroundColor: '#FAF7F2', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#EDE8E2' },
  vtgText: { fontSize: 9, color: '#7A6A5A' },
  vcRight: { alignItems: 'flex-end', justifyContent: 'space-between' },
  vcRating: { fontSize: 11, fontWeight: '600', color: '#1A1208' },
  vcStar: { color: colors.amber },
  vcBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  vcBtnText: { fontSize: 10, color: '#fff', fontWeight: '600' },
  vcOk: { backgroundColor: '#E1F5EE', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#9FE1CB' },
  vcOkText: { fontSize: 9, color: '#085041', fontWeight: '500' },
});
