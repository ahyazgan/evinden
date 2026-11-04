import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  createSellerCoupon,
  deleteSellerCoupon,
  fetchMyCampaigns,
  fetchSellerByUserId,
  setSellerCouponActive,
  type CouponRow,
} from '@/lib/db';
import { parseTLToCents } from '@/lib/pricing';
import { fonts } from '@/lib/fonts';

type CampaignType = CouponRow['discount_type'];

const CAMPAIGN_TYPES: { id: CampaignType; label: string; icon: string }[] = [
  { id: 'percent', label: 'Yüzde İndirim', icon: '%' },
  { id: 'fixed', label: 'Sabit İndirim (₺)', icon: '₺' },
  { id: 'free_delivery', label: 'Ücretsiz Teslimat', icon: '🚀' },
];

const DURATIONS = [7, 14, 30, 90];

function errorText(e: any): string {
  return e?.code === '55000' ? e.message : 'Lütfen tekrar deneyin.';
}

function isExpired(c: CouponRow): boolean {
  return !!c.expires_at && new Date(c.expires_at) <= new Date();
}

function CampaignTypeIcon({ type }: { type: CampaignType }) {
  const bg = type === 'percent' ? '#FFF3E0' : type === 'fixed' ? '#E8F5E9' : '#E3F2FD';
  const icon = type === 'percent' ? '%' : type === 'fixed' ? '₺' : '🚀';
  return (
    <View style={[st.typeIcon, { backgroundColor: bg }]}>
      <Text style={st.typeIconText}>{icon}</Text>
    </View>
  );
}

