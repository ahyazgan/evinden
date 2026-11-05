import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

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

const TYPE_LABELS: Record<string, string> = { percent: 'Yüzde', fixed: 'Sabit TL', free_delivery: 'Ücretsiz teslimat' };

function priceTL(cents: number) { return `₺${(cents / 100).toFixed(0)}`; }

export default function AdminCouponsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewCouponForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadCoupons = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('coupons').select('*').is('owner_id', null).is('seller_id', null).order('created_at', { ascending: false });
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

  return (
    <View style={st.safe}>
      <TopBar
        title="Kupon yönetimi"
        subtitle={loading ? undefined : `${coupons.length} kupon`}
        back
        right={<TopIconButton icon="add" label="Yeni kupon" onPress={() => { setForm(EMPTY_FORM); setShowModal(true); }} />}
      />

      {loading ? (
        <View style={st.loading}><LogoLoader /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
        >
          {coupons.map(coupon => (
            <View key={coupon.id} style={[st.card, !coupon.is_active && st.cardInactive]}>
              <View style={st.cardTop}>
                <View style={st.codeBadge}>
                  <Text style={st.codeText}>{coupon.code}</Text>
                </View>
                <Pressable
                  style={st.activeToggle}
                  onPress={() => toggleActive(coupon)}
                  accessibilityRole="button"
                  accessibilityLabel={coupon.is_active ? `${coupon.code} aktif, pasif yap` : `${coupon.code} pasif, aktif yap`}
                >
                  <View style={st.activeBadge}>
                    <Text style={[st.activeText, { color: coupon.is_active ? t.success : t.textSecondary }]}>
                      {coupon.is_active ? 'Aktif' : 'Pasif'}
                    </Text>
                  </View>
                </Pressable>
              </View>
              <Text style={st.couponTitle}>{coupon.title ?? coupon.code}</Text>
              <View style={st.couponMeta}>
                <Text style={st.metaText}>
                  {coupon.discount_type === 'percent' ? `%${coupon.discount_value}` :
                   coupon.discount_type === 'fixed' ? priceTL(coupon.discount_value) : 'Ücretsiz teslimat'}
                </Text>
                {coupon.min_order_cents > 0 && <Text style={st.metaText}>Min: {priceTL(coupon.min_order_cents)}</Text>}
                <Text style={st.metaText}>{coupon.used_count}{coupon.max_uses ? `/${coupon.max_uses}` : ''} kullanım</Text>
              </View>
              <Pressable style={st.deleteRow} onPress={() => deleteCoupon(coupon)} accessibilityRole="button" accessibilityLabel={`${coupon.code} kuponunu sil`}>
                <Ionicons name="trash-outline" size={16} color={t.danger} />
                <Text style={st.deleteText}>Sil</Text>
              </Pressable>
            </View>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Create Coupon Modal: sayfa kağıdı kendi güvenli alanını ölçer, bu yüzden TopBar kullanılmaz */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={st.modal} edges={['top', 'bottom']}>
          <View style={st.modalHeader}>
            <Text style={st.modalTitle} accessibilityRole="header">Yeni kupon</Text>
            <TopIconButton icon="close" label="Vazgeç" onPress={() => setShowModal(false)} />
          </View>
          <ScrollView contentContainerStyle={st.modalScroll} keyboardShouldPersistTaps="handled">
            <Input label="Kupon kodu *" value={form.code} onChangeText={v => setForm(f => ({ ...f, code: v }))} placeholder="LEZZET20" autoCapitalize="characters" />

            <Input label="Başlık *" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="Hoş geldin indirimi" />

            <View style={st.typeField}>
              <Text style={st.label}>İndirim tipi</Text>
              <View style={st.typeRow}>
                {(['percent', 'fixed', 'free_delivery'] as const).map(type => (
                  <Pressable
                    key={type}
                    style={[st.typePill, form.discount_type === type && st.typePillActive]}
                    onPress={() => setForm(f => ({ ...f, discount_type: type }))}
                    hitSlop={{ top: 2, bottom: 2 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: form.discount_type === type }}
                  >
                    <Text style={[st.typeText, form.discount_type === type && st.typeTextActive]} numberOfLines={1} adjustsFontSizeToFit>{TYPE_LABELS[type]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {form.discount_type !== 'free_delivery' && (
              <Input
                label={form.discount_type === 'percent' ? 'Yüzde (%)' : 'Tutar (₺)'}
                value={form.discount_value}
                onChangeText={v => setForm(f => ({ ...f, discount_value: v }))}
                placeholder={form.discount_type === 'percent' ? '20' : '50'}
                keyboardType="number-pad"
              />
            )}

            <Input label="Min. sipariş (₺)" value={form.min_order} onChangeText={v => setForm(f => ({ ...f, min_order: v }))} placeholder="0" keyboardType="number-pad" />

            <Input label="Maks. kullanım" value={form.max_uses} onChangeText={v => setForm(f => ({ ...f, max_uses: v }))} placeholder="Sınırsız" keyboardType="number-pad" />

            <View style={st.modalAction}>
              <Button label="Oluştur" size="lg" onPress={createCoupon} loading={saving} fullWidth />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  cardInactive: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeBadge: { backgroundColor: t.brand, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  codeText: { color: t.onBrand, fontSize: 14, fontFamily: fonts.extrabold, letterSpacing: 1 },
  activeToggle: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  activeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: t.background },
  activeText: { fontSize: 11, fontFamily: fonts.bold },
  couponTitle: { fontSize: 14, fontFamily: fonts.semibold, color: t.text, marginTop: 6 },
  couponMeta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, marginTop: 6 },
  metaText: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  deleteRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 44, marginTop: 4, paddingRight: 12 },
  deleteText: { fontSize: 13, color: t.danger, fontFamily: fonts.semibold },
  modal: { flex: 1, backgroundColor: t.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  modalTitle: { flex: 1, fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.5, color: t.heading },
  modalScroll: { padding: 16, gap: 14 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  typeField: { gap: 5 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typePill: { flex: 1, height: 40, paddingHorizontal: 8, borderRadius: 10, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
  typePillActive: { backgroundColor: t.primary },
  typeText: { fontSize: 12, fontFamily: fonts.semibold, color: t.text },
  typeTextActive: { color: t.onBrand },
  modalAction: { marginTop: 6 },
});
