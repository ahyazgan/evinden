import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { SellerCard } from '@/components/ui/Card';

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
  emoji?: string;
  bgColor?: string;
};

// ─── Demo fallback ────────────────────────────────────────────────────────────

const DEFAULT_HOURS: WorkHour[] = Array(7).fill({ open: true, start: '09:00', end: '21:00' });

const DEMO_SELLERS: SellerRow[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri.', city: 'İstanbul', district: 'Kadıköy', latitude: 40.9903, longitude: 29.0278, rating_avg: 4.8, rating_count: 124, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 4 }], emoji: '🍲', bgColor: '#FFF3E0' },
  { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler.', city: 'İzmir', district: 'Bornova', latitude: 38.4612, longitude: 27.2192, rating_avg: 4.6, rating_count: 87, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 3 }], emoji: '🥗', bgColor: '#E8F5E9' },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Karadeniz mutfağının eşsiz tatları: hamsi, kuymak, mısır ekmeği.', city: 'İstanbul', district: 'Üsküdar', latitude: 41.0233, longitude: 29.0151, rating_avg: 4.9, rating_count: 203, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 4 }], emoji: '🐟', bgColor: '#E3F2FD' },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar.', city: 'Ankara', district: 'Çankaya', latitude: 39.9208, longitude: 32.8541, rating_avg: 4.7, rating_count: 56, is_active: true, working_hours: Array(7).fill({ open: true, start: '10:00', end: '20:00' }), menu_items: [{ count: 3 }], emoji: '🎂', bgColor: '#FCE4EC' },
  { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara.', city: 'Bursa', district: 'Nilüfer', latitude: 40.2128, longitude: 28.9854, rating_avg: 4.5, rating_count: 41, is_active: true, working_hours: DEFAULT_HOURS, menu_items: [{ count: 3 }], emoji: '🥩', bgColor: '#FBE9E7' },
];

const SELLER_EMOJIS: Record<string, string>  = { 'demo-1': '🍲', 'demo-2': '🥗', 'demo-3': '🐟', 'demo-4': '🎂', 'demo-5': '🥩' };
const SELLER_BG: Record<string, string> = { 'demo-1': '#FFF3E0', 'demo-2': '#E8F5E9', 'demo-3': '#E3F2FD', 'demo-4': '#FCE4EC', 'demo-5': '#FBE9E7' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOpenNow(hours: WorkHour[] | null): boolean {
  if (!hours) return true;
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0 … Sun=6
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
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Günaydın,\nbugün ne yesek?';
  if (h >= 12 && h < 17) return 'Öğle vakti,\nne yesek?';
  if (h >= 17 && h < 21) return 'Akşam oldu,\nne yesek?';
  return 'Gece geç,\nne yesek?';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CustomerHomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState('Konumunuz');

  useEffect(() => {
    requestLocation();
    loadSellers();
  }, []);

  async function requestLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);

      const { latitude, longitude } = (loc as Location.LocationObject).coords;
      setUserLat(latitude);
      setUserLon(longitude);

      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      const addr = results[0];
      if (addr) {
        const parts = [addr.subregion ?? addr.district, addr.city].filter(Boolean);
        if (parts.length > 0) setLocationName(parts.join(', '));
      }
    } catch {
      // Konum izni verilmezse veya zaman aşımına uğrarsa sessizce devam et
    }
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

  async function onRefresh() {
    setRefreshing(true);
    await loadSellers();
    setRefreshing(false);
  }

  // Filter by search
  const filtered = sellers.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.display_name.toLowerCase().includes(q) ||
      (s.bio ?? '').toLowerCase().includes(q) ||
      (s.district ?? '').toLowerCase().includes(q) ||
      (s.city ?? '').toLowerCase().includes(q)
    );
  });

  // Sort by distance when location available
  const sorted = [...filtered].sort((a, b) => {
    if (userLat == null || userLon == null) return 0;
    const da =
      a.latitude != null ? haversineKm(userLat, userLon, a.latitude, a.longitude!) : 9999;
    const db =
      b.latitude != null ? haversineKm(userLat, userLon, b.latitude, b.longitude!) : 9999;
    return da - db;
  });

  const initial = profile?.name?.charAt(0).toUpperCase() ?? 'D';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.locRow}>
            <View style={styles.locPin} />
            <Text style={styles.locName} numberOfLines={1}>{locationName}</Text>
            <Text style={styles.locArr}>▾</Text>
          </View>
          <View style={styles.topRight}>
            <View style={styles.notif}>
              <View style={styles.notifDot} />
            </View>
            <Pressable
              style={styles.avatar}
              onPress={() => router.push('/(customer)/profile' as any)}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
          </View>
        </View>

        {/* Greeting */}
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.subGreeting}>
          {sorted.length} onaylı satıcı yakında
        </Text>

        {/* Search */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Yemek veya satıcı ara..."
            placeholderTextColor="#C8B8A8"
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Text style={styles.clearBtn}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Seller list */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>Sonuç yok</Text>
            <Text style={styles.emptySub}>Farklı bir arama deneyin</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionHeading}>
              {userLat != null ? '📍 Yakınındaki Satıcılar' : 'Satıcılar'}
            </Text>
            <View style={styles.sellerList}>
              {sorted.map(seller => {
                const dist =
                  userLat != null && seller.latitude != null
                    ? fmtDist(haversineKm(userLat, userLon!, seller.latitude, seller.longitude!))
                    : undefined;
                const menuCount = seller.menu_items?.[0]?.count ?? 0;
                const emoji = seller.emoji ?? SELLER_EMOJIS[seller.id] ?? '🍽️';
                const bgColor = seller.bgColor ?? SELLER_BG[seller.id] ?? '#FFF3E0';

                return (
                  <SellerCard
                    key={seller.id}
                    id={seller.id}
                    name={seller.display_name}
                    bio={seller.bio ?? undefined}
                    emoji={emoji}
                    bgColor={bgColor}
                    rating={Number(seller.rating_avg)}
                    ratingCount={seller.rating_count}
                    district={seller.district ?? undefined}
                    distance={dist}
                    deliveryMin={25}
                    isOpen={isOpenNow(seller.working_hours)}
                    isApproved
                    menuCount={menuCount > 0 ? menuCount : undefined}
                    onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                  />
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locPin: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  locName: { fontSize: 13, fontWeight: '700', color: '#1A1208', maxWidth: 160 },
  locArr: { fontSize: 10, color: '#A89A8A' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notif: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE8E2',
    alignItems: 'center', justifyContent: 'center',
  },
  notifDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary,
    position: 'absolute', top: 8, right: 8,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  greeting: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1A1208',
    fontFamily: 'serif',
    lineHeight: 34,
    marginBottom: 4,
  },
  subGreeting: { fontSize: 13, color: '#A89A8A', marginBottom: 18 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 24,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1208' },
  clearBtn: { fontSize: 13, color: '#A89A8A', fontWeight: '700' },

  sectionHeading: { fontSize: 16, fontWeight: '800', color: '#1A1208', marginBottom: 12 },
  sellerList: { gap: 10 },

  loadingWrap: { paddingTop: 60, alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },
});
