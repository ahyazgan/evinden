import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { Seller } from '@/types';

export default function CustomerHomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchSellers = useCallback(async () => {
    const { data } = await supabase
      .from('sellers')
      .select('*')
      .eq('is_active', true)
      .order('rating_avg', { ascending: false });
    setSellers((data as Seller[]) ?? []);
  }, []);

  useEffect(() => {
    fetchSellers().finally(() => setLoading(false));
  }, [fetchSellers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSellers();
    setRefreshing(false);
  }, [fetchSellers]);

  const filtered = search.trim()
    ? sellers.filter(
        s =>
          s.display_name.toLowerCase().includes(search.toLowerCase()) ||
          (s.city ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (s.district ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : sellers;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>evinden</Text>
          <Text style={styles.greeting}>
            Merhaba{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''} 👋
          </Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Satıcı veya konum ara..."
          placeholderTextColor="#AAAAAA"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push(`/(customer)/seller/${item.id}`)}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardName}>{item.display_name}</Text>
              {item.rating_count > 0 ? (
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>
                    ★ {Number(item.rating_avg).toFixed(1)}
                  </Text>
                </View>
              ) : null}
            </View>
            {item.city || item.district ? (
              <Text style={styles.cardLocation}>
                📍 {[item.district, item.city].filter(Boolean).join(', ')}
              </Text>
            ) : null}
            {item.bio ? (
              <Text style={styles.cardBio} numberOfLines={2}>
                {item.bio}
              </Text>
            ) : null}
            <Text style={styles.cardCta}>Menüyü Gör →</Text>
          </Pressable>
        )}
        ListHeaderComponent={
          filtered.length > 0 ? (
            <Text style={styles.sectionTitle}>Yakınındaki Satıcılar</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyTitle}>
              {search ? 'Sonuç bulunamadı' : 'Henüz satıcı yok'}
            </Text>
            <Text style={styles.emptyBody}>
              {search
                ? 'Farklı bir arama deneyin.'
                : 'Yakında ev yemekçileri burada görünecek!'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logo: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.5,
  },
  greeting: {
    fontSize: 14,
    color: '#777',
    marginTop: 2,
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0EBE3',
  },
  cardPressed: { opacity: 0.85 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.secondary,
    flex: 1,
    marginRight: 8,
  },
  ratingBadge: {
    backgroundColor: '#FFF5E8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.amber,
  },
  cardLocation: {
    fontSize: 13,
    color: '#888',
    marginBottom: 6,
  },
  cardBio: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 10,
  },
  cardCta: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 4,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 56, lineHeight: 64 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.secondary,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
