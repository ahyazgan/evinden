import { useEffect, useState, useRef } from 'react';
import {
  Dimensions,
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
import * as Location from 'expo-location';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import { getSavedLocation } from '@/components/shared/LocationPicker';
import { HomeScreenSkeleton } from '@/components/shared/Skeleton';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { getRecommendations, type Recommendation } from '@/lib/recommendations';
import FoodImage from '@/components/shared/FoodImage';
import { getSellerImage } from '@/lib/food-images';

const { width: SCREEN_W } = Dimensions.get('window');
const BANNER_W = SCREEN_W - 32;

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkHour = { open: boolean; start: string; end: string };

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
  working_hours: WorkHour[] | null;
  menu_items: { count: number }[];
  logo_url?: string | null;
};

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all', label: 'Tümü', icon: '🍽️' },
  { id: 'ev-yemegi', label: 'Ev Yemeği', icon: '🍲' },
  { id: 'borek', label: 'Börek', icon: '🥟' },
  { id: 'tatli', label: 'Tatlı', icon: '🍰' },
  { id: 'salata', label: 'Salata', icon: '🥗' },
  { id: 'izgara', label: 'Izgara', icon: '🥩' },
  { id: 'kahvalti', label: 'Kahvaltı', icon: '🍳' },
  { id: 'vegan', label: 'Vegan', icon: '🌱' },
];

// ─── Campaign Banners ─────────────────────────────────────────────────────────

const BANNERS = [
  { id: 'b1', title: 'İlk Siparişe\n%20 İndirim', subtitle: 'Kod: EVINDEN20', gradient: ['#E8593C', '#FF8A65'], emoji: '🎉' },
  { id: 'b2', title: 'Ücretsiz\nTeslimat', subtitle: '₺150 üzeri siparişlerde', gradient: ['#2E7D32', '#66BB6A'], emoji: '🚀' },
  { id: 'b3', title: 'Hafta Sonu\nLezzetleri', subtitle: 'Özel ev yapımı menüler', gradient: ['#1565C0', '#42A5F5'], emoji: '🧑‍🍳' },
];

// ─── Demo Sellers ─────────────────────────────────────────────────────────────

const DEFAULT_HOURS: WorkHour[] = Array(7).fill({ open: true, start: '09:00', end: '21:00' });

const DEMO_SELLERS: SellerRow[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri', city: 'İstanbul', district: 'Kadıköy', latitude: 40.9903, longitude: 29.0278, rating_avg: 4.8, rating_count: 124, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 12 }] },
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlılar ve taze börekler', city: 'İstanbul', district: 'Beşiktaş', latitude: 41.0422, longitude: 29.0099, rating_avg: 4.6, rating_count: 87, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 8 }] },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Hamsi, kuymak, mısır ekmeği — Karadeniz lezzetleri', city: 'İstanbul', district: 'Üsküdar', latitude: 41.0233, longitude: 29.0151, rating_avg: 4.9, rating_count: 203, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 15 }] },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar ve geleneksel tatlılar', city: 'İstanbul', district: 'Bakırköy', latitude: 40.9792, longitude: 28.8720, rating_avg: 4.7, rating_count: 56, is_active: true, working_hours: Array(7).fill({ open: true, start: '10:00', end: '20:00' }), menu_items: [{ count: 10 }] },
  { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda köfte, tavuk şiş ve sebze ızgara', city: 'İstanbul', district: 'Şişli', latitude: 41.0602, longitude: 28.9877, rating_avg: 4.5, rating_count: 41, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 9 }] },
  { id: 'demo-6', display_name: 'Elif Anne Kahvaltı', bio: 'Serpme kahvaltı, gözleme ve köy kahvaltısı', city: 'İstanbul', district: 'Sarıyer', latitude: 41.1667, longitude: 29.0500, rating_avg: 4.8, rating_count: 92, is_active: true, working_hours: Array(7).fill({ open: true, start: '07:00', end: '14:00' }), menu_items: [{ count: 6 }] },
];

