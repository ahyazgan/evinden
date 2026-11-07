import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

type CampaignType = CouponRow['discount_type'];

const CAMPAIGN_TYPES: { id: CampaignType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'percent', label: 'Yüzde indirim', icon: 'pricetag-outline' },
  { id: 'fixed', label: 'Sabit indirim (₺)', icon: 'cash-outline' },
  { id: 'free_delivery', label: 'Ücretsiz teslimat', icon: 'bicycle-outline' },
];

const DURATIONS = [7, 14, 30, 90];

function errorText(e: any): string {
  return e?.code === '55000' ? e.message : 'Lütfen tekrar dene.';
}

function isExpired(c: CouponRow): boolean {
  return !!c.expires_at && new Date(c.expires_at) <= new Date();
}

function CampaignTypeIcon({ type }: { type: CampaignType }) {
  const { colors: t } = useTheme();
  const icon = CAMPAIGN_TYPES.find(c => c.id === type)?.icon ?? 'pricetag-outline';
  return (
    <View style={[st.typeIcon, { backgroundColor: t.background }]}>
      <Ionicons name={icon} size={20} color={t.text} />
    </View>
  );
}

export default function CampaignsScreen() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
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
    Alert.alert('Kampanyayı sil', 'Bu kampanyayı silmek istediğine emin misin?', [
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
        Alert.alert('İndirim yüzdesi', '1 ile 90 arasında tam sayı gir.');
        return;
      }
    } else if (formType === 'fixed') {
      const cents = parseTLToCents(formValue);
      if (cents == null || cents < 100) {
        Alert.alert('İndirim tutarı', 'En az ₺1 olacak şekilde tutarı gir.');
        return;
      }
      value = cents;
    }
    const minOrder = parseTLToCents(formMinOrder);
    if (minOrder === undefined) {
      Alert.alert('Minimum sipariş', 'Tutarı kontrol et.');
      return;
    }
    const maxUses = formMaxUsage.trim() === '' ? null : Number(formMaxUsage.trim());
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      Alert.alert('Kullanım sınırı', 'Geçerli bir sayı gir veya boş bırak.');
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
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Kampanyalar"
        back
        right={
          <Pressable
            style={[st.topBtn, { backgroundColor: isDesktop ? t.primary : t.panel }, !sellerId && st.disabled]}
            onPress={openNew}
            disabled={!sellerId}
            accessibilityRole="button"
            accessibilityLabel="Yeni kampanya"
            accessibilityState={{ disabled: !sellerId }}
          >
            <Ionicons name="add" size={18} color={t.onBrand} />
            <Text style={[st.topBtnText, { color: t.onBrand }]}>Yeni</Text>
          </Pressable>
        }
      />

      {loading && !failed ? (
        <View style={st.center}><LogoLoader /></View>
      ) : (
        <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
          <Text style={[st.notice, { color: t.textSecondary }]}>
            Kampanyan yalnızca mağazanda geçerlidir ve sayfanda görünür. İndirimi sen karşılarsın, komisyon indirimli tutardan
            alınır. Her müşteri bir kez kullanabilir.
          </Text>

          {failed && <Text style={[st.error, { color: t.danger }]}>Kampanyalar yüklenemedi. Ekrana yeniden gir.</Text>}

          {campaigns.length === 0 && !failed ? (
            <View style={st.empty}>
              <Ionicons name="pricetag-outline" size={44} color={t.textMuted} />
              <Text style={[st.emptyTitle, { color: t.heading }]}>Henüz kampanya yok</Text>
              <Text style={[st.emptySub, { color: t.textSecondary }]}>İlk kampanyanı oluştur, satışlarını artır.</Text>
            </View>
          ) : (
            campaigns.map((c) => {
              const expired = isExpired(c);
              const running = c.is_active && !expired;
              return (
                <View key={c.id} style={[st.card, { backgroundColor: t.surface }]}>
                  <View style={[st.cardBody, !running && st.cardInactive]}>
                    <View style={st.cardTop}>
                      <CampaignTypeIcon type={c.discount_type} />
                      <View style={st.cardInfo}>
                        <Text style={[st.cardTitle, { color: t.text }]}>{c.title ?? c.code}</Text>
                        <View style={st.codeRow}>
                          <View style={[st.badge, { backgroundColor: t.background }]}>
                            <Text style={[st.codeText, { color: t.textSecondary }]}>{c.code}</Text>
                          </View>
                          <View style={[st.badge, { backgroundColor: t.background }]}>
                            <Text style={[st.statusText, { color: running ? t.success : t.textSecondary }]}>
                              {expired ? 'Süresi doldu' : c.is_active ? 'Aktif' : 'Durduruldu'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    <View style={st.cardStats}>
                      <View style={[st.cardStat, { backgroundColor: t.background }]}>
                        <Text style={[st.cardStatLabel, { color: t.textSecondary }]}>Kullanım</Text>
                        <Text style={[st.cardStatValue, { color: t.text }]}>{c.used_count}{c.max_uses != null ? `/${c.max_uses}` : ''}</Text>
                      </View>
                      <View style={[st.cardStat, { backgroundColor: t.background }]}>
                        <Text style={[st.cardStatLabel, { color: t.textSecondary }]}>İndirim</Text>
                        <Text style={[st.cardStatValue, { color: t.text }]}>
                          {c.discount_type === 'percent' ? `%${c.discount_value}` : c.discount_type === 'fixed' ? `₺${(c.discount_value / 100).toFixed(0)}` : 'Ücretsiz'}
                        </Text>
                      </View>
                      <View style={[st.cardStat, { backgroundColor: t.background }]}>
                        <Text style={[st.cardStatLabel, { color: t.textSecondary }]}>Bitiş</Text>
                        <Text style={[st.cardStatValue, { color: t.text }]}>
                          {c.expires_at ? new Date(c.expires_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '-'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={st.cardActions}>
                    {!expired && (
                      <Pressable
                        style={[st.actionBtn, { backgroundColor: t.background }]}
                        onPress={() => toggleActive(c)}
                        accessibilityRole="button"
                      >
                        <Ionicons name={c.is_active ? 'pause' : 'play'} size={16} color={t.text} />
                        <Text style={[st.actionBtnText, { color: t.text }]}>{c.is_active ? 'Durdur' : 'Aktif et'}</Text>
                      </Pressable>
                    )}
                    <View style={st.flex}>
                      <Button label="Sil" variant="danger" fullWidth onPress={() => deleteCampaign(c)} />
                    </View>
                  </View>
                </View>
              );
            })
          )}
          <View style={st.bottomSpace} />
        </ScrollView>
      )}

      {/* New Campaign Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={st.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[st.modalCard, { backgroundColor: t.surface }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[st.modalTitle, { color: t.heading }]} accessibilityRole="header">Yeni kampanya</Text>

              <View style={st.field}>
                <Input label="Kampanya adı" value={formTitle} onChangeText={setFormTitle} placeholder="Örn: Hafta Sonu Fırsatı" maxLength={60} />
              </View>

              <View style={st.field}>
                <Text style={[st.label, { color: t.text }]}>Tür</Text>
                <View style={st.typeRow}>
                  {CAMPAIGN_TYPES.map((type) => {
                    const on = formType === type.id;
                    return (
                      <Pressable
                        key={type.id}
                        style={[st.chip, { backgroundColor: on ? t.brand : t.background }]}
                        hitSlop={2}
                        onPress={() => setFormType(type.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Ionicons name={type.icon} size={16} color={on ? t.onBrand : t.text} />
                        <Text style={[st.chipText, { color: on ? t.onBrand : t.text }]}>{type.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {formType !== 'free_delivery' && (
                <View style={st.field}>
                  <Input
                    label={formType === 'percent' ? 'İndirim yüzdesi' : 'İndirim tutarı (₺)'}
                    value={formValue}
                    onChangeText={setFormValue}
                    placeholder={formType === 'percent' ? '20' : '25'}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}

              <View style={st.field}>
                <Input
                  label="Promosyon kodu"
                  value={formCode}
                  onChangeText={setFormCode}
                  placeholder="INDIRIM20"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={20}
                />
              </View>

              <View style={st.field}>
                <Input label="Minimum sipariş (₺, isteğe bağlı)" value={formMinOrder} onChangeText={setFormMinOrder} placeholder="0" keyboardType="decimal-pad" />
              </View>

              <View style={st.field}>
                <Input label="Toplam kullanım sınırı" value={formMaxUsage} onChangeText={setFormMaxUsage} placeholder="Boş bırakırsan sınırsız" keyboardType="number-pad" />
              </View>

              <View style={st.field}>
                <Text style={[st.label, { color: t.text }]}>Süre</Text>
                <View style={st.durationRow}>
                  {DURATIONS.map(d => {
                    const on = formDays === d;
                    return (
                      <Pressable
                        key={d}
                        style={[st.chip, st.flex, { backgroundColor: on ? t.brand : t.background }]}
                        hitSlop={2}
                        onPress={() => setFormDays(d)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[st.chipText, { color: on ? t.onBrand : t.text }]}>{d} gün</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={st.modalBtns}>
                <View style={st.flex}>
                  <Button label="İptal" variant="outline" fullWidth disabled={saving} onPress={() => setShowModal(false)} />
                </View>
                <View style={st.flex}>
                  <Button label={saving ? 'Oluşturuluyor...' : 'Oluştur'} fullWidth disabled={saving} onPress={saveCampaign} />
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  bottomSpace: { height: 20 },
  disabled: { opacity: 0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBtn: { height: 44, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  topBtnText: { fontSize: 14, fontFamily: fonts.bold },

  list: { padding: 16, gap: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  error: { fontSize: 13, fontFamily: fonts.regular, textAlign: 'center' },

  card: { borderRadius: 16, padding: 14, gap: 12 },
  cardBody: { gap: 12 },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  typeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0, gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold },
  codeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  codeText: { fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1 },
  statusText: { fontSize: 11, fontFamily: fonts.bold },

  cardStats: { flexDirection: 'row', gap: 8 },
  cardStat: { flex: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  cardStatLabel: { fontSize: 11, fontFamily: fonts.semibold },
  cardStatValue: { fontSize: 14, fontFamily: fonts.extrabold, marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, minHeight: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionBtnText: { fontSize: 14, fontFamily: fonts.bold },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },

  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '90%' },
  modalTitle: { fontSize: 20, lineHeight: 26, fontFamily: fonts.display, letterSpacing: -0.4 },
  field: { marginTop: 14 },
  label: { fontSize: 13, fontFamily: fonts.semibold, marginBottom: 5 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  durationRow: { flexDirection: 'row', gap: 8 },
  modalBtns: { flexDirection: 'row', gap: 8, marginTop: 20 },
});
