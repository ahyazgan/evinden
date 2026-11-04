import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { DELIVERY_CONFIG, SELLER_TYPE_LABELS } from '@/constants/business';
import { adminBroadcast, fetchCommissionRates, fetchOnlinePaymentEnabled, fetchOrderPricing, setOnlinePaymentEnabled, updateCommissionRates, type SellerType } from '@/lib/db';
import { DEFAULT_ORDER_PRICING } from '@/lib/pricing';
import { fonts } from '@/lib/fonts';

const RATE_ROWS: SellerType[] = ['home', 'restaurant'];

function parseRate(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export default function AdminSettingsScreen() {
  const { signOut, profile } = useAuth();
  const router = useRouter();
  const [rates, setRates] = useState<Record<SellerType, string> | null>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [platformPricing, setPlatformPricing] = useState(DEFAULT_ORDER_PRICING);
  const [onlineEnabled, setOnlineEnabled] = useState(false);

  useEffect(() => {
    fetchOrderPricing().then(setPlatformPricing).catch(() => {});
    fetchOnlinePaymentEnabled().then(setOnlineEnabled).catch(() => {});
  }, []);

  const [dutyTitle, setDutyTitle] = useState('');
  const [dutyBody, setDutyBody] = useState('');
  const [dutyAudience, setDutyAudience] = useState<'all' | 'buyer' | 'seller'>('all');
  const [dutySending, setDutySending] = useState(false);

  const sendBroadcast = () => {
    const title = dutyTitle.trim();
    const body = dutyBody.trim();
    if (!title || !body) {
      Alert.alert('Eksik bilgi', 'Başlık ve metin yaz.');
      return;
    }
    const who = dutyAudience === 'all' ? 'tüm kullanıcılara' : dutyAudience === 'buyer' ? 'müşterilere' : 'satıcılara';
    Alert.alert('Duyuru gönderilsin mi?', `Bu duyuru ${who} bildirim olarak gidecek. Geri alınamaz.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Gönder',
        onPress: async () => {
          setDutySending(true);
          try {
            const count = await adminBroadcast(title, body, dutyAudience);
            setDutyTitle('');
            setDutyBody('');
            Alert.alert('Gönderildi', `${count} kişiye gitti.`);
          } catch (e: any) {
            Alert.alert('Gönderilemedi', e?.code === '22023' ? e.message : 'Lütfen tekrar dene.');
          } finally {
            setDutySending(false);
          }
        },
      },
    ]);
  };

  const applyOnlinePayment = async (enabled: boolean) => {
    try {
      await setOnlinePaymentEnabled(enabled);
      setOnlineEnabled(enabled);
    } catch {
      Alert.alert('Hata', 'Ayar kaydedilemedi.');
    }
  };

  const toggleOnlinePayment = (enabled: boolean) => {
    if (!enabled) {
      applyOnlinePayment(false);
      return;
    }
    Alert.alert(
      'Online ödemeyi aç',
      'iyzico anahtarları tanımlı ve fonksiyonlar yüklü olmalıdır. Müşteriler kartla ödeme yapmaya başlayacak.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Aç', onPress: () => applyOnlinePayment(true) },
      ],
    );
  };

  useEffect(() => {
    fetchCommissionRates()
      .then(r => setRates({ home: String(r.home), restaurant: String(r.restaurant) }))
      .catch(() => Alert.alert('Hata', 'Komisyon oranları okunamadı.'));
  }, []);

  const saveRates = async () => {
    if (!rates) return;
    const home = parseRate(rates.home);
    const restaurant = parseRate(rates.restaurant);
    if (home == null || restaurant == null) {
      Alert.alert('Geçersiz oran', 'Oranlar 0 ile 100 arasında bir sayı olmalıdır.');
      return;
    }
    setSavingRates(true);
    try {
      await updateCommissionRates({ home, restaurant });
      Alert.alert('Kaydedildi', 'Yeni oranlar bundan sonraki siparişlere uygulanır.');
    } catch {
      Alert.alert('Hata', 'Komisyon oranları kaydedilemedi.');
    } finally {
      setSavingRates(false);
    }
  };

  const handleLogout = () => {
    signOut();
    router.replace('/(auth)/login' as any);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Ayarlar</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Hesap</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="person-circle-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>{profile?.name ?? 'Admin'}</Text>
              <Text style={st.rowSub}>Admin hesabı</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Komisyon Oranları</Text>
        <View style={st.card}>
          {RATE_ROWS.map((type, i) => (
            <View key={type} style={[st.row, i > 0 && st.rowBorder]}>
              <View style={st.rowInfo}>
                <Text style={st.rowLabel}>{SELLER_TYPE_LABELS[type]}</Text>
                <Text style={st.rowSub}>Sipariş tutarı üzerinden</Text>
              </View>
              <Text style={st.ratePrefix}>%</Text>
              <TextInput
                style={st.rateInput}
                value={rates?.[type] ?? ''}
                editable={!!rates && !savingRates}
                onChangeText={text => setRates(prev => (prev ? { ...prev, [type]: text } : prev))}
                keyboardType="decimal-pad"
                placeholder="-"
                placeholderTextColor="#6B766F"
              />
            </View>
          ))}
          <Pressable
            style={[st.row, st.rowBorder, st.saveRow, (!rates || savingRates) && { opacity: 0.5 }]}
            disabled={!rates || savingRates}
            onPress={saveRates}
          >
            {savingRates
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={st.saveText}>Oranları Kaydet</Text>}
          </Pressable>
        </View>
        <Text style={st.sectionHint}>Değişiklik yalnızca yeni siparişlere uygulanır, eski siparişlerin oranı değişmez.</Text>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Ödeme</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="card-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Online Ödeme (iyzico)</Text>
              <Text style={st.rowSub}>{onlineEnabled ? 'Açık' : 'Kapalı: yalnızca kapıda ödeme'}</Text>
            </View>
            <Switch value={onlineEnabled} onValueChange={toggleOnlinePayment} />
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Teslimat</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="bicycle-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Teslimat Modeli</Text>
              <Text style={st.rowSub}>{DELIVERY_CONFIG.model === 'seller_courier' ? 'Esnaf Kurye' : 'Platform Kurye'}</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="navigate-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Teslimat Alanı</Text>
              <Text style={st.rowSub}>Her satıcı kendi belirler</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="cash-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Varsayılan Ücret</Text>
              <Text style={st.rowSub}>₺{(platformPricing.deliveryFeeCents / 100).toFixed(0)}, ₺{(platformPricing.freeDeliveryThresholdCents / 100).toFixed(0)} üzeri ücretsiz</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Toplu duyuru</Text>
        <View style={[st.card, st.dutyCard]}>
          <TextInput style={st.dutyInput} value={dutyTitle} onChangeText={setDutyTitle} placeholder="Başlık" placeholderTextColor="#6B766F" maxLength={80} />
          <TextInput style={[st.dutyInput, st.dutyBody]} value={dutyBody} onChangeText={setDutyBody} placeholder="Metin" placeholderTextColor="#6B766F" maxLength={300} multiline textAlignVertical="top" />
          <View style={st.dutyRow}>
            {([['all', 'Herkes'], ['buyer', 'Müşteriler'], ['seller', 'Satıcılar']] as const).map(([key, label]) => (
              <Pressable key={key} style={[st.dutyChip, dutyAudience === key && st.dutyChipOn]} onPress={() => setDutyAudience(key)} accessibilityRole="radio" accessibilityState={{ selected: dutyAudience === key }}>
                <Text style={[st.dutyChipText, dutyAudience === key && st.dutyChipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[st.dutyBtn, dutySending && { opacity: 0.6 }]} onPress={sendBroadcast} disabled={dutySending} accessibilityRole="button">
            {dutySending ? <ActivityIndicator color="#fff" /> : <Text style={st.dutyBtnText}>Duyuruyu gönder</Text>}
          </Pressable>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Uygulama</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="information-circle-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Versiyon</Text>
              <Text style={st.rowSub}>1.0.0</Text>
            </View>
          </View>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/privacy' as any)}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Gizlilik Politikası</Text>
              <Text style={st.rowSub}>KVKK ve veri koruma</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#6B766F" />
          </Pressable>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/terms' as any)}>
            <Ionicons name="document-text-outline" size={22} color="#56605A" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Kullanım Koşulları</Text>
              <Text style={st.rowSub}>Hizmet şartları</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#6B766F" />
          </Pressable>
        </View>
      </View>

      <View style={st.logoutSection}>
        <Pressable style={st.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#C62828" />
          <Text style={st.logoutText}>Çıkış Yap</Text>
        </Pressable>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E3E6DE' },
  headerTitle: { fontSize: 22, fontFamily: fonts.display, color: '#151A16' },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 13, fontFamily: fonts.bold, color: '#6B766F', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E3E6DE', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#EFF2EA' },
  rowInfo: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  ratePrefix: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.primary },
  rateInput: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    borderRadius: 8,
    fontSize: 16,
    fontFamily: fonts.extrabold,
    color: colors.primary,
    textAlign: 'right',
  },
  saveRow: { justifyContent: 'center' },
  saveText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  sectionHint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 6, lineHeight: 17 },
  logoutSection: { paddingHorizontal: 16, marginTop: 32 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFEBEE', paddingVertical: 14, borderRadius: 14 },
  logoutText: { fontSize: 15, fontFamily: fonts.bold, color: '#C62828' },
  dutyCard: { padding: 14, gap: 10 },
  dutyInput: { minHeight: 44, borderWidth: 1, borderColor: '#E3E6DE', borderRadius: 12, paddingHorizontal: 12, fontSize: 14, fontFamily: fonts.regular, color: '#151A16' },
  dutyBody: { minHeight: 84, paddingTop: 10 },
  dutyRow: { flexDirection: 'row', gap: 8 },
  dutyChip: { flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#E3E6DE', alignItems: 'center', justifyContent: 'center' },
  dutyChipOn: { backgroundColor: '#17402F', borderColor: '#17402F' },
  dutyChipText: { fontSize: 13, fontFamily: fonts.semibold, color: '#151A16' },
  dutyChipTextOn: { color: '#fff' },
  dutyBtn: { height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dutyBtnText: { fontSize: 14, fontFamily: fonts.bold, color: '#fff' },
});
