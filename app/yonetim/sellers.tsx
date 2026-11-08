import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { SELLER_DOCUMENTS, SELLER_TYPE_LABELS } from '@/constants/business';
import {
  adminRejectSeller,
  adminSetSellerCommission,
  fetchCommissionRates,
  fetchSellerApplicationReviews,
  fetchSellerCommissionOverrides,
  fetchSellerDocuments,
  type CommissionRates,
  type SellerApplicationReview,
  type SellerCommissionOverride,
  type SellerDocumentRow,
  type SellerType,
} from '@/lib/db';
import { DEFAULT_COMMISSION_RATES } from '@/constants/business';
import { Input } from '@/components/ui/Input';
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
  const [filter, setFilter] = useState<'all' | 'pending' | 'rejected' | 'active'>('all');
  const [reviews, setReviews] = useState<Map<string, SellerApplicationReview>>(new Map());
  const [overrides, setOverrides] = useState<Map<string, SellerCommissionOverride>>(new Map());
  const [rates, setRates] = useState<CommissionRates>(DEFAULT_COMMISSION_RATES);
  const [rejectFor, setRejectFor] = useState<SellerItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [commissionFor, setCommissionFor] = useState<SellerItem | null>(null);
  const [rateStr, setRateStr] = useState('');
  const [rateNote, setRateNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [approvedUsers, setApprovedUsers] = useState<Set<string>>(new Set());
  const [reviewsFailed, setReviewsFailed] = useState(false);

  const loadSellers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sellers')
        .select('id, user_id, display_name, bio, city, district, rating_avg, rating_count, is_active, seller_type, created_at')
        .not('user_id', 'is', null) // hesabı silinmiş mağazalar onay listesinde görünmez
        .order('created_at', { ascending: false });
      if (!error && data) {
        setSellers(data);
        // Daha önce onaylanmış (sonra pasife alınmış) restoranlar başvuru sayılmaz.
        const ids = data.map(s => s.user_id).filter(Boolean);
        if (ids.length > 0) {
          const { data: approved } = await supabase.from('users').select('id').in('id', ids).eq('role', 'seller').eq('is_approved', true);
          setApprovedUsers(new Set((approved ?? []).map(u => u.id as string)));
        }
      }
      const [docs, rev, over, r] = await Promise.all([
        fetchSellerDocuments(),
        fetchSellerApplicationReviews().catch(() => null),
        fetchSellerCommissionOverrides().catch(() => null),
        fetchCommissionRates().catch(() => null),
      ]);
      setDocuments(docs);
      setReviewsFailed(!rev);
      if (rev) setReviews(rev);
      if (over) setOverrides(over);
      if (r) setRates(r);
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
              // Onayda eski ret kaydı sunucuda silinir (058).
              setReviews(prev => { const next = new Map(prev); next.delete(seller.id); return next; });
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

  const confirmReject = async () => {
    if (!rejectFor) return;
    const reason = rejectReason.trim();
    if (reason.length < 5) { Alert.alert('Ret nedeni', 'Başvurana ne düzeltmesi gerektiğini yaz (en az 5 karakter).'); return; }
    setSaving(true);
    try {
      await adminRejectSeller(rejectFor.id, reason);
      setReviews(prev => new Map(prev).set(rejectFor.id, { seller_id: rejectFor.id, status: 'rejected', reason, decided_at: new Date().toISOString() }));
      setRejectFor(null);
    } catch (e: any) {
      Alert.alert('Reddedilemedi', ['22023', '55000'].includes(e?.code) ? e.message : 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const openCommission = (seller: SellerItem) => {
    const current = overrides.get(seller.id);
    setRateStr(current ? String(current.rate_percent).replace('.', ',') : '');
    setRateNote(current?.note ?? '');
    setCommissionFor(seller);
  };

  const saveCommission = async (useDefault: boolean) => {
    if (!commissionFor) return;
    let rate: number | null = null;
    if (!useDefault) {
      const text = rateStr.trim().replace(',', '.');
      rate = /^\d{1,2}(\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
      if (!Number.isFinite(rate) || rate < 0 || rate > 50) {
        Alert.alert('Geçersiz oran', 'Oranı 0 ile 50 arasında yaz (ör. 7,5).');
        return;
      }
    }
    setSaving(true);
    try {
      await adminSetSellerCommission(commissionFor.id, rate, rateNote.trim() || undefined);
      setOverrides(prev => {
        const next = new Map(prev);
        if (rate === null) next.delete(commissionFor.id);
        else next.set(commissionFor.id, { seller_id: commissionFor.id, rate_percent: rate, note: rateNote.trim() || null, updated_at: new Date().toISOString() });
        return next;
      });
      setCommissionFor(null);
    } catch (e: any) {
      Alert.alert('Oran kaydedilemedi', e?.code === '22023' ? e.message : 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const isRejected = (s: SellerItem) => !s.is_active && reviews.has(s.id);
  const isPending = (s: SellerItem) => !s.is_active && !reviews.has(s.id) && !approvedUsers.has(s.user_id);
  const filtered = sellers.filter(s => {
    if (filter === 'pending') return isPending(s);
    if (filter === 'rejected') return isRejected(s);
    if (filter === 'active') return s.is_active;
    return true;
  });

  const pendingCount = sellers.filter(isPending).length;
  const rejectedCount = sellers.filter(isRejected).length;
  const activeCount = sellers.filter(s => s.is_active).length;
  const percent = (n: number) => `%${String(n).replace('.', ',')}`;

  return (
    <View style={st.safe}>
      <TopBar title="Satıcı yönetimi" subtitle={loading ? undefined : `${sellers.length} satıcı · ${pendingCount} bekleyen`} />
      {reviewsFailed && !loading ? (
        <Text style={st.rejectReason}>  Başvuru kararları okunamadı; reddedilenler "Bekliyor" görünebilir. Sayfayı yenile.</Text>
      ) : null}

      {loading ? (
        <View style={st.loading}><LogoLoader /></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
            {([
              { key: 'all', label: `Tümü (${sellers.length})` },
              { key: 'pending', label: `Bekleyen (${pendingCount})` },
              { key: 'rejected', label: `Reddedilen (${rejectedCount})` },
              { key: 'active', label: `Aktif (${activeCount})` },
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
                      <Text style={[st.statusText, { color: seller.is_active ? t.success : isRejected(seller) ? t.danger : t.text }]}>
                        {seller.is_active ? 'Aktif' : isRejected(seller) ? 'Reddedildi' : approvedUsers.has(seller.user_id) ? 'Pasif' : 'Bekliyor'}
                      </Text>
                    </View>
                  </View>

                  {seller.bio && <Text style={st.cardBio} numberOfLines={2}>{seller.bio}</Text>}

                  {isRejected(seller) ? (
                    <Text style={st.rejectReason}>Ret nedeni: {reviews.get(seller.id)!.reason}</Text>
                  ) : null}

                  <Pressable style={st.docRow} onPress={() => openCommission(seller)} accessibilityRole="button" accessibilityHint="Bu restorana özel komisyon oranını değiştirir">
                    <Ionicons name="pricetag-outline" size={16} color={t.text} />
                    <Text style={st.docText}>
                      Komisyon {overrides.has(seller.id)
                        ? `${percent(overrides.get(seller.id)!.rate_percent)} (özel${overrides.get(seller.id)!.note ? `: ${overrides.get(seller.id)!.note}` : ''})`
                        : `${percent(seller.seller_type === 'restaurant' ? rates.restaurant : rates.home)} (genel)`}
                    </Text>
                    <Text style={st.docOpen}>Değiştir</Text>
                  </Pressable>

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
                    {/* Ret yalnızca hiç onaylanmamış başvuru içindir; pasife alınmış restoran reddedilmez. */}
                    {!seller.is_active && !approvedUsers.has(seller.user_id) ? (
                      <View style={st.actionBtn}>
                        <Button
                          label={isRejected(seller) ? 'Nedeni değiştir' : 'Reddet'}
                          variant="outline"
                          onPress={() => { setRejectReason(reviews.get(seller.id)?.reason ?? ''); setRejectFor(seller); }}
                          fullWidth
                        />
                      </View>
                    ) : null}
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

      <Modal visible={!!rejectFor} transparent animationType="fade" onRequestClose={() => setRejectFor(null)}>
        <View style={st.modalBack}>
          <View style={st.modal}>
            <Text style={st.modalTitle} accessibilityRole="header">Başvuruyu reddet</Text>
            <Text style={st.modalBody}>
              {rejectFor?.display_name} başvurusunun neden onaylanmadığını yaz. Başvurana bildirim gider; nedeni profilinde görür, düzeltip yeniden başvurabilir.
            </Text>
            <Input
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Ör: Vergi levhası okunmuyor, net bir fotoğraf yükle."
              multiline
              maxLength={500}
              style={st.modalInput}
              accessibilityLabel="Ret nedeni"
            />
            <View style={st.modalActions}>
              <View style={st.actionBtn}><Button label="Vazgeç" variant="outline" fullWidth onPress={() => setRejectFor(null)} /></View>
              <View style={st.actionBtn}><Button label="Reddet" variant="danger" fullWidth loading={saving} disabled={rejectReason.trim().length < 5} onPress={confirmReject} /></View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!commissionFor} transparent animationType="fade" onRequestClose={() => setCommissionFor(null)}>
        <View style={st.modalBack}>
          <View style={st.modal}>
            <Text style={st.modalTitle} accessibilityRole="header">Komisyon oranı</Text>
            <Text style={st.modalBody}>
              {commissionFor?.display_name} için özel oran. Yalnızca bundan sonraki siparişlere uygulanır; restorana bildirim gider. Genel oran: {percent(commissionFor?.seller_type === 'restaurant' ? rates.restaurant : rates.home)}.
            </Text>
            <Input label="Oran (%)" value={rateStr} onChangeText={setRateStr} placeholder="Ör: 7,5" keyboardType="decimal-pad" />
            <Input label="Not (isteğe bağlı)" value={rateNote} onChangeText={setRateNote} placeholder="Ör: lansman, kendi kuryesi var" maxLength={200} />
            {commissionFor && overrides.has(commissionFor.id) ? (
              <Button label="Özel oranı kaldır, genel orana dön" variant="ghost" fullWidth disabled={saving} onPress={() => saveCommission(true)} />
            ) : null}
            <View style={st.modalActions}>
              <View style={st.actionBtn}><Button label="Vazgeç" variant="outline" fullWidth disabled={saving} onPress={() => setCommissionFor(null)} /></View>
              <View style={st.actionBtn}><Button label="Kaydet" fullWidth loading={saving} disabled={!rateStr.trim()} onPress={() => saveCommission(false)} /></View>
            </View>
          </View>
        </View>
      </Modal>
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
  rejectReason: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.danger, marginTop: 10 },
  modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 460, borderRadius: 18, padding: 20, gap: 12, backgroundColor: t.surface },
  modalTitle: { fontSize: 20, fontFamily: fonts.display, color: t.heading },
  modalBody: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: t.textSecondary },
  modalInput: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 8 },
});
