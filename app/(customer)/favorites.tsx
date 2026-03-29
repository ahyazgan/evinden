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

type SellerData = {
  id: string;
  display_name: string;
  bio: string;
  district: string;
  rating_avg: number;
  rating_count: number;
  emoji: string;
  bg: string;
  deliveryMin: number;
};

const ALL_SELLERS: Record<string, SellerData> = {
  'demo-1': { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri.', district: 'Kadıköy', rating_avg: 4.8, rating_count: 124, emoji: '🍲', bg: '#FFF3E0', deliveryMin: 30 },
  'demo-2': { id: 'demo-2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler.', district: 'Beşiktaş', rating_avg: 4.6, rating_count: 87, emoji: '🥟', bg: '#E8F5E9', deliveryMin: 40 },
  'demo-3': { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Karadeniz mutfağının eşsiz tatları.', district: 'Üsküdar', rating_avg: 4.9, rating_count: 203, emoji: '🐟', bg: '#E3F2FD', deliveryMin: 25 },
  'demo-4': { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve tatlılar.', district: 'Bakırköy', rating_avg: 4.7, rating_count: 56, emoji: '🎂', bg: '#FCE4EC', deliveryMin: 45 },
  'demo-5': { id: 'demo-5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda pişirilen köfteler ve ızgaralar.', district: 'Şişli', rating_avg: 4.5, rating_count: 41, emoji: '🥩', bg: '#FBE9E7', deliveryMin: 30 },
  'demo-6': { id: 'demo-6', display_name: 'Elif Anne Kahvaltı', bio: 'Serpme kahvaltı, gözleme ve köy kahvaltısı.', district: 'Sarıyer', rating_avg: 4.8, rating_count: 92, emoji: '🍳', bg: '#FFFDE7', deliveryMin: 25 },
};

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const favorites = favoriteIds
    .map(id => ALL_SELLERS[id])
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
            <FloatingIcon name="heart-outline" size={56} color="#E8E2DA" />
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={[s.emptyTitle, { color: t.text }]}>Giriş yapın</Animated.Text>
            <Animated.Text entering={FadeInDown.delay(350).duration(400)} style={[s.emptySub, { color: t.textMuted }]}>Favori satıcılarınızı görmek için giriş yapın.</Animated.Text>
            <Pressable style={s.ctaBtn} onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={s.ctaBtnText}>Giriş Yap</Text>
            </Pressable>
          </Animated.View>
        ) : favorites.length === 0 ? (
          <Animated.View entering={FadeIn.duration(500)} style={s.empty}>
            <FloatingIcon name="heart-outline" size={56} color="#E8E2DA" />
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
              <View style={[s.cardEmoji, { backgroundColor: seller.bg }]}>
                <Text style={s.cardEmojiText}>{seller.emoji}</Text>
              </View>
              <View style={s.cardBody}>
                <Text style={[s.cardName, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
                <Text style={[s.cardBio, { color: t.textMuted }]} numberOfLines={1}>{seller.bio}</Text>
                <View style={s.cardMeta}>
                  <Ionicons name="location-outline" size={12} color="#A89A8A" />
                  <Text style={s.metaText}>{seller.district}</Text>
                  <Text style={s.metaDot}>·</Text>
                  <Text style={s.metaText}>★ {seller.rating_avg.toFixed(1)}</Text>
                  <Text style={s.metaDot}>·</Text>
                  <Ionicons name="time-outline" size={12} color="#A89A8A" />
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
            <Ionicons name="heart-dislike-outline" size={14} color="#C4B8AA" />
            <Text style={s.tipText}>Favoriyi kaldırmak için kalbe dokun</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDE8E2',
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  cardEmoji: {
    width: 54, height: 54, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardEmojiText: { fontSize: 26 },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontSize: 14, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  cardBio: { fontSize: 12, color: '#A89A8A' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 11, color: '#A89A8A' },
  metaDot: { fontSize: 11, color: '#C4B8AA' },

  heartBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF0F0',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  empty: { alignItems: 'center', paddingTop: 72, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 20 },
  ctaBtn: {
    marginTop: 8, backgroundColor: colors.primary,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  ctaBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  tip: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipText: { fontSize: 12, color: '#C4B8AA' },
});
