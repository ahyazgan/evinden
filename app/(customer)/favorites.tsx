import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useFavorites } from '@/lib/favorites-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { fetchSellersByIds, type SellerRow } from '@/lib/db';
import { useTabBarSpace } from '@/components/shared/ChainTabBar';
import FoodImage from '@/components/shared/FoodImage';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { sellerPhoto } from '@/lib/food-images';
import { gridItemWidth, NARROW_PAGE_WIDTH, useResponsive } from '@/lib/responsive';

type SellerData = {
  id: string;
  display_name: string;
  rating_avg: number;
  rating_count: number;
  photo: string | null;
};

function rowToSellerData(row: SellerRow): SellerData {
  return {
    id: row.id,
    display_name: row.display_name,
    rating_avg: Number(row.rating_avg) || 0,
    rating_count: row.rating_count,
    photo: sellerPhoto(row),
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
  const { isDesktop, pageWidth } = useResponsive();
  const tabBarSpace = useTabBarSpace();
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

  // Bu ekran masaüstünde dar sütunda açılır.
  const gap = isDesktop ? 16 : 10;
  const cardWidth = isDesktop
    ? gridItemWidth(Math.min(pageWidth, NARROW_PAGE_WIDTH), 3, gap, 16)
    : gridItemWidth(pageWidth, 2, gap, 16);
  const photoWidth = cardWidth - 16;

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Favorilerin"
        subtitle={isLoggedIn && favorites.length > 0 ? `${favorites.length} mutfak` : undefined}
        cart
      />

      <ScrollView
        contentContainerStyle={[s.list, { paddingBottom: isDesktop ? 32 : tabBarSpace }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
        }
      >
        {!isLoggedIn ? (
          <Animated.View entering={FadeIn.duration(500)} style={s.empty}>
            <FloatingIcon name="heart-outline" size={48} color={t.textMuted} />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[s.emptyTitle, { color: t.heading }]}>Giriş yap</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[s.emptySub, { color: t.textSecondary }]}>Favori mutfaklarını görmek için giriş yap.</Animated.Text>
            <View style={s.emptyAction}>
              <Button label="Giriş yap" onPress={() => router.push('/(auth)/login' as any)} />
            </View>
          </Animated.View>
        ) : favorites.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={s.empty}>
            <FloatingIcon name="heart-outline" size={48} color={t.textMuted} />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[s.emptyTitle, { color: t.heading }]}>Henüz favorin yok</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[s.emptySub, { color: t.textSecondary }]}>Mutfak sayfasındaki kalbe dokun, burada görünsün.</Animated.Text>
            <View style={s.emptyAction}>
              <Button label="Mutfakları keşfet" onPress={() => router.push('/(customer)/explore' as any)} />
            </View>
          </Animated.View>
        ) : (
          <View style={[s.grid, { gap }]}>
            {favorites.map(seller => (
              <Pressable
                key={seller.id}
                style={({ pressed }) => [s.card, { width: cardWidth, backgroundColor: t.surface }, pressed && s.pressed]}
                onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
                accessibilityLabel={seller.display_name}
              >
                <View>
                  <FoodImage imageUrl={seller.photo} size={photoWidth} height={Math.round(photoWidth * 0.785)} borderRadius={12} />
                  <Pressable
                    style={s.heartHit}
                    onPress={() => toggleFavorite(seller.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${seller.display_name}: favorilerden çıkar`}
                  >
                    <View style={[s.heart, { backgroundColor: t.brand }]}>
                      <Ionicons name="heart" size={18} color={t.accent} />
                    </View>
                  </Pressable>
                </View>
                <Text style={[s.cardName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
                <View style={s.rating}>
                  <Ionicons name="star" size={14} color={t.text} />
                  <Text style={[s.ratingNum, { color: t.text }]}>
                    {seller.rating_count > 0 ? seller.rating_avg.toFixed(1).replace('.', ',') : 'Yeni'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {favorites.length > 0 && (
          <View style={s.tip}>
            <Ionicons name="heart-dislike-outline" size={14} color={t.textSecondary} />
            <Text style={[s.tipText, { color: t.textSecondary }]}>Favoriyi kaldırmak için kalbe dokun</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  list: { paddingHorizontal: 16, paddingTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  card: { borderRadius: 16, padding: 8, paddingBottom: 12 },
  pressed: { opacity: 0.85 },
  cardName: { fontSize: 14, lineHeight: 18, fontFamily: fonts.bold, marginTop: 8, paddingHorizontal: 4 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 4 },
  ratingNum: { fontSize: 13, fontFamily: fonts.bold },

  // 36'lık daire, 44'lük dokunma alanının ortasında durur.
  heartHit: { position: 'absolute', top: 2, right: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heart: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', paddingTop: 56, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyAction: { marginTop: 12 },

  tip: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipText: { fontFamily: fonts.regular, fontSize: 12 },
});
