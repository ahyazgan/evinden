import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type SellerItem = {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  rating_avg: number;
  rating_count: number;
  is_active: boolean;
  created_at: string;
};

export default function AdminSellersScreen() {
  const [sellers, setSellers] = useState<SellerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active'>('all');

  const loadSellers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sellers')
        .select('id, user_id, display_name, bio, city, district, rating_avg, rating_count, is_active, created_at')
        .order('created_at', { ascending: false });
      if (!error && data) setSellers(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSellers(); }, [loadSellers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSellers();
    setRefreshing(false);
  }, [loadSellers]);

  const toggleActive = async (seller: SellerItem) => {
    const newStatus = !seller.is_active;
    const action = newStatus ? 'aktif' : 'pasif';
    Alert.alert(
      `Satıcıyı ${action} yap`,
      `"${seller.display_name}" ${action} yapılacak.`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Onayla',
          onPress: async () => {
            setSellers(prev => prev.map(s => s.id === seller.id ? { ...s, is_active: newStatus } : s));
            await supabase.from('sellers').update({ is_active: newStatus }).eq('id', seller.id);
            // Also update user role if activating
            if (newStatus) {
              await supabase.from('users').update({ role: 'seller', is_approved: true }).eq('id', seller.user_id);
            }
          },
        },
      ],
    );
  };

  const deleteSeller = (seller: SellerItem) => {
    Alert.alert(
      'Satıcıyı Sil',
      `"${seller.display_name}" kalıcı olarak silinecek.`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            setSellers(prev => prev.filter(s => s.id !== seller.id));
            await supabase.from('sellers').delete().eq('id', seller.id);
          },
        },
      ],
    );
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const filtered = sellers.filter(s => {
    if (filter === 'pending') return !s.is_active;
    if (filter === 'active') return s.is_active;
    return true;
  });

  const pendingCount = sellers.filter(s => !s.is_active).length;

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Satıcı Yönetimi</Text>
        <Text style={st.headerSub}>{sellers.length} satıcı · {pendingCount} bekleyen</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
        {([
          { key: 'all', label: `Tümü (${sellers.length})` },
          { key: 'pending', label: `Bekleyen (${pendingCount})` },
          { key: 'active', label: `Aktif (${sellers.length - pendingCount})` },
        ] as const).map(tab => (
          <Pressable key={tab.key} style={[st.filterPill, filter === tab.key && st.filterPillActive]} onPress={() => setFilter(tab.key)}>
            <Text style={[st.filterText, filter === tab.key && st.filterTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="storefront-outline" size={48} color="#E8E2DA" />
            <Text style={st.emptyText}>Satıcı bulunamadı</Text>
          </View>
        ) : (
          filtered.map(seller => (
            <View key={seller.id} style={[st.card, !seller.is_active && st.cardPending]}>
              <View style={st.cardTop}>
                <View style={[st.avatar, { backgroundColor: seller.is_active ? '#E8F5E9' : '#FFF3E0' }]}>
                  <Text style={st.avatarText}>{seller.display_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={st.cardInfo}>
                  <Text style={st.cardName}>{seller.display_name}</Text>
                  <Text style={st.cardLocation}>
                    {[seller.district, seller.city].filter(Boolean).join(', ') || 'Konum belirtilmemiş'}
                  </Text>
                  <View style={st.cardMeta}>
                    <Text style={st.cardDate}>{formatDate(seller.created_at)}</Text>
                    {seller.rating_count > 0 && (
                      <Text style={st.cardRating}>⭐ {seller.rating_avg.toFixed(1)} ({seller.rating_count})</Text>
                    )}
                  </View>
                </View>
                <View style={[st.statusBadge, { backgroundColor: seller.is_active ? '#E8F5E9' : '#FFF8E1' }]}>
                  <Text style={[st.statusText, { color: seller.is_active ? '#2E7D32' : '#F57F17' }]}>
                    {seller.is_active ? 'Aktif' : 'Bekliyor'}
                  </Text>
                </View>
              </View>

              {seller.bio && <Text style={st.cardBio} numberOfLines={2}>{seller.bio}</Text>}

              <View style={st.cardActions}>
                <Pressable
                  style={[st.actionBtn, { backgroundColor: seller.is_active ? '#FFF3E0' : '#E8F5E9' }]}
                  onPress={() => toggleActive(seller)}
                >
                  <Ionicons name={seller.is_active ? 'pause-circle-outline' : 'checkmark-circle-outline'} size={16} color={seller.is_active ? '#E65100' : '#2E7D32'} />
                  <Text style={[st.actionBtnText, { color: seller.is_active ? '#E65100' : '#2E7D32' }]}>
                    {seller.is_active ? 'Pasif Yap' : 'Onayla'}
                  </Text>
                </Pressable>
                <Pressable style={[st.actionBtn, { backgroundColor: '#FFEBEE' }]} onPress={() => deleteSeller(seller)}>
                  <Ionicons name="trash-outline" size={16} color="#C62828" />
                  <Text style={[st.actionBtnText, { color: '#C62828' }]}>Sil</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1A1208' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 2 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F5F0EA', borderWidth: 1, borderColor: '#EDE8E2' },
  filterPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  filterText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#A89A8A' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#EDE8E2' },
  cardPending: { borderColor: '#FFE0B2', borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  cardLocation: { fontSize: 12, color: '#A89A8A' },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  cardDate: { fontSize: 11, color: '#C4B8AA' },
  cardRating: { fontSize: 11, color: '#6B5E50' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardBio: { fontSize: 12, color: '#6B5E50', marginTop: 10, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
});
