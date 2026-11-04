import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useFavorites } from '@/lib/favorites-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { fetchSellersByIds, type SellerRow } from '@/lib/db';
import FoodImage from '@/components/shared/FoodImage';
import { sellerPhoto } from '@/lib/food-images';

type SellerData = {
  id: string;
  display_name: string;
  bio: string;
  district: string;
  rating_avg: number;
  rating_count: number;
  photo: string | null;
  deliveryMin: number;
};

function rowToSellerData(row: SellerRow): SellerData {
  return {
    id: row.id,
    display_name: row.display_name,
    bio: row.bio ?? '',
    district: row.district ?? '',
    rating_avg: Number(row.rating_avg) || 0,
    rating_count: row.rating_count,
    photo: sellerPhoto(row),
    deliveryMin: 30,
  };
}

function FloatingIcon({ name, size, color }: { name: any; size: number; color: string }) {
  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 1200 }),
        withTiming(0, { duration: 1200 }),
      ),
      -1,
      true,
    );
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isLoggedIn = !!session;
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { colors: t } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [sellerMap, setSellerMap] = useState<Record<string, SellerData>>({});

  useEffect(() => {
    if (favoriteIds.length === 0) return;
    fetchSellersByIds(favoriteIds)
      .then(rows => {
        const map: Record<string, SellerData> = {};
        rows.forEach(r => { map[r.id] = rowToSellerData(r); });
        setSellerMap(map);
      })
      .catch(() => {});
  }, [favoriteIds]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await fetchSellersByIds(favoriteIds);
      const map: Record<string, SellerData> = {};
      rows.forEach(r => { map[r.id] = rowToSellerData(r); });
      setSellerMap(map);
    } catch {}
    setRefreshing(false);
  }, [favoriteIds]);

  const favorites = favoriteIds
    .map(id => sellerMap[id])
    .filter(Boolean);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: t.background }]} edges={['top']}>
      <View style={[s.header, { borderBottomColor: t.surfaceBorder }]}>
        <Text style={[s.headerTitle, { color: t.text }]}>Favoriler</Text>
        {isLoggedIn && favorites.length > 0 && (
          <Text style={[s.headerSub, { color: t.textMuted }]}>{favorites.length} kayıtlı satıcı</Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {!isLoggedIn ? (
          <Animated.View entering={FadeIn.duration(500)} style={s.empty}>
            <FloatingIcon name="heart-outline" size={56} color="#E3E6DE" />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[s.emptyTitle, { color: t.text }]}>Giriş yapın</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[s.emptySub, { color: t.textMuted }]}>Favori satıcılarınızı görmek için giriş yapın.</Animated.Text>
            <Pressable style={s.ctaBtn} onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={s.ctaBtnText}>Giriş Yap</Text>
            </Pressable>
          </Animated.View>
        ) : favorites.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={s.empty}>
            <FloatingIcon name="heart-outline" size={56} color="#E3E6DE" />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[s.emptyTitle, { color: t.text }]}>Henüz favori yok</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[s.emptySub, { color: t.textMuted }]}>Satıcı sayfasında kalp ikonuna basarak favorilere ekleyin.</Animated.Text>
            <Pressable style={s.ctaBtn} onPress={() => router.push('/(customer)/explore' as any)}>
              <Text style={s.ctaBtnText}>Satıcıları Keşfet</Text>
            </Pressable>
          </Animated.View>
        ) : (
          favorites.map(seller => (
            <Pressable
              key={seller.id}
              style={[s.card, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}
              onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
            >
              <FoodImage imageUrl={seller.photo} size={54} borderRadius={14} />
              <View style={s.cardBody}>
                <Text style={[s.cardName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
                <Text style={[s.cardBio, { color: t.textMuted }]} numberOfLines={1}>{seller.bio}</Text>
                <View style={s.cardMeta}>
                  <Ionicons name="location-outline" size={12} color="#5E6862" />
                  <Text style={s.metaText}>{seller.district}</Text>
                  <Text style={s.metaDot}>·</Text>
                  <Text style={s.metaText}>★ {seller.rating_avg.toFixed(1)}</Text>
                  <Text style={s.metaDot}>·</Text>
                  <Ionicons name="time-outline" size={12} color="#5E6862" />
                  <Text style={s.metaText}>{seller.deliveryMin} dk</Text>
                </View>
              </View>
              <Pressable
                style={s.heartBtn}
                onPress={() => toggleFavorite(seller.id)}
                hitSlop={8}
              >
                <Ionicons name="heart" size={20} color={colors.primary} />
              </Pressable>
            </Pressable>
          ))
        )}

        {favorites.length > 0 && (
          <View style={s.tip}>
            <Ionicons name="heart-dislike-outline" size={14} color="#5E6862" />
            <Text style={s.tipText}>Favoriyi kaldırmak için kalbe dokun</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F2EE' },
  header: {
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#E3E6DE',
  },
  headerTitle: { fontSize: 24, fontFamily: fonts.extrabold, color: '#151A16' },
  headerSub: { fontFamily: fonts.regular, fontSize: 13, color: '#5E6862', marginTop: 2 },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E3E6DE',
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16' },
  cardBio: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontFamily: fonts.regular, fontSize: 11, color: '#5E6862' },
  metaDot: { fontFamily: fonts.regular, fontSize: 11, color: '#5E6862' },

  heartBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF0F0',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  empty: { alignItems: 'center', paddingTop: 72, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: '#5E6862', textAlign: 'center', lineHeight: 20 },
  ctaBtn: {
    marginTop: 8, backgroundColor: colors.primary,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  ctaBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },

  tip: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipText: { fontFamily: fonts.regular, fontSize: 12, color: '#5E6862' },
});
