import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { SELLER_DOCUMENTS, SELLER_TYPE_LABELS } from '@/constants/business';
import { fetchSellerDocuments, type SellerDocumentRow, type SellerType } from '@/lib/db';
import { getSellerDocumentUrl } from '@/lib/storage';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

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
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
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
              Alert.alert('Satıcı güncellenemedi', error.code === '55000' ? error.message : 'Lütfen tekrar dene.');
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
            const { error } = await supabase.from('sellers').delete().eq('id', seller.id);
            if (error) {
              // Siparişi olan satıcının satırı siparişlere bağlıdır, silinemez.
              Alert.alert(
                'Satıcı silinemedi',
                error.code === '23503'
                  ? 'Bu satıcının siparişleri var, kaydı silinemez. Sipariş almasını durdurmak için "Pasif yap"ı kullan.'
                  : 'Lütfen tekrar dene.',
              );
              return;
            }
            setSellers(prev => prev.filter(s => s.id !== seller.id));
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

  return (
    <View style={st.safe}>
      <TopBar title="Satıcı yönetimi" subtitle={loading ? undefined : `${sellers.length} satıcı · ${pendingCount} bekleyen`} />

      {loading ? (
        <View style={st.loading}><LogoLoader /></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
            {([
              { key: 'all', label: `Tümü (${sellers.length})` },
              { key: 'pending', label: `Bekleyen (${pendingCount})` },
              { key: 'active', label: `Aktif (${sellers.length - pendingCount})` },
            ] as const).map(tab => (
              <Pressable
                key={tab.key}
                style={[st.filterPill, filter === tab.key && st.filterPillActive]}
                onPress={() => setFilter(tab.key)}
                hitSlop={{ top: 2, bottom: 2 }}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === tab.key }}
              >
                <Text style={[st.filterText, filter === tab.key && st.filterTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            contentContainerStyle={st.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          >
            {filtered.length === 0 ? (
              <View style={st.empty}>
                <Ionicons name="storefront-outline" size={48} color={t.textMuted} />
                <Text style={st.emptyText}>Satıcı bulunamadı</Text>
              </View>
            ) : (
              filtered.map(seller => (
                <View key={seller.id} style={st.card}>
                  <View style={st.cardTop}>
                    <View style={st.avatar}>
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
                          <View style={st.ratingRow}>
                            <Ionicons name="star" size={11} color={t.textSecondary} />
                            <Text style={st.cardRating}>{Number(seller.rating_avg).toFixed(1)} ({seller.rating_count})</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={st.statusBadge}>
                      <Text style={[st.statusText, { color: seller.is_active ? t.success : t.text }]}>
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
                            accessibilityRole={row ? 'button' : undefined}
                          >
                            <Ionicons
                              name={row ? 'document-text-outline' : 'alert-circle-outline'}
                              size={16}
                              color={row ? t.text : t.danger}
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
                    <View style={st.actionBtn}>
                      <Button
                        label={seller.is_active ? 'Pasif yap' : 'Onayla'}
                        variant={seller.is_active ? 'outline' : 'primary'}
                        onPress={() => toggleActive(seller)}
                        fullWidth
                      />
                    </View>
                    <View style={st.actionBtn}>
                      <Button label="Sil" variant="danger" onPress={() => deleteSeller(seller)} fullWidth />
                    </View>
                  </View>
                </View>
              ))
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  cardType: { fontSize: 12, fontFamily: fonts.bold, color: t.text },
  docList: { marginTop: 6 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  docText: { flex: 1, fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  docMissing: { color: t.danger },
  docOpen: { fontSize: 12, fontFamily: fonts.bold, color: t.text },
  safe: { flex: 1, backgroundColor: t.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
  filterPillActive: { backgroundColor: t.primary },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  filterTextActive: { color: t.onBrand },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: fonts.semibold, color: t.textSecondary },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontFamily: fonts.display, color: t.text },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontFamily: fonts.bold, color: t.text },
  cardLocation: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, marginTop: 2 },
  cardDate: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cardRating: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: t.background },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  cardBio: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary, marginTop: 10, lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1 },
});