export default function CampaignsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [campaigns, setCampaigns] = useState<CouponRow[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<CampaignType>('percent');
  const [formValue, setFormValue] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formMinOrder, setFormMinOrder] = useState('');
  const [formMaxUsage, setFormMaxUsage] = useState('50');
  const [formDays, setFormDays] = useState(14);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const seller = await fetchSellerByUserId(profile.id);
      if (!seller) return;
      setSellerId(seller.id);
      setCampaigns(await fetchMyCampaigns(seller.id));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setFormTitle('');
    setFormType('percent');
    setFormValue('');
    setFormCode('');
    setFormMinOrder('');
    setFormMaxUsage('50');
    setFormDays(14);
    setShowModal(true);
  };

  const toggleActive = async (c: CouponRow) => {
    try {
      await setSellerCouponActive(c.id, !c.is_active);
      setCampaigns(prev => prev.map(x => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)));
    } catch (e) {
      Alert.alert('Kampanya güncellenemedi', errorText(e));
    }
  };

  const deleteCampaign = (c: CouponRow) => {
    Alert.alert('Kampanyayı Sil', 'Bu kampanyayı silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          try {
            const removed = await deleteSellerCoupon(c.id);
            if (removed) {
              setCampaigns(prev => prev.filter(x => x.id !== c.id));
            } else {
              setCampaigns(prev => prev.map(x => (x.id === c.id ? { ...x, is_active: false } : x)));
              Alert.alert('Kampanya durduruldu', 'Kullanılmış kampanya silinmez, geçmiş siparişler için kayıtlı kalır.');
            }
          } catch (e) {
            Alert.alert('Kampanya silinemedi', errorText(e));
          }
        },
      },
    ]);
  };

  const saveCampaign = async () => {
    if (saving || !sellerId) return;
    let value = 0;
    if (formType === 'percent') {
      value = Number(formValue.trim());
      if (!Number.isInteger(value) || value < 1 || value > 90) {
        Alert.alert('İndirim yüzdesi', '1 ile 90 arasında tam sayı girin.');
        return;
      }
    } else if (formType === 'fixed') {
      const cents = parseTLToCents(formValue);
      if (cents == null || cents < 100) {
        Alert.alert('İndirim tutarı', 'En az ₺1 olacak şekilde tutarı girin.');
        return;
      }
      value = cents;
    }
    const minOrder = parseTLToCents(formMinOrder);
    if (minOrder === undefined) {
      Alert.alert('Minimum sipariş', 'Tutarı kontrol edin.');
      return;
    }
    const maxUses = formMaxUsage.trim() === '' ? null : Number(formMaxUsage.trim());
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      Alert.alert('Kullanım sınırı', 'Geçerli bir sayı girin veya boş bırakın.');
      return;
    }

    setSaving(true);
    try {
      const created = await createSellerCoupon({
        code: formCode,
        title: formTitle,
        type: formType,
        value,
        minOrderCents: minOrder ?? 0,
        maxUses,
        expiresAt: new Date(Date.now() + formDays * 86400000).toISOString(),
      });
      setCampaigns(prev => [created, ...prev]);
      setShowModal(false);
    } catch (e) {
      Alert.alert('Kampanya oluşturulamadı', errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <Text style={st.headerTitle}>Kampanyalar</Text>
        <Pressable style={st.addBtn} onPress={openNew} disabled={!sellerId}>
          <Text style={st.addBtnText}>+ Yeni</Text>
        </Pressable>
      </View>

      {loading && !failed ? (
        <View style={st.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
          <Text style={st.notice}>
            Kampanyanız yalnızca mağazanızda geçerlidir ve sayfanızda görünür. İndirimi siz karşılarsınız, komisyon indirimli tutardan
            alınır. Her müşteri bir kez kullanabilir.
          </Text>

          {failed && <Text style={st.error}>Kampanyalar yüklenemedi. Ekrana yeniden girin.</Text>}

          {campaigns.length === 0 && !failed ? (
            <View style={st.empty}>
              <Text style={st.emptyEmoji}>🎉</Text>
              <Text style={st.emptyTitle}>Henüz kampanya yok</Text>
              <Text style={st.emptySub}>İlk kampanyanızı oluşturun ve satışlarınızı artırın!</Text>
            </View>
          ) : (
            campaigns.map((c) => {
              const expired = isExpired(c);
              const running = c.is_active && !expired;
              return (
                <View key={c.id} style={[st.card, !running && st.cardInactive]}>
                  <View style={st.cardTop}>
                    <CampaignTypeIcon type={c.discount_type} />
                    <View style={st.cardInfo}>
                      <Text style={st.cardTitle}>{c.title ?? c.code}</Text>
                      <View style={st.codeRow}>
                        <View style={st.codeBadge}>
                          <Text style={st.codeText}>{c.code}</Text>
                        </View>
                        <View style={[st.statusBadge, running ? st.statusActive : st.statusInactive]}>
                          <Text style={[st.statusText, running ? st.statusActiveText : st.statusInactiveText]}>
                            {expired ? 'Süresi doldu' : c.is_active ? 'Aktif' : 'Durduruldu'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={st.cardStats}>
                    <View style={st.cardStat}>
                      <Text style={st.cardStatLabel}>Kullanım</Text>
                      <Text style={st.cardStatValue}>{c.used_count}{c.max_uses != null ? `/${c.max_uses}` : ''}</Text>
                    </View>
                    <View style={st.cardStat}>
                      <Text style={st.cardStatLabel}>İndirim</Text>
                      <Text style={st.cardStatValue}>
                        {c.discount_type === 'percent' ? `%${c.discount_value}` : c.discount_type === 'fixed' ? `₺${(c.discount_value / 100).toFixed(0)}` : 'Ücretsiz'}
                      </Text>
                    </View>
                    <View style={st.cardStat}>
                      <Text style={st.cardStatLabel}>Bitiş</Text>
                      <Text style={st.cardStatValue}>
                        {c.expires_at ? new Date(c.expires_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '-'}
                      </Text>
                    </View>
                  </View>

                  <View style={st.cardActions}>
                    {!expired && (
                      <Pressable style={st.actionBtn} onPress={() => toggleActive(c)}>
                        <Text style={st.actionBtnText}>{c.is_active ? '⏸️ Durdur' : '▶️ Aktif Et'}</Text>
                      </Pressable>
                    )}
                    <Pressable style={[st.actionBtn, st.actionBtnDanger]} onPress={() => deleteCampaign(c)}>
                      <Text style={st.actionBtnDangerText}>Sil</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* New Campaign Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={st.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={st.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={st.modalTitle}>Yeni Kampanya</Text>

              <Text style={st.label}>Kampanya Adı</Text>
              <TextInput style={st.input} value={formTitle} onChangeText={setFormTitle} placeholder="Örn: Hafta Sonu Fırsatı" placeholderTextColor="#A3ACA5" maxLength={60} />

              <Text style={st.label}>Tür</Text>
              <View style={st.typeRow}>
                {CAMPAIGN_TYPES.map((t) => (
                  <Pressable key={t.id} style={[st.typePill, formType === t.id && st.typePillActive]} onPress={() => setFormType(t.id)}>
                    <Text style={st.typePillIcon}>{t.icon}</Text>
                    <Text style={[st.typePillText, formType === t.id && st.typePillTextActive]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              {formType !== 'free_delivery' && (
                <>
                  <Text style={st.label}>{formType === 'percent' ? 'İndirim Yüzdesi' : 'İndirim Tutarı (₺)'}</Text>
                  <TextInput style={st.input} value={formValue} onChangeText={setFormValue} placeholder={formType === 'percent' ? '20' : '25'} placeholderTextColor="#A3ACA5" keyboardType="decimal-pad" />
                </>
              )}

              <Text style={st.label}>Promosyon Kodu</Text>
              <TextInput
                style={st.input}
                value={formCode}
                onChangeText={setFormCode}
                placeholder="INDIRIM20"
                placeholderTextColor="#A3ACA5"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
              />

              <Text style={st.label}>Minimum Sipariş (₺, isteğe bağlı)</Text>
              <TextInput style={st.input} value={formMinOrder} onChangeText={setFormMinOrder} placeholder="0" placeholderTextColor="#A3ACA5" keyboardType="decimal-pad" />

              <Text style={st.label}>Toplam Kullanım Sınırı</Text>
              <TextInput style={st.input} value={formMaxUsage} onChangeText={setFormMaxUsage} placeholder="Boş bırakırsanız sınırsız" placeholderTextColor="#A3ACA5" keyboardType="number-pad" />

              <Text style={st.label}>Süre</Text>
              <View style={st.durationRow}>
                {DURATIONS.map(d => (
                  <Pressable key={d} style={[st.durationPill, formDays === d && st.typePillActive]} onPress={() => setFormDays(d)}>
                    <Text style={[st.typePillText, formDays === d && st.typePillTextActive]}>{d} gün</Text>
                  </Pressable>
                ))}
              </View>

              <View style={st.modalBtns}>
                <Pressable style={st.modalCancel} onPress={() => setShowModal(false)} disabled={saving}>
                  <Text style={st.modalCancelText}>İptal</Text>
                </Pressable>
                <Pressable style={[st.modalSave, saving && st.disabled]} onPress={saveCampaign} disabled={saving}>
                  <Text style={st.modalSaveText}>{saving ? 'Oluşturuluyor...' : 'Oluştur'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: { padding: 16, gap: 12 },
  notice: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: '#C62828', textAlign: 'center' },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E3E6DE', gap: 14 },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  typeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typeIconText: { fontSize: 20, fontFamily: fonts.display },
  cardInfo: { flex: 1, gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  codeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  codeBadge: { backgroundColor: '#F3F5EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 12, fontFamily: fonts.bold, color: '#56605A', letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusActive: { backgroundColor: '#E8F5E9' },
  statusInactive: { backgroundColor: '#F5F5F5' },
  statusText: { fontSize: 11, fontFamily: fonts.bold },
  statusActiveText: { color: '#2E7D32' },
  statusInactiveText: { color: '#9E9E9E' },

  cardStats: { flexDirection: 'row', gap: 8 },
  cardStat: { flex: 1, backgroundColor: '#FAF8F2', borderRadius: 10, padding: 10, alignItems: 'center' },
  cardStatLabel: { fontSize: 10, color: '#6B766F', fontFamily: fonts.semibold },
  cardStatValue: { fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16', marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F3F5EE', alignItems: 'center' },
  actionBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A' },
  actionBtnDanger: { backgroundColor: '#FFF5F5' },
  actionBtnDangerText: { fontSize: 13, fontFamily: fonts.semibold, color: '#C62828' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', textAlign: 'center' },

  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 32, maxHeight: '90%' },
  modalTitle: { fontSize: 20, fontFamily: fonts.display, color: '#151A16', marginBottom: 8 },
  label: { fontSize: 12, fontFamily: fonts.bold, color: '#56605A', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#FAF8F2', borderRadius: 12, padding: 14, fontFamily: fonts.regular, fontSize: 15, color: '#151A16', borderWidth: 1, borderColor: '#E3E6DE' },
  typeRow: { gap: 8 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3E6DE', backgroundColor: '#FAFAFA' },
  typePillActive: { borderColor: colors.primary, backgroundColor: '#FFF4F1' },
  typePillIcon: { fontSize: 18, fontFamily: fonts.display },
  typePillText: { fontSize: 14, fontFamily: fonts.semibold, color: '#56605A' },
  typePillTextActive: { color: colors.primary },
  durationRow: { flexDirection: 'row', gap: 8 },
  durationPill: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3E6DE', backgroundColor: '#FAFAFA' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#EFF2EA' },
  modalCancelText: { fontSize: 15, fontFamily: fonts.semibold, color: '#56605A' },
  modalSave: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  modalSaveText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },
  disabled: { opacity: 0.5 },
});
