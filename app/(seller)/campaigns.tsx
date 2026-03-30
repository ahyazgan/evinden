import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { fetchActiveCoupons, type CouponRow } from '@/lib/db';

type Campaign = {
  id: string;
  title: string;
  type: 'percent' | 'fixed' | 'freeDelivery';
  value: number;
  code: string;
  active: boolean;
  usageCount: number;
  maxUsage: number;
  expiresAt: string;
};

const CAMPAIGN_TYPES = [
  { id: 'percent' as const, label: 'Yüzde İndirim', icon: '%', example: '20' },
  { id: 'fixed' as const, label: 'Sabit İndirim (₺)', icon: '₺', example: '25' },
  { id: 'freeDelivery' as const, label: 'Ücretsiz Teslimat', icon: '🚀', example: '' },
];

function rowToCampaign(row: CouponRow): Campaign {
  const typeMap: Record<string, Campaign['type']> = { percent: 'percent', fixed: 'fixed', free_delivery: 'freeDelivery' };
  return {
    id: row.id,
    title: row.title ?? row.code,
    type: typeMap[row.discount_type] ?? 'percent',
    value: row.discount_value,
    code: row.code,
    active: row.is_active,
    usageCount: row.used_count,
    maxUsage: row.max_uses ?? 0,
    expiresAt: row.expires_at ? row.expires_at.split('T')[0] : '',
  };
}

