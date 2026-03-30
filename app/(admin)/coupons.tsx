import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type CouponItem = {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  discount_value: number;
  min_order_cents: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  title: string | null;
  description: string | null;
  expires_at: string | null;
  created_at: string;
};

type NewCouponForm = {
  code: string;
  title: string;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  discount_value: string;
  min_order: string;
  max_uses: string;
};

const EMPTY_FORM: NewCouponForm = { code: '', title: '', discount_type: 'percent', discount_value: '', min_order: '', max_uses: '' };

const TYPE_LABELS: Record<string, string> = { percent: 'Yüzde', fixed: 'Sabit TL', free_delivery: 'Ücretsiz Teslimat' };

function priceTL(cents: number) { return `₺${(cents / 100).toFixed(0)}`; }

export default function AdminCouponsScreen() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewCouponForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadCoupons = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
      if (!error && data) setCoupons(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCoupons(); }, [loadCoupons]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCoupons();
    setRefreshing(false);
  }, [loadCoupons]);

  const toggleActive = async (coupon: CouponItem) => {
    const newActive = !coupon.is_active;
    setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, is_active: newActive } : c));
    await supabase.from('coupons').update({ is_active: newActive }).eq('id', coupon.id);
  };

  const deleteCoupon = (coupon: CouponItem) => {
    Alert.alert('Kuponu Sil', `"${coupon.code}" silinecek.`, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive',
        onPress: async () => {
          setCoupons(prev => prev.filter(c => c.id !== coupon.id));
          await supabase.from('coupons').delete().eq('id', coupon.id);
        },
      },
    ]);
  };

  const createCoupon = async () => {
    if (!form.code.trim() || !form.title.trim()) {
      Alert.alert('Kod ve başlık zorunlu');
      return;
    }
    setSaving(true);
    try {
      const discountValue = parseInt(form.discount_value || '0', 10);
      const { error } = await supabase.from('coupons').insert({
        code: form.code.toUpperCase().trim(),
        title: form.title.trim(),
        discount_type: form.discount_type,
        discount_value: form.discount_type === 'fixed' ? discountValue * 100 : discountValue,
        min_order_cents: parseInt(form.min_order || '0', 10) * 100,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        is_active: true,
      });
      if (error) throw error;
      setShowModal(false);
      setForm(EMPTY_FORM);
      loadCoupons();
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Kupon oluşturulamadı');
    } finally { setSaving(false); }
  };

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
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Kupon Yönetimi</Text>
          <Text style={st.headerSub}>{coupons.length} kupon</Text>
        </View>
        <Pressable style={st.addBtn} onPress={() => { setForm(EMPTY_FORM); setShowModal(true); }}>
          <Text style={st.addBtnText}>+ Yeni</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {coupons.map(coupon => (
          <View key={coupon.id} style={[st.card, !coupon.is_active && st.cardInactive]}>
            <View style={st.cardTop}>
              <View style={st.codeBadge}>
                <Text style={st.codeText}>{coupon.code}</Text>
              </View>
              <Pressable onPress={() => toggleActive(coupon)}>
                <View style={[st.activeBadge, { backgroundColor: coupon.is_active ? '#E8F5E9' : '#F5F5F5' }]}>
                  <Text style={[st.activeText, { color: coupon.is_active ? '#2E7D32' : '#9E9E9E' }]}>
                    {coupon.is_active ? 'Aktif' : 'Pasif'}
                  </Text>
                </View>
              </Pressable>
            </View>
            <Text style={st.couponTitle}>{coupon.title ?? coupon.code}</Text>
            <View style={st.couponMeta}>
              <Text style={st.metaText}>
                {coupon.discount_type === 'percent' ? `%${coupon.discount_value}` :
                 coupon.discount_type === 'fixed' ? priceTL(coupon.discount_value) : 'Ücretsiz Teslimat'}
              </Text>
              {coupon.min_order_cents > 0 && <Text style={st.metaText}>Min: {priceTL(coupon.min_order_cents)}</Text>}
              <Text style={st.metaText}>{coupon.used_count}{coupon.max_uses ? `/${coupon.max_uses}` : ''} kullanım</Text>
            </View>
            <Pressable style={st.deleteRow} onPress={() => deleteCoupon(coupon)}>
              <Ionicons name="trash-outline" size={14} color="#C62828" />
              <Text style={st.deleteText}>Sil</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Create Coupon Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={st.modal} edges={['top', 'bottom']}>
          <View style={st.modalHeader}>
            <Pressable onPress={() => setShowModal(false)}>
              <Text style={st.modalCancel}>İptal</Text>
            </Pressable>
            <Text style={st.modalTitle}>Yeni Kupon</Text>
            <Pressable onPress={createCoupon} disabled={saving}>
              <Text style={[st.modalSave, saving && { opacity: 0.5 }]}>{saving ? '...' : 'Oluştur'}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={st.modalScroll}>
            <Text style={st.label}>Kupon Kodu *</Text>
            <TextInput style={st.input} value={form.code} onChangeText={t => setForm(f => ({ ...f, code: t }))} placeholder="EVINDEN20" placeholderTextColor="#C4B8AA" autoCapitalize="characters" />

            <Text style={[st.label, { marginTop: 14 }]}>Başlık *</Text>
            <TextInput style={st.input} value={form.title} onChangeText={t => setForm(f => ({ ...f, title: t }))} placeholder="Hoş geldin indirimi" placeholderTextColor="#C4B8AA" />

            <Text style={[st.label, { marginTop: 14 }]}>İndirim Tipi</Text>
            <View style={st.typeRow}>
              {(['percent', 'fixed', 'free_delivery'] as const).map(type => (
                <Pressable key={type} style={[st.typePill, form.discount_type === type && st.typePillActive]} onPress={() => setForm(f => ({ ...f, discount_type: type }))}>
                  <Text style={[st.typeText, form.discount_type === type && st.typeTextActive]}>{TYPE_LABELS[type]}</Text>
                </Pressable>
              ))}
            </View>

            {form.discount_type !== 'free_delivery' && (
              <>
                <Text style={[st.label, { marginTop: 14 }]}>{form.discount_type === 'percent' ? 'Yüzde (%)' : 'Tutar (₺)'}</Text>
                <TextInput style={st.input} value={form.discount_value} onChangeText={t => setForm(f => ({ ...f, discount_value: t }))} placeholder={form.discount_type === 'percent' ? '20' : '50'} placeholderTextColor="#C4B8AA" keyboardType="number-pad" />
              </>
            )}

            <Text style={[st.label, { marginTop: 14 }]}>Min. Sipariş (₺)</Text>
            <TextInput style={st.input} value={form.min_order} onChangeText={t => setForm(f => ({ ...f, min_order: t }))} placeholder="0" placeholderTextColor="#C4B8AA" keyboardType="number-pad" />

            <Text style={[st.label, { marginTop: 14 }]}>Maks. Kullanım</Text>
            <TextInput style={st.input} value={form.max_uses} onChangeText={t => setForm(f => ({ ...f, max_uses: t }))} placeholder="Sınırsız" placeholderTextColor="#C4B8AA" keyboardType="number-pad" />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 1 },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#EDE8E2' },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeBadge: { backgroundColor: '#1A1208', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  codeText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  activeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  activeText: { fontSize: 11, fontWeight: '700' },
  couponTitle: { fontSize: 14, fontWeight: '600', color: '#1A1208', marginTop: 10 },
  couponMeta: { flexDirection: 'row', gap: 12, marginTop: 6 },
  metaText: { fontSize: 12, color: '#6B5E50' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  deleteText: { fontSize: 12, color: '#C62828', fontWeight: '500' },
  modal: { flex: 1, backgroundColor: '#FAF7F2' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  modalCancel: { fontSize: 15, color: '#A89A8A', fontWeight: '600' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1A1208' },
  modalSave: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  modalScroll: { padding: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#6B5E50', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#EDE8E2', color: '#1A1208', fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typePill: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F5F0EA', alignItems: 'center', borderWidth: 1, borderColor: '#EDE8E2' },
  typePillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  typeText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  typeTextActive: { color: '#fff' },
});