const SELLER_AVATARS: Record<string, { emoji: string; bg: string }> = {
  'demo-1': { emoji: '🍲', bg: '#FFF3E0' },
  'demo-2': { emoji: '🥟', bg: '#E8F5E9' },
  'demo-3': { emoji: '🐟', bg: '#E3F2FD' },
  'demo-4': { emoji: '🎂', bg: '#FCE4EC' },
  'demo-5': { emoji: '🥩', bg: '#FBE9E7' },
  'demo-6': { emoji: '🍳', bg: '#FFFDE7' },
};

const DELIVERY_TIMES: Record<string, string> = {
  'demo-1': '25-35', 'demo-2': '30-40', 'demo-3': '20-30',
  'demo-4': '35-45', 'demo-5': '25-35', 'demo-6': '20-30',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOpenNow(hours: WorkHour[] | null): boolean {
  if (!hours) return true;
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const h = hours[dayIdx];
  if (!h?.open) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = h.start.split(':').map(Number);
  const [eh, em] = h.end.split(':').map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function getGreeting(name?: string | null): string {
  const h = new Date().getHours();
  const n = name ? `, ${name.split(' ')[0]}` : '';
  if (h >= 6 && h < 12) return `Günaydın${n} 👋`;
  if (h >= 12 && h < 17) return `İyi öğlenler${n} 👋`;
  if (h >= 17 && h < 21) return `İyi akşamlar${n} 👋`;
  return `İyi geceler${n} 🌙`;
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function BannerCard({ item, onPress }: { item: typeof BANNERS[0], onPress?: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={[s.bannerCard, { backgroundColor: item.gradient[0] }]}>
        <View style={s.bannerContent}>
          <Text style={s.bannerTitle}>{item.title}</Text>
          <Text style={s.bannerSub}>{item.subtitle}</Text>
        </View>
        <Text style={s.bannerEmoji}>{item.emoji}</Text>
        <View style={[s.bannerCircle, s.bannerCircle1, { backgroundColor: item.gradient[1] }]} />
        <View style={[s.bannerCircle, s.bannerCircle2, { backgroundColor: item.gradient[1] }]} />
      </View>
    </Pressable>
  );
}

// ─── Category Pill ────────────────────────────────────────────────────────────

function CategoryPill({ item, active, onPress }: { item: typeof CATEGORIES[0]; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.catPill, active && s.catPillActive]} onPress={onPress}>
      <Text style={s.catIcon}>{item.icon}</Text>
      <Text style={[s.catLabel, active && s.catLabelActive]}>{item.label}</Text>
    </Pressable>
  );
}

// ─── Featured Card ────────────────────────────────────────────────────────────

function FeaturedCard({ seller, index, onPress }: { seller: SellerRow; index: number; onPress: () => void }) {
  const { colors: t } = useTheme();
  const sellerImg = getSellerImage(seller.id);
  return (
    <Animated.View entering={FadeInRight.delay(index * 100).duration(400).springify()}>
      <Pressable style={[s.featuredCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]} onPress={onPress}>
        <FoodImage
          imageUrl={seller.logo_url}
          localImage={sellerImg.image}
          emoji={sellerImg.emoji}
          bg={sellerImg.bg}
          size={120}
          borderRadius={14}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        />
        <View style={s.featuredBody}>
          <Text style={[s.featuredName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
          <View style={s.featuredMeta}>
            <Text style={s.featuredStar}>★ {Number(seller.rating_avg).toFixed(1)}</Text>
            <Text style={s.featuredDot}>·</Text>
            <Text style={s.featuredDistrict}>{seller.district}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Seller List Card ─────────────────────────────────────────────────────────

function SellerListCard({ seller, distance, index = 0, onPress }: { seller: SellerRow; distance?: string; index?: number; onPress: () => void }) {
  const { colors: t } = useTheme();
  const open = isOpenNow(seller.working_hours);
  const sellerImg = getSellerImage(seller.id);
  const menuCount = seller.menu_items?.[0]?.count ?? 0;
  const deliveryTime = DELIVERY_TIMES[seller.id] ?? '30-40';

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(400).springify()}>
    <Pressable
      style={({ pressed }) => [s.sellerCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, pressed && s.sellerCardPressed, !open && s.sellerCardClosed]}
      onPress={onPress}
    >
      <View style={[s.sellerCover, { backgroundColor: 'transparent', overflow: 'hidden' }]}>
        <FoodImage
          imageUrl={seller.logo_url}
          localImage={sellerImg.image}
          emoji={sellerImg.emoji}
          bg={sellerImg.bg}
          size={120}
          borderRadius={14}
        />
        {!open && (
          <View style={s.closedOverlay}>
            <Text style={s.closedText}>Şu an kapalı</Text>
          </View>
        )}
        {open && (
          <View style={s.deliveryBadge}>
            <Text style={s.deliveryIcon}>🕐</Text>
            <Text style={s.deliveryTime}>{deliveryTime} dk</Text>
          </View>
        )}
        <View style={s.minOrderBadge}>
          <Text style={s.minOrderText}>Min ₺50</Text>
        </View>
      </View>

      <View style={s.sellerBody}>
        <View style={s.sellerRow1}>
          <Text style={[s.sellerName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
          <View style={s.ratingBadge}>
            <Text style={s.ratingStar}>★</Text>
            <Text style={[s.ratingNum, { color: t.text }]}>{Number(seller.rating_avg).toFixed(1)}</Text>
            <Text style={[s.ratingCount, { color: t.textMuted }]}>({seller.rating_count})</Text>
          </View>
        </View>
        {seller.bio ? <Text style={[s.sellerBio, { color: t.textSecondary }]} numberOfLines={1}>{seller.bio}</Text> : null}
        <View style={s.sellerTags}>
          {distance ? <View style={s.tag}><Text style={s.tagText}>📍 {distance}</Text></View> : null}
          {seller.district ? <View style={s.tag}><Text style={s.tagText}>{seller.district}</Text></View> : null}
          {menuCount > 0 ? <View style={s.tag}><Text style={s.tagText}>{menuCount} çeşit</Text></View> : null}
          {open ? (
            <View style={[s.tag, s.tagOpen]}>
              <View style={s.tagDot} />
              <Text style={[s.tagText, s.tagOpenText]}>Açık</Text>
            </View>
          ) : null}
        </View>
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
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('all');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('Konum seçin');
  const bannerRef = useRef<FlatList>(null);
  const [bannerIdx, setBannerIdx] = useState(0);

  const { recentIds } = useRecentlyViewed();
  const recentSellers = (recentIds || [])
    .map((id) => DEMO_SELLERS.find((s) => s.id === id))
    .filter(Boolean) as SellerRow[];

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  // Auto-scroll banners
  useEffect(() => {
    const timer = setInterval(() => {
      setBannerIdx(prev => {
        const next = (prev + 1) % BANNERS.length;
        try { bannerRef.current?.scrollToIndex({ index: next, animated: true }); } catch {}
        return next;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    requestLocation();
    loadSellers();
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
        .select('*, menu_items(count)')
        .eq('is_active', true)
        .order('rating_avg', { ascending: false });
      if (!error && data && data.length > 0) {
        setSellers(data as SellerRow[]);
      } else {
        setSellers(DEMO_SELLERS);
      }
    } catch {
      setSellers(DEMO_SELLERS);
    } finally {
      setLoading(false);
    }
  }

  // Load recommendations based on actual sellers
  useEffect(() => {
    if (sellers.length === 0) return;
    const names: Record<string, string> = {};
    sellers.forEach(s => { names[s.id] = s.display_name; });
    getRecommendations(sellers.map(s => s.id), names).then(setRecommendations);
  }, [sellers]);

  const timeBasedRecs = recommendations.filter(r => r.type === 'time_based' || r.type === 'popular_now');
  const forYouRecs = recommendations.filter(r => r.type === 'for_you' || r.type === 'reorder');

  async function onRefresh() {
    setRefreshing(true);
    await loadSellers();
    // recommendations will auto-update via sellers useEffect
    setRefreshing(false);
  }

  const filtered = sellers.filter(seller => {
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

  const featured = [...sellers].sort((a, b) => b.rating_avg - a.rating_avg).slice(0, 4);
  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: t.background }]} edges={['top']}>
        <HomeScreenSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* HEADER */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.locRow}>
              <View style={s.locIconWrap}>
                <Text style={s.locIcon}>📍</Text>
              </View>
              <View>
                <Text style={s.locLabel}>Teslimat adresi</Text>
                <Text style={s.locName} numberOfLines={1}>{locationName}</Text>
              </View>
              <Text style={s.locChevron}>›</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <Pressable style={s.notifBtn} onPress={() => router.push('/(customer)/notifications' as any)}>
              <Text style={s.notifIcon}>🔔</Text>
              <View style={s.notifDot} />
            </Pressable>
            <Pressable style={s.avatarBtn} onPress={() => router.push('/(customer)/profile' as any)}>
              <Text style={s.avatarText}>{initial}</Text>
            </Pressable>
          </View>
        </View>

        {/* GREETING */}
        <Text style={[s.greeting, { color: t.text }]}>{getGreeting(profile?.name)}</Text>

        {/* SEARCH */}
        <View style={s.searchWrap}>
          <View style={[s.searchBar, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={s.searchIcon}>🔍</Text>
            <TextInput
              style={[s.searchInput, { color: t.text }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Restoran veya yemek ara..."
              placeholderTextColor={t.textMuted}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <View style={s.clearBtn}><Text style={s.clearText}>✕</Text></View>
              </Pressable>
            )}
          </View>
          <Pressable style={s.filterBtn}>
            <Text style={s.filterIcon}>⚡</Text>
          </Pressable>
        </View>

        {/* BANNERS */}
        <View style={s.bannerSection}>
          <FlatList
            ref={bannerRef}
            data={BANNERS}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={b => b.id}
            renderItem={({ item }) => (
              <BannerCard
                item={item}
                onPress={() => router.push('/(customer)/campaign' as any)}
              />
            )}
            snapToInterval={BANNER_W + 12}
            decelerationRate="fast"
            contentContainerStyle={{ gap: 12 }}
            onMomentumScrollEnd={e => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (BANNER_W + 12));
              setBannerIdx(idx);
            }}
            getItemLayout={(_, index) => ({ length: BANNER_W + 12, offset: (BANNER_W + 12) * index, index })}
          />
          <View style={s.dotsRow}>
            {BANNERS.map((_, i) => <View key={i} style={[s.dot, i === bannerIdx && s.dotActive]} />)}
          </View>
        </View>

        {/* CATEGORIES */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
          {CATEGORIES.map(cat => (
            <CategoryPill key={cat.id} item={cat} active={activeCat === cat.id} onPress={() => setActiveCat(cat.id)} />
          ))}
        </ScrollView>

        {/* TIME-BASED / POPULAR NOW */}
        {!search.trim() && timeBasedRecs.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>🔥 Şu An Popüler</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.featuredRow}>
              {timeBasedRecs.slice(0, 4).map((rec, i) => {
                const seller = sellers.find(s => s.id === rec.sellerId);
                if (!seller) return null;
                return (
                  <Animated.View key={rec.sellerId} entering={FadeInRight.delay(i * 100).duration(400).springify()}>
                    <Pressable
                      style={[s.recCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}
                      onPress={() => router.push(`/(customer)/seller/${rec.sellerId}` as any)}
                    >
                      <View style={[s.recAvatar, { backgroundColor: (SELLER_AVATARS[rec.sellerId] ?? { bg: '#FFF3E0' }).bg }]}>
                        <Text style={s.recAvatarEmoji}>{(SELLER_AVATARS[rec.sellerId] ?? { emoji: '🍽️' }).emoji}</Text>
                      </View>
                      <Text style={[s.recName, { color: t.text }]} numberOfLines={1}>{rec.sellerName}</Text>
                      <Text style={[s.recReason, { color: t.textMuted }]}>{rec.reason}</Text>
                      <View style={s.recRating}>
                        <Text style={s.recStar}>★</Text>
                        <Text style={[s.recRatingNum, { color: t.text }]}>{Number(seller.rating_avg).toFixed(1)}</Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* FOR YOU / REORDER */}
        {!search.trim() && forYouRecs.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>💡 Senin İçin</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.featuredRow}>
              {forYouRecs.slice(0, 4).map((rec, i) => {
                const seller = sellers.find(s => s.id === rec.sellerId);
                if (!seller) return null;
                return (
                  <FeaturedCard
                    key={rec.sellerId}
                    seller={seller}
                    index={i}
                    onPress={() => router.push(`/(customer)/seller/${rec.sellerId}` as any)}
                  />
                );
              })}
            </ScrollView>
          </>
        )}

        {/* RECENTLY VIEWED (if any) */}
        {!search.trim() && recentSellers.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>⏱️ Son Görüntülenenler</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.featuredRow}>
              {recentSellers.map((seller, i) => (
                <FeaturedCard
                  key={seller.id}
                  seller={seller}
                  index={i}
                  onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* FEATURED */}
        {!search.trim() && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>⭐ Öne Çıkanlar</Text>
              <Pressable><Text style={s.seeAll}>Tümünü Gör ›</Text></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.featuredRow}>
              {featured.map((seller, i) => (
                <FeaturedCard
                  key={seller.id}
                  seller={seller}
                  index={i}
                  onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* SELLER LIST */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>
            {search.trim() ? '🔍 Arama Sonuçları' : '🏪 Yakınındaki Mutfaklar'}
          </Text>
          <Text style={s.resultCount}>{sorted.length} sonuç</Text>
        </View>

        {sorted.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>😕</Text>
            <Text style={s.emptyTitle}>Sonuç bulunamadı</Text>
            <Text style={s.emptySub}>Farklı bir arama veya kategori deneyin</Text>
            <Pressable style={s.emptyBtn} onPress={() => { setSearch(''); setActiveCat('all'); }}>
              <Text style={s.emptyBtnText}>Filtreleri Temizle</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.sellerList}>
            {sorted.map((seller, i) => {
              const dist = userLat != null && seller.latitude != null
                ? fmtDist(haversineKm(userLat, userLon!, seller.latitude, seller.longitude!))
                : undefined;
              return (
                <SellerListCard
                  key={seller.id}
                  seller={seller}
                  distance={dist}
                  index={i}
                  onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                />
              );
            })}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  scroll: { paddingBottom: 20 },

  loadingFull: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#A89A8A', fontWeight: '500' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF0EB', alignItems: 'center', justifyContent: 'center' },
  locIcon: { fontSize: 16 },
  locLabel: { fontSize: 11, color: '#A89A8A', fontWeight: '500' },
  locName: { fontSize: 14, fontWeight: '700', fontFamily: fonts.bold, color: '#1A1208', maxWidth: 180 },
  locChevron: { fontSize: 18, color: '#A89A8A', marginLeft: -2 },
  notifBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F0ECE6' },
  notifIcon: { fontSize: 18 },
  notifDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: '#fff' },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  greeting: { fontSize: 24, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208', paddingHorizontal: 16, marginTop: 16, marginBottom: 16 },

  searchWrap: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderWidth: 1, borderColor: '#F0ECE6', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1208', padding: 0 },
  clearBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#F0ECE6', alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 11, color: '#A89A8A', fontWeight: '700' },
  filterBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  filterIcon: { fontSize: 20 },

  bannerSection: { marginBottom: 20, paddingLeft: 16 },
  bannerCard: { width: BANNER_W, height: 130, borderRadius: 18, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden' },
  bannerContent: { flex: 1, zIndex: 1 },
  bannerTitle: { fontSize: 22, fontWeight: '900', fontFamily: fonts.black, color: '#fff', lineHeight: 28, marginBottom: 6 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  bannerEmoji: { fontSize: 52, zIndex: 1 },
  bannerCircle: { position: 'absolute', borderRadius: 100, opacity: 0.25 },
  bannerCircle1: { width: 120, height: 120, top: -30, right: -20 },
  bannerCircle2: { width: 80, height: 80, bottom: -20, left: 60 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10, marginRight: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#DDD8D0' },
  dotActive: { width: 20, borderRadius: 3, backgroundColor: colors.primary },

  catRow: { paddingHorizontal: 16, gap: 8, marginBottom: 20 },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, borderWidth: 1, borderColor: '#F0ECE6' },
  catPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catIcon: { fontSize: 16 },
  catLabel: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  catLabelActive: { color: '#fff' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  seeAll: { fontSize: 13, fontWeight: '600', color: colors.primary },
  resultCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },

  featuredRow: { paddingHorizontal: 16, gap: 12, marginBottom: 24 },
  featuredCard: { width: 140, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#F0ECE6' },
  featuredCover: { height: 90, alignItems: 'center', justifyContent: 'center' },
  featuredEmoji: { fontSize: 40 },
  featuredBody: { padding: 10 },
  featuredName: { fontSize: 13, fontWeight: '700', fontFamily: fonts.bold, color: '#1A1208' },
  featuredMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  featuredStar: { fontSize: 11, color: '#EF9F27', fontWeight: '700' },
  featuredDot: { fontSize: 11, color: '#D0C8BC' },
  featuredDistrict: { fontSize: 11, color: '#A89A8A' },

  sellerList: { paddingHorizontal: 16, gap: 14 },
  sellerCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  sellerCardPressed: { transform: [{ scale: 0.98 }] },
  sellerCardClosed: { opacity: 0.6 },
  sellerCover: { height: 120, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  sellerCoverEmoji: { fontSize: 52 },
  closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  closedText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  deliveryBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  deliveryIcon: { fontSize: 11 },
  deliveryTime: { fontSize: 11, fontWeight: '700', color: '#1A1208' },
  minOrderBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  minOrderText: { fontSize: 10, fontWeight: '600', color: '#fff' },
  sellerBody: { padding: 14, gap: 6 },
  sellerRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sellerName: { flex: 1, fontSize: 16, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208', marginRight: 8 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingStar: { fontSize: 13, color: '#EF9F27' },
  ratingNum: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  ratingCount: { fontSize: 11, color: '#A89A8A' },
  sellerBio: { fontSize: 13, color: '#8A7E72', lineHeight: 18 },
  sellerTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F7F3EE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 11, color: '#6B5E50', fontWeight: '500' },
  tagOpen: { backgroundColor: '#E8F5E9' },
  tagDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#2E7D32' },
  tagOpenText: { color: '#2E7D32' },

  emptyState: { alignItems: 'center', paddingTop: 40, paddingBottom: 20, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center' },
  emptyBtn: { marginTop: 12, backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Recommendation cards
  recCard: {
    width: 140,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginRight: 10,
    alignItems: 'center',
    gap: 6,
  },
  recAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  recAvatarEmoji: { fontSize: 26 },
  recName: { fontSize: 13, fontWeight: '700', textAlign: 'center', fontFamily: fonts.bold },
  recReason: { fontSize: 11, textAlign: 'center' },
  recRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  recStar: { fontSize: 12, color: '#EF9F27' },
  recRatingNum: { fontSize: 12, fontWeight: '700' },
});
