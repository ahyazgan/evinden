import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

type FavSeller = {
  id: string;
  display_name: string;
  bio: string;
  district: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  emoji: string;
  bg: string;
  deliveryMin: number;
};

const INITIAL_FAVORITES: FavSeller[] = [
  { id: 'demo-1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri.', district: 'Kadıköy', city: 'İstanbul', rating_avg: 4.8, rating_count: 124, emoji: '🍲', bg: '#FFF3E0', deliveryMin: 30 },
  { id: 'demo-3', display_name: 'Mehmet Usta Karadeniz', bio: 'Karadeniz mutfağının eşsiz tatları: mısır ekmeği, hamsi tava, kuymak.', district: 'Üsküdar', city: 'İstanbul', rating_avg: 4.9, rating_count: 203, emoji: '🐟', bg: '#E3F2FD', deliveryMin: 35 },
  { id: 'demo-4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar.', district: 'Çankaya', city: 'Ankara', rating_avg: 4.7, rating_count: 56, emoji: '🎂', bg: '#FCE4EC', deliveryMin: 60 },
];

export default function FavoritesScreen() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavSeller[]>(INITIAL_FAVORITES);

  const removeFavorite = (id: string) => {
    setFavorites(prev => prev.filter(s => s.id !== id));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Favoriler</Text>
        <Text style={styles.headerSub}>{favorites.length} kayıtlı satıcı</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {favorites.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>💔</Text>
            <Text style={styles.emptyTitle}>Henüz favori yok</Text>
            <Text style={styles.emptySub}>
              Satıcıları favorilere eklemek için kalp ikonuna dokun.
            </Text>
            <Pressable
              style={styles.exploreBtn}
              onPress={() => router.push('/(customer)/explore' as any)}
            >
              <Text style={styles.exploreBtnText}>Satıcıları Keşfet</Text>
            </Pressable>
          </View>
        ) : (
          favorites.map(seller => (
            <Pressable
              key={seller.id}
              style={styles.sellerCard}
              onPress={() => router.push(`/(customer)/seller/${seller.id}` as any)}
            >
              {/* Emoji */}
              <View style={[styles.cardEmoji, { backgroundColor: seller.bg }]}>
                <Text style={styles.cardEmojiText}>{seller.emoji}</Text>
              </View>

              {/* Info */}
              <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>{seller.display_name}</Text>
                <Text style={styles.cardBio} numberOfLines={1}>{seller.bio}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.metaText}>📍 {seller.district}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>⭐ {seller.rating_avg.toFixed(1)}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>🕐 {seller.deliveryMin} dk</Text>
                </View>
              </View>

              {/* Heart button */}
              <Pressable
                style={styles.heartBtn}
                onPress={() => removeFavorite(seller.id)}
                hitSlop={8}
              >
                <Text style={styles.heartIcon}>❤️</Text>
              </Pressable>
            </Pressable>
          ))
        )}

        {favorites.length > 0 ? (
          <View style={styles.tip}>
            <Text style={styles.tipText}>❤️ Favoriyi kaldırmak için kalbe dokun</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  sellerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardEmoji: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardEmojiText: { fontSize: 26 },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  cardBio: { fontSize: 12, color: '#A89A8A' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  metaText: { fontSize: 11, color: '#A89A8A' },
  metaDot: { fontSize: 11, color: '#C4B8AA' },

  heartBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF0F0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heartIcon: { fontSize: 18 },

  empty: { alignItems: 'center', paddingTop: 72, gap: 10, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 20 },
  exploreBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  exploreBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  tip: { marginTop: 8, alignItems: 'center' },
  tipText: { fontSize: 12, color: '#C4B8AA' },
});
