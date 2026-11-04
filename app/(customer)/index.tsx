import { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { getSavedLocation } from '@/components/shared/LocationPicker';
import { HomeScreenSkeleton } from '@/components/shared/Skeleton';
import { useTheme } from '@/lib/theme-context';
import { isOpenAt, istanbulClock } from '@/lib/date';
import { haversineKm, isInDeliveryArea } from '@/lib/geo';
import { fetchSellerCampaignMap, type CouponRow, type SellerHourRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import FoodImage from '@/components/shared/FoodImage';
import { CATEGORY_IMAGES, sellerPhoto } from '@/lib/food-images';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerRow = {
  id: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  rating_avg: number;
  rating_count: number;
  is_active: boolean;
  is_paused?: boolean;
  seller_hours?: SellerHourRow[];
  menu_items: { count: number }[];
  logo_url?: string | null;
  cover_url?: string | null;
  delivery_fee_cents?: number;
  seller_type?: 'home' | 'restaurant';
  min_order_cents?: number;
  delivery_time_min?: number;
  delivery_time_max?: number;
  delivery_radius_km?: number;
};

// ─── Categories ───────────────────────────────────────────────────────────────

/** Dokununca o kategorideki yemekler açılır (food-category ekranı). */
const CATEGORIES = [
  { id: 'ev', label: 'Ev Yemeği', cat: 'Ana Yemekler', image: CATEGORY_IMAGES.ev },
  { id: 'borek', label: 'Börek', cat: 'Börekler', image: CATEGORY_IMAGES.borek },
  { id: 'izgara', label: 'Izgara', cat: 'Izgaralar', image: CATEGORY_IMAGES.izgara },
  { id: 'tatli', label: 'Tatlı', cat: 'Tatlılar', image: CATEGORY_IMAGES.tatli },
  { id: 'kahvalti', label: 'Kahvaltı', cat: 'Kahvaltılar', image: CATEGORY_IMAGES.kahvalti },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

function fmtRating(seller: SellerRow): string {
  return seller.rating_count > 0 ? Number(seller.rating_avg).toFixed(1).replace('.', ',') : 'Yeni';
}

function fmtLira(cents: number): string {
  return `₺${(cents / 100).toFixed(0)}`;
}

/** "Ev yemeği · 25-40 dk · Teslimat ₺15" */
function sellerMeta(seller: SellerRow): string {
  const type = seller.seller_type === 'restaurant' ? 'Restoran' : 'Ev yemeği';
  const time = `${seller.delivery_time_min ?? 25}-${seller.delivery_time_max ?? 40} dk`;
  const fee = seller.delivery_fee_cents;
  const delivery = fee == null ? null : fee === 0 ? 'Ücretsiz teslimat' : `Teslimat ${fmtLira(fee)}`;
  return [type, time, delivery].filter(Boolean).join(' · ');
}

/** Kartın üstündeki kampanya etiketi: "%15 indirim: KOMSU15" */
function campaignLabel(c: CouponRow): string {
  if (c.discount_type === 'free_delivery') return 'Ücretsiz teslimat';
  const what = c.discount_type === 'percent' ? `%${c.discount_value} indirim` : `${fmtLira(c.discount_value)} indirim`;
  return `${what}: ${c.code}`;
}

// ─── Category Tile ────────────────────────────────────────────────────────────

function CategoryTile({ item, onPress }: { item: typeof CATEGORIES[0]; onPress: () => void }) {
  const { colors: t } = useTheme();
  return (
    <Pressable style={s.catTile} onPress={onPress} accessibilityRole="button" accessibilityLabel={item.label}>
      <Image source={item.image} style={[s.catImage, { borderColor: t.surfaceBorder }]} resizeMode="cover" />
      <Text style={[s.catLabel, { color: t.text }]} numberOfLines={1}>{item.label}</Text>
    </Pressable>
  );
}

// ─── Rating ───────────────────────────────────────────────────────────────────

function Rating({ seller }: { seller: SellerRow }) {
  const { colors: t } = useTheme();
  return (
    <View style={s.rating}>
      <Ionicons name="star" size={14} color="#E8A317" />
      <Text style={[s.ratingNum, { color: t.text }]}>{fmtRating(seller)}</Text>
    </View>
  );
}

// ─── Seller Card (büyük kapak fotoğraflı) ─────────────────────────────────────

function SellerCard({ seller, campaign, index = 0, width, onPress }: { seller: SellerRow; campaign?: CouponRow; index?: number; width?: number; onPress: () => void }) {
  const { colors: t } = useTheme();
  const open = !seller.is_paused && isOpenAt(seller.seller_hours ?? [], istanbulClock());

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(350)} style={width ? { width } : undefined}>
      <Pressable
        style={({ pressed }) => [s.sellerCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, pressed && s.sellerCardPressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={seller.display_name}
      >
        <View style={s.sellerCover}>
          <FoodImage imageUrl={sellerPhoto(seller)} height={152} borderRadius={0} style={s.coverFill} />
          {!open ? (
            <View style={s.closedOverlay}>
              <Text style={s.closedText}>Şu an kapalı</Text>
            </View>
          ) : campaign ? (
            <View style={[s.badge, campaign.discount_type === 'free_delivery' && s.badgeGreen]}>
              <Text style={s.badgeText}>{campaignLabel(campaign)}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.sellerBody}>
          <View style={s.sellerRow1}>
            <Text style={[s.sellerName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
            <Rating seller={seller} />
          </View>
          <Text style={[s.sellerMeta, { color: t.textSecondary }]} numberOfLines={1}>{sellerMeta(seller)}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CustomerHomeScreen() {
  const { profile } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const { requireAuth } = useRequireAuth();
  const [search, setSearch] = useState('');
  const [sellerTab, setSellerTab] = useState<'home' | 'restaurant'>('home');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('Konum seçin');
  const [campaigns, setCampaigns] = useState<Record<string, CouponRow>>({});

  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('light-content');
      return () => StatusBar.setBarStyle('default');
    }, []),
  );

  useEffect(() => {
    requestLocation();
    loadSellers();
    fetchSellerCampaignMap().then(setCampaigns).catch(() => {});
  }, []);

  async function requestLocation() {
    // Check saved location first
    const saved = await getSavedLocation();
    if (saved) {
      setLocationName(`${saved.district}, ${saved.city}`);
      if (saved.latitude && saved.longitude) {
        setUserLat(saved.latitude);
        setUserLon(saved.longitude);
      }
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Promise.race<Location.LocationObject>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      setUserLat(loc.coords.latitude);
      setUserLon(loc.coords.longitude);
      const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (addr) {
        const parts = [addr.subregion ?? addr.district, addr.city].filter(Boolean);
        if (parts.length > 0) setLocationName(parts.join(', '));
      }
    } catch {}
  }

  async function loadSellers() {
    try {
      const { data, error } = await supabase
        .from('sellers')
        .select('*, menu_items(count), seller_hours(*)')
        .eq('is_active', true)
        .order('rating_avg', { ascending: false });
      if (!error && data) {
        setSellers(data as SellerRow[]);
      }
    } catch {
      // Keep empty
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadSellers(), fetchSellerCampaignMap().then(setCampaigns).catch(() => {})]);
    setRefreshing(false);
  }

  const userCoords = userLat != null && userLon != null ? { latitude: userLat, longitude: userLon } : null;
  // Teslimat alanı dışındaki satıcılar listelenmez; konum bilinmiyorsa hepsi görünür.
  const tabSellers = sellers.filter(
    seller => (seller.seller_type ?? 'home') === sellerTab && isInDeliveryArea(seller, userCoords),
  );

  const filtered = tabSellers.filter(seller => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        seller.display_name.toLowerCase().includes(q) ||
        (seller.bio ?? '').toLowerCase().includes(q) ||
        (seller.district ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (userLat == null || userLon == null) return 0;
    const da = a.latitude != null ? haversineKm(userLat, userLon, a.latitude, a.longitude!) : 9999;
    const db = b.latitude != null ? haversineKm(userLat, userLon, b.latitude, b.longitude!) : 9999;
    return da - db;
  });

  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: t.background }]} edges={['top']}>
        <HomeScreenSkeleton />
      </SafeAreaView>
    );
  }

  const goSeller = (id: string) => router.push(`/(customer)/seller/${id}` as any);
  const listTitle = search.trim() ? 'Arama sonuçları' : sellerTab === 'home' ? 'Yakınındaki mutfaklar' : 'Yakınındaki restoranlar';

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.brand }]} edges={['top']}>
      <ScrollView
        style={{ backgroundColor: t.background }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Üst çekince yeşil zemin devam etsin */}
        <View style={[s.overscroll, { backgroundColor: t.brand }]} />

        {/* YEŞİL BAŞLIK */}
        <View style={[s.hero, { backgroundColor: t.brand }]}>
          <View style={s.heroTop}>
            <Pressable style={s.heroBtn} onPress={() => router.push('/(customer)/profile' as any)} accessibilityRole="button" accessibilityLabel="Profil">
              <Text style={s.heroBtnText}>{initial}</Text>
            </Pressable>
            <View style={s.locWrap}>
              <Text style={s.locLabel}>Teslimat adresi</Text>
              <View style={s.locRow}>
                <Ionicons name="location" size={14} color="#fff" />
                <Text style={s.locName} numberOfLines={1}>{locationName}</Text>
              </View>
            </View>
            <Pressable style={s.heroBtn} onPress={() => router.push('/(customer)/notifications' as any)} accessibilityRole="button" accessibilityLabel="Bildirimler">
              <Ionicons name="notifications-outline" size={20} color="#fff" />
            </Pressable>
          </View>

          <Pressable style={s.promo} onPress={() => { if (requireAuth()) router.push('/(customer)/loyalty' as any); }} accessibilityRole="button" accessibilityLabel="Davet koduyla 15 lira indirim">
            <View style={s.promoText}>
              <Text style={s.promoTitle}>₺15 indirim</Text>
              <Text style={s.promoSub}>Davet koduyla, ₺50 ve üzeri siparişte</Text>
            </View>
            <Image source={CATEGORY_IMAGES.izgara} style={s.promoImage} resizeMode="cover" />
          </Pressable>

          <View style={s.searchWrap}>
            <View style={s.searchBar}>
              <Ionicons name="search" size={18} color="#56605A" />
              <TextInput
                style={s.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Yemek veya satıcı ara"
                placeholderTextColor="#6B766F"
                returnKeyType="search"
                accessibilityLabel="Ara"
              />
              {search.length > 0 ? (
                <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
                  <Ionicons name="close-circle" size={20} color="#6B766F" />
                </Pressable>
              ) : null}
            </View>
            <Pressable style={s.filterBtn} onPress={() => router.push('/(customer)/explore' as any)} accessibilityRole="button" accessibilityLabel="Filtrele">
              <Ionicons name="options-outline" size={20} color="#151A16" />
            </Pressable>
          </View>
        </View>

        {/* EV YEMEĞİ / RESTORAN */}
        <View style={s.tabRow}>
          {(['home', 'restaurant'] as const).map(tab => {
            const active = sellerTab === tab;
            return (
              <Pressable
                key={tab}
                style={[s.tabBtn, { backgroundColor: active ? t.brand : t.chip }]}
                onPress={() => setSellerTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[s.tabText, { color: active ? '#fff' : t.text }]}>
                  {tab === 'home' ? 'Ev Yemeği' : 'Restoran'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* KATEGORİLER */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
          {CATEGORIES.map(cat => (
            <CategoryTile
              key={cat.id}
              item={cat}
              onPress={() => router.push({ pathname: '/(customer)/food-category', params: { cat: cat.cat } } as any)}
            />
          ))}
        </ScrollView>

        {/* YAKINDAKİLER */}
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: t.heading }]}>{listTitle}</Text>
          {search.trim() ? (
            <Text style={[s.resultCount, { color: t.textMuted }]}>{sorted.length} sonuç</Text>
          ) : (
            <Pressable style={[s.seeAll, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(customer)/explore' as any)} accessibilityRole="button" accessibilityLabel="Tümünü gör">
              <Ionicons name="arrow-forward" size={18} color={t.primary} />
            </Pressable>
          )}
        </View>

        {sorted.length === 0 ? (
          <View style={s.emptyState}>
            {!search.trim() ? (
              <>
                <Ionicons name={sellerTab === 'restaurant' ? 'storefront-outline' : 'restaurant-outline'} size={44} color={t.textMuted} />
                <Text style={[s.emptyTitle, { color: t.heading }]}>{sellerTab === 'restaurant' ? 'Restoranlar yolda' : 'Mutfaklar yolda'}</Text>
                <Text style={[s.emptySub, { color: t.textSecondary }]}>Sofra henüz boş. Bölgene teslimat yapan satıcılar eklendikçe burada görünecek.</Text>
              </>
            ) : (
              <>
                <Ionicons name="search-outline" size={44} color={t.textMuted} />
                <Text style={[s.emptyTitle, { color: t.heading }]}>Bunu bulamadık</Text>
                <Text style={[s.emptySub, { color: t.textSecondary }]}>Başka bir kelimeyle dene.</Text>
                <Pressable style={s.emptyBtn} onPress={() => setSearch('')}>
                  <Text style={s.emptyBtnText}>Aramayı temizle</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : search.trim() ? (
          <View style={s.sellerList}>
            {sorted.map((seller, i) => (
              <SellerCard key={seller.id} seller={seller} campaign={campaigns[seller.id]} index={i} onPress={() => goSeller(seller.id)} />
            ))}
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hRow}>
            {sorted.slice(0, 12).map((seller, i) => (
              <SellerCard key={seller.id} seller={seller} campaign={campaigns[seller.id]} index={i} width={286} onPress={() => goSeller(seller.id)} />
            ))}
          </ScrollView>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 20 },
  overscroll: { position: 'absolute', top: -500, left: 0, right: 0, height: 500 },

  hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroBtnText: { fontSize: 16, fontFamily: fonts.bold, color: '#fff' },
  locWrap: { flex: 1, alignItems: 'center', minWidth: 0 },
  locLabel: { fontSize: 12, fontFamily: fonts.regular, color: '#fff' },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, maxWidth: '100%' },
  locName: { flexShrink: 1, fontSize: 14, fontFamily: fonts.bold, color: '#fff' },

  promo: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  promoText: { flex: 1, minWidth: 0 },
  promoTitle: { fontSize: 34, lineHeight: 38, fontFamily: fonts.display, color: '#F7C948', letterSpacing: -0.8 },
  promoSub: { fontSize: 14, lineHeight: 18, fontFamily: fonts.semibold, color: '#fff', marginTop: 4 },
  promoImage: { width: 76, height: 76, borderRadius: 38 },

  searchWrap: { flexDirection: 'row', gap: 10, marginTop: 14 },
  searchBar: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 16, gap: 10 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 14, color: '#151A16', padding: 0 },
  filterBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },

  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  tabBtn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, fontFamily: fonts.bold },

  catRow: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 10 },
  catTile: { width: 66, alignItems: 'center' },
  catImage: { width: 66, height: 66, borderRadius: 16, borderWidth: 1, backgroundColor: '#fff', marginBottom: 6 },
  catLabel: { fontSize: 12, fontFamily: fonts.medium },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, minHeight: 36 },
  sectionTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.4 },
  seeAll: { width: 44, height: 36, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  resultCount: { fontSize: 12, fontFamily: fonts.medium },

  hRow: { paddingHorizontal: 16, gap: 12, paddingBottom: 20 },
  coverFill: { width: '100%' },

  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingNum: { fontSize: 13, fontFamily: fonts.semibold },

  sellerList: { paddingHorizontal: 16, gap: 12 },
  sellerCard: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, padding: 0 },
  sellerCardPressed: { transform: [{ scale: 0.98 }] },
  sellerCover: { position: 'relative' },
  closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center' },
  closedText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  badge: { position: 'absolute', left: 10, top: 10, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#CE3A1F', alignItems: 'center', justifyContent: 'center' },
  badgeGreen: { backgroundColor: '#17402F' },
  badgeText: { fontSize: 12, fontFamily: fonts.bold, color: '#fff' },
  sellerBody: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 3 },
  sellerRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sellerName: { flex: 1, fontSize: 16, fontFamily: fonts.bold },
  sellerMeta: { fontSize: 13, fontFamily: fonts.regular },

  emptyState: { alignItems: 'center', paddingTop: 32, paddingBottom: 20, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyBtn: { marginTop: 12, backgroundColor: colors.primary, paddingHorizontal: 20, height: 44, justifyContent: 'center', borderRadius: 22 },
  emptyBtnText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
});