function CampaignTypeIcon({ type }: { type: Campaign['type'] }) {
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    fetchActiveCoupons()
      .then(rows => setCampaigns(rows.map(rowToCampaign)))
      .catch(() => {});
  }, []);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<Campaign['type']>('percent');
  const [formValue, setFormValue] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formMaxUsage, setFormMaxUsage] = useState('50');

  const openNew = () => {
    setEditId(null);
    setFormTitle('');
    setFormType('percent');
    setFormValue('');
    setFormCode('');
    setFormMaxUsage('50');
    setShowModal(true);
  };

  const toggleActive = (id: string) => {
    setCampaigns((prev: Campaign[]) => prev.map((c: Campaign) => c.id === id ? { ...c, active: !c.active } : c));
  };

  const deleteCampaign = (id: string) => {
    Alert.alert('Kampanyayı Sil', 'Bu kampanyayı silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => setCampaigns((prev: Campaign[]) => prev.filter((c: Campaign) => c.id !== id)) },
    ]);
  };

  const saveCampaign = () => {
    if (!formTitle.trim() || !formCode.trim()) {
      Alert.alert('Hata', 'Başlık ve kod alanları zorunludur.');
      return;
    }
    const newCamp: Campaign = {
      id: 'c-' + Date.now(),
      title: formTitle.trim(),
      type: formType,
      value: formType === 'freeDelivery' ? 0 : Math.round(parseFloat(formValue || '0') * (formType === 'fixed' ? 100 : 1)),
      code: formCode.trim().toUpperCase(),
      active: true,
      usageCount: 0,
      maxUsage: parseInt(formMaxUsage) || 50,
      expiresAt: '2026-05-01',
    };
    setCampaigns((prev: Campaign[]) => [...prev, newCamp]);
    setShowModal(false);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.backIcon}>‹</Text>
        </Pressable>
        <Text style={st.headerTitle}>Kampanyalar</Text>
        <Pressable style={st.addBtn} onPress={openNew}>
          <Text style={st.addBtnText}>+ Yeni</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
        {campaigns.length === 0 ? (
          <View style={st.empty}>
            <Text style={st.emptyEmoji}>🎉</Text>
            <Text style={st.emptyTitle}>Henüz kampanya yok</Text>
            <Text style={st.emptySub}>İlk kampanyanızı oluşturun ve satışlarınızı artırın!</Text>
          </View>
        ) : (
          campaigns.map((c) => (
            <View key={c.id} style={[st.card, !c.active && st.cardInactive]}>
              <View style={st.cardTop}>
                <CampaignTypeIcon type={c.type} />
                <View style={st.cardInfo}>
                  <Text style={st.cardTitle}>{c.title}</Text>
                  <View style={st.codeRow}>
                    <View style={st.codeBadge}>
                      <Text style={st.codeText}>{c.code}</Text>
                    </View>
                    <View style={[st.statusBadge, c.active ? st.statusActive : st.statusInactive]}>
                      <Text style={[st.statusText, c.active ? st.statusActiveText : st.statusInactiveText]}>
                        {c.active ? 'Aktif' : 'Pasif'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={st.cardStats}>
                <View style={st.cardStat}>
                  <Text style={st.cardStatLabel}>Kullanım</Text>
                  <Text style={st.cardStatValue}>{c.usageCount}/{c.maxUsage}</Text>
                </View>
                <View style={st.cardStat}>
                  <Text style={st.cardStatLabel}>İndirim</Text>
                  <Text style={st.cardStatValue}>
                    {c.type === 'percent' ? `%${c.value}` : c.type === 'fixed' ? `₺${(c.value / 100).toFixed(0)}` : 'Ücretsiz'}
                  </Text>
                </View>
                <View style={st.cardStat}>
                  <Text style={st.cardStatLabel}>Bitiş</Text>
                  <Text style={st.cardStatValue}>{new Date(c.expiresAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</Text>
                </View>
              </View>

              <View style={st.cardActions}>
                <Pressable style={st.actionBtn} onPress={() => toggleActive(c.id)}>
                  <Text style={st.actionBtnText}>{c.active ? '⏸️ Durdur' : '▶️ Aktif Et'}</Text>
                </Pressable>
                <Pressable style={[st.actionBtn, st.actionBtnDanger]} onPress={() => deleteCampaign(c.id)}>
                  <Text style={st.actionBtnDangerText}>🗑️ Sil</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* New Campaign Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Yeni Kampanya</Text>

            <Text style={st.label}>Kampanya Adı</Text>
            <TextInput style={st.input} value={formTitle} onChangeText={setFormTitle} placeholder="Örn: Hafta Sonu Fırsatı" placeholderTextColor="#B8AFA4" />

            <Text style={st.label}>Tür</Text>
            <View style={st.typeRow}>
              {CAMPAIGN_TYPES.map((t) => (
                <Pressable key={t.id} style={[st.typePill, formType === t.id && st.typePillActive]} onPress={() => setFormType(t.id)}>
                  <Text style={st.typePillIcon}>{t.icon}</Text>
                  <Text style={[st.typePillText, formType === t.id && st.typePillTextActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            {formType !== 'freeDelivery' && (
              <>
                <Text style={st.label}>{formType === 'percent' ? 'İndirim Yüzdesi' : 'İndirim Tutarı (₺)'}</Text>
                <TextInput style={st.input} value={formValue} onChangeText={setFormValue} placeholder={formType === 'percent' ? '20' : '25'} placeholderTextColor="#B8AFA4" keyboardType="decimal-pad" />
              </>
            )}

            <Text style={st.label}>Promosyon Kodu</Text>
            <TextInput style={st.input} value={formCode} onChangeText={setFormCode} placeholder="INDIRIM20" placeholderTextColor="#B8AFA4" autoCapitalize="characters" />

            <Text style={st.label}>Maksimum Kullanım</Text>
            <TextInput style={st.input} value={formMaxUsage} onChangeText={setFormMaxUsage} placeholder="50" placeholderTextColor="#B8AFA4" keyboardType="number-pad" />

            <View style={st.modalBtns}>
              <Pressable style={st.modalCancel} onPress={() => setShowModal(false)}>
                <Text style={st.modalCancelText}>İptal</Text>
              </Pressable>
              <Pressable style={st.modalSave} onPress={saveCampaign}>
                <Text style={st.modalSaveText}>Oluştur</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDE8E2',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  list: { padding: 16, gap: 12 },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#EDE8E2', gap: 14 },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  typeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  typeIconText: { fontSize: 20, fontWeight: '800' },
  cardInfo: { flex: 1, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  codeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  codeBadge: { backgroundColor: '#F7F3EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 12, fontWeight: '700', color: '#6B5E50', letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusActive: { backgroundColor: '#E8F5E9' },
  statusInactive: { backgroundColor: '#F5F5F5' },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusActiveText: { color: '#2E7D32' },
  statusInactiveText: { color: '#9E9E9E' },

  cardStats: { flexDirection: 'row', gap: 8 },
  cardStat: { flex: 1, backgroundColor: '#FAF7F2', borderRadius: 10, padding: 10, alignItems: 'center' },
  cardStatLabel: { fontSize: 10, color: '#8A7E72', fontWeight: '600' },
  cardStatValue: { fontSize: 14, fontWeight: '800', color: '#1A1208', marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F7F3EE', alignItems: 'center' },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  actionBtnDanger: { backgroundColor: '#FFF5F5' },
  actionBtnDangerText: { fontSize: 13, fontWeight: '600', color: '#C62828' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center' },

  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B5E50', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14, fontSize: 15, color: '#1A1208', borderWidth: 1, borderColor: '#EDE8E2' },
  typeRow: { gap: 8 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#EDE8E2', backgroundColor: '#FAFAFA' },
  typePillActive: { borderColor: colors.primary, backgroundColor: '#FFF5F2' },
  typePillIcon: { fontSize: 18, fontWeight: '700' },
  typePillText: { fontSize: 14, fontWeight: '600', color: '#6B5E50' },
  typePillTextActive: { color: colors.primary },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#F5F0EA' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#6B5E50' },
  modalSave: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
