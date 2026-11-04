import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { SELLER_DOCUMENTS, SELLER_TYPE_LABELS } from '@/constants/business';
import { fetchSellerDocuments, type SellerDocumentRow, type SellerType } from '@/lib/db';
import { getSellerDocumentUrl } from '@/lib/storage';
import { fonts } from '@/lib/fonts';

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
  seller_type: SellerType;
  created_at: string;
};

export default function AdminSellersScreen() {
  const [sellers, setSellers] = useState<SellerItem[]>([]);
  const [documents, setDocuments] = useState<SellerDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active'>('all');

  const loadSellers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sellers')
        .select('id, user_id, display_name, bio, city, district, rating_avg, rating_count, is_active, seller_type, created_at')
        .not('user_id', 'is', null) // hesabı silinmiş mağazalar onay listesinde görünmez
        .order('created_at', { ascending: false });
      if (!error && data) setSellers(data);
      setDocuments(await fetchSellerDocuments());
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
            const { error } = await supabase.from('sellers').update({ is_active: newStatus }).eq('id', seller.id);
            if (error) {
              setSellers(prev => prev.map(s => s.id === seller.id ? { ...s, is_active: seller.is_active } : s));
              // Sunucunun açıkladığı engel (eksik belge) olduğu gibi gösterilir.
              Alert.alert('Satıcı güncellenemedi', error.code === '55000' ? error.message : 'Lütfen tekrar deneyin.');
              return;
            }
            // Also update user role if activating
            if (newStatus) {
              await supabase.from('users').update({ role: 'seller', is_approved: true }).eq('id', seller.user_id);
            }
          },
        },
      ],
    );
  };

  const openDocument = async (path: string) => {
    try {
      await Linking.openURL(await getSellerDocumentUrl(path));
    } catch {
      Alert.alert('Hata', 'Belge açılamadı.');
    }
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
            <Ionicons name="storefront-outline" size={48} color="#DDE1D8" />
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
                    <Text style={st.cardType}>{SELLER_TYPE_LABELS[seller.seller_type ?? 'home']}</Text>
                    <Text style={st.cardDate}>{formatDate(seller.created_at)}</Text>
                    {seller.rating_count > 0 && (
                      <Text style={st.cardRating}>⭐ {Number(seller.rating_avg).toFixed(1)} ({seller.rating_count})</Text>
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

              {seller.seller_type === 'restaurant' && (
                <View style={st.docList}>
                  {SELLER_DOCUMENTS.map(doc => {
                    const row = documents.find(d => d.seller_id === seller.id && d.doc_type === doc.id);
                    return (
                      <Pressable
                        key={doc.id}
                        style={st.docRow}
                        disabled={!row}
                        onPress={() => row && openDocument(row.storage_path)}
                      >
                        <Ionicons
                          name={row ? 'document-text-outline' : 'alert-circle-outline'}
                          size={16}
                          color={row ? colors.primary : '#C62828'}
                        />
                        <Text style={[st.docText, !row && st.docMissing]}>
                          {doc.title}{row ? '' : ' (eksik)'}
                        </Text>
                        {row && <Text style={st.docOpen}>Görüntüle</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              )}

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
  cardType: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary },
  docList: { gap: 8, marginTop: 10 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  docText: { flex: 1, fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  docMissing: { color: '#C62828' },
  docOpen: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E3E6DE' },
  headerTitle: { fontSize: 22, fontFamily: fonts.display, color: '#151A16' },
  headerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 2 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#EFF2EA', borderWidth: 1, borderColor: '#E3E6DE' },
  filterPillActive: { backgroundColor: '#17402F', borderColor: '#151A16' },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: fonts.semibold, color: '#6B766F' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E3E6DE' },
  cardPending: { borderColor: '#FFE0B2', borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  cardLocation: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  cardMeta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  cardDate: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ACA5' },
  cardRating: { fontFamily: fonts.regular, fontSize: 11, color: '#56605A' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  cardBio: { fontFamily: fonts.regular, fontSize: 12, color: '#56605A', marginTop: 10, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionBtnText: { fontSize: 13, fontFamily: fonts.semibold },
});
