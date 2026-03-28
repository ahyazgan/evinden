import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';
import { SellerCard } from '@/components/ui/SellerCard';
import type { Seller } from '@/types';

export default function CustomerHomeScreen() {
  const router = useRouter();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [filtered, setFiltered] = useState<Seller[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSellers();
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(sellers);
      return;
    }
    const q = search.toLowerCase();
    setFiltered(
      sellers.filter(
        (s) =>
          s.display_name.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q) ||
          s.district?.toLowerCase().includes(q),
      ),
    );
  }, [search, sellers]);

  async function fetchSellers() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('sellers')
      .select('*')
      .eq('is_active', true)
      .order('rating_avg', { ascending: false });

    if (err) {
      setError('Satıcılar yüklenemedi. Lütfen tekrar deneyin.');
    } else {
      setSellers(data ?? []);
    }
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ev Yemekleri</Text>
        <Text style={styles.headerSub}>Yakınındaki satıcıları keşfet</Text>
      </View>

      {/* Arama */}
      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="Satıcı, şehir veya ilçe ara..."
          placeholderTextColor="#bbb"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* İçerik */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText} onPress={fetchSellers}>
            Tekrar dene
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {search ? 'Sonuç bulunamadı.' : 'Henüz satıcı yok.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SellerCard
              seller={item}
              onPress={(id) => router.push(`/(customer)/seller/${id}`)}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.secondary,
  },
  headerSub: {
    fontSize: 14,
    color: '#999',
    marginTop: 2,
  },
  searchWrapper: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.secondary,
    borderWidth: 1,
    borderColor: '#eee',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#e55',
    textAlign: 'center',
  },
  retryText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 15,
    color: '#aaa',
  },
});
