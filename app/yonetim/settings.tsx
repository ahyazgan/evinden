import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { DELIVERY_CONFIG, HOME_SELLERS_ENABLED, SELLER_TYPE_LABELS } from '@/constants/business';
import { adminBroadcast, fetchCommissionRates, fetchOnlinePaymentEnabled, fetchOrderPricing, fetchPhoneVerificationRequired, setPhoneVerificationRequired, setOnlinePaymentEnabled, updateCommissionRates, type SellerType } from '@/lib/db';
import { DEFAULT_ORDER_PRICING } from '@/lib/pricing';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const RATE_ROWS: SellerType[] = HOME_SELLERS_ENABLED ? ['home', 'restaurant'] : ['restaurant'];

function parseRate(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export default function AdminSettingsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { signOut, profile } = useAuth();
  const router = useRouter();
  const [rates, setRates] = useState<Record<SellerType, string> | null>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [platformPricing, setPlatformPricing] = useState(DEFAULT_ORDER_PRICING);
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [phoneRequired, setPhoneRequired] = useState(false);

  useEffect(() => {
    fetchOrderPricing().then(setPlatformPricing).catch(() => {});
    fetchOnlinePaymentEnabled().then(setOnlineEnabled).catch(() => {});
    fetchPhoneVerificationRequired().then(setPhoneRequired).catch(() => {});
  }, []);

  const [dutyTitle, setDutyTitle] = useState('');
  const [dutyBody, setDutyBody] = useState('');
  const [dutyAudience, setDutyAudience] = useState<'all' | 'buyer' | 'seller'>('all');
  const [dutyKind, setDutyKind] = useState<'commercial' | 'service'>('commercial');
  const [dutySending, setDutySending] = useState(false);

  const sendBroadcast = () => {
    const title = dutyTitle.trim();
    const body = dutyBody.trim();
    if (!title || !body) {
      Alert.alert('Eksik bilgi', 'Başlık ve metin yaz.');
      return;
    }
    const who = dutyAudience === 'all' ? 'tüm kullanıcılara' : dutyAudience === 'buyer' ? 'müşterilere' : 'satıcılara';
    const commercial = dutyKind === 'commercial';
    const message = commercial
      ? `Bu kampanya ${who} gidecek, ama yalnızca kampanya izni verenlere. Geri alınamaz.`
      : `Bu hizmet duyurusu ${who} gidecek, izin aranmaz. Geri alınamaz.`;
    Alert.alert('Duyuru gönderilsin mi?', message, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Gönder',
        onPress: async () => {
          setDutySending(true);
          try {
            const count = await adminBroadcast(title, body, dutyAudience, commercial);
            setDutyTitle('');
            setDutyBody('');
            Alert.alert('Gönderildi', commercial ? `Kampanya izni olan ${count} kişiye gitti.` : `${count} kişiye gitti.`);
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
    <View style={st.safe}>
      <TopBar title="Ayarlar" />

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Hesap</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="person-circle-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>{profile?.name ?? 'Admin'}</Text>
              <Text style={st.rowSub}>Admin hesabı</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Komisyon oranları</Text>
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
                placeholderTextColor={t.textMuted}
                accessibilityLabel={`${SELLER_TYPE_LABELS[type]} komisyon oranı`}
              />
            </View>
          ))}
          <View style={[st.rowBorder, st.cardAction]}>
            <Button
              label="Oranları kaydet"
              onPress={saveRates}
              loading={savingRates}
              disabled={!rates}
              fullWidth
            />
          </View>
        </View>
        <Text style={st.sectionHint}>Değişiklik yalnızca yeni siparişlere uygulanır, eski siparişlerin oranı değişmez.</Text>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Ödeme</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="card-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Online ödeme (iyzico)</Text>
              <Text style={st.rowSub}>{onlineEnabled ? 'Açık' : 'Kapalı: yalnızca kapıda ödeme'}</Text>
            </View>
            <Switch
              value={onlineEnabled}
              onValueChange={toggleOnlinePayment}
              trackColor={{ false: t.divider, true: t.accent }}
              thumbColor={onlineEnabled ? t.primary : t.surface}
              ios_backgroundColor={t.divider}
              accessibilityLabel="Online ödeme"
              {...({ activeThumbColor: t.primary } as object)}
            />
          </View>
          <View style={{ height: 1, backgroundColor: t.divider }} />
          <View style={st.row}>
            <Ionicons name="phone-portrait-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Telefon doğrulama</Text>
              <Text style={st.rowSub}>{phoneRequired ? 'Açık: siparişten önce SMS kodu istenir' : "Kapalı. SMS sağlayıcısı Supabase'de kurulmadan açma"}</Text>
            </View>
            <Switch
              value={phoneRequired}
              onValueChange={(next) => {
                setPhoneRequired(next);
                setPhoneVerificationRequired(next).catch((e) => {
                  setPhoneRequired(!next);
                  Alert.alert('Kaydedilemedi', e?.message ?? 'Tekrar dene.');
                });
              }}
              trackColor={{ false: t.divider, true: t.accent }}
              thumbColor={phoneRequired ? t.primary : t.surface}
              ios_backgroundColor={t.divider}
              accessibilityLabel="Telefon doğrulama"
              {...({ activeThumbColor: t.primary } as object)}
            />
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Teslimat</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="bicycle-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Teslimat modeli</Text>
              <Text style={st.rowSub}>{DELIVERY_CONFIG.model === 'seller_courier' ? 'Esnaf kurye' : 'Platform kurye'}</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="navigate-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Teslimat alanı</Text>
              <Text style={st.rowSub}>Her satıcı kendi belirler</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="cash-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Varsayılan ücret</Text>
              <Text style={st.rowSub}>₺{(platformPricing.deliveryFeeCents / 100).toFixed(0)}, ₺{(platformPricing.freeDeliveryThresholdCents / 100).toFixed(0)} üzeri ücretsiz</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Toplu duyuru</Text>
        <View style={[st.card, st.dutyCard]}>
          <Input value={dutyTitle} onChangeText={setDutyTitle} placeholder="Başlık" accessibilityLabel="Duyuru başlığı" maxLength={80} />
          <Input value={dutyBody} onChangeText={setDutyBody} placeholder="Metin" accessibilityLabel="Duyuru metni" maxLength={300} multiline textAlignVertical="top" style={st.dutyBody} />
          <View style={st.dutyRow}>
            {([['all', 'Herkes'], ['buyer', 'Müşteriler'], ['seller', 'Satıcılar']] as const).map(([key, label]) => (
              <Pressable key={key} style={[st.dutyChip, dutyAudience === key && st.dutyChipOn]} onPress={() => setDutyAudience(key)} hitSlop={{ top: 2, bottom: 2 }} accessibilityRole="radio" accessibilityState={{ selected: dutyAudience === key }}>
                <Text style={[st.dutyChipText, dutyAudience === key && st.dutyChipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={st.dutyRow}>
            {([['commercial', 'Kampanya'], ['service', 'Hizmet duyurusu']] as const).map(([key, label]) => (
              <Pressable key={key} style={[st.dutyChip, dutyKind === key && st.dutyChipOn]} onPress={() => setDutyKind(key)} hitSlop={{ top: 2, bottom: 2 }} accessibilityRole="radio" accessibilityState={{ selected: dutyKind === key }}>
                <Text style={[st.dutyChipText, dutyKind === key && st.dutyChipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={st.dutyHelp}>
            {dutyKind === 'commercial'
              ? 'İndirim ve tanıtım için. Yalnızca kampanya bildirimi almak isteyen kullanıcılara gider.'
              : 'Kesinti veya kural değişikliği gibi zorunlu bilgiler için. Herkese gider, içine tanıtım yazma.'}
          </Text>
          <Button label="Duyuruyu gönder" onPress={sendBroadcast} loading={dutySending} fullWidth />
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle} accessibilityRole="header">Uygulama</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="information-circle-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Versiyon</Text>
              <Text style={st.rowSub}>1.0.0</Text>
            </View>
          </View>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/privacy' as any)} accessibilityRole="button">
            <Ionicons name="shield-checkmark-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Gizlilik politikası</Text>
              <Text style={st.rowSub}>KVKK ve veri koruma</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
          </Pressable>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/terms' as any)} accessibilityRole="button">
            <Ionicons name="document-text-outline" size={22} color={t.text} />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Kullanım koşulları</Text>
              <Text style={st.rowSub}>Hizmet şartları</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={st.section}>
        <Pressable style={st.logoutBtn} onPress={handleLogout} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={20} color={t.text} />
          <Text style={st.logoutText}>Çıkış yap</Text>
        </Pressable>
      </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.3, color: t.heading, marginBottom: 8 },
  card: { backgroundColor: t.surface, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: t.divider },
  rowInfo: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 14, fontFamily: fonts.semibold, color: t.text },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  ratePrefix: { fontSize: 16, fontFamily: fonts.extrabold, color: t.text },
  rateInput: {
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: t.background,
    fontSize: 16,
    fontFamily: fonts.extrabold,
    color: t.text,
    textAlign: 'right',
  },
  cardAction: { padding: 14 },
  sectionHint: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary, marginTop: 6, lineHeight: 17 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.surface, minHeight: 46, borderRadius: 12 },
  logoutText: { fontSize: 15, fontFamily: fonts.bold, color: t.text },
  dutyCard: { padding: 14, gap: 10 },
  dutyBody: { minHeight: 84, paddingTop: 10 },
  dutyRow: { flexDirection: 'row', gap: 8 },
  dutyChip: { flex: 1, height: 40, borderRadius: 10, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' },
  dutyChipOn: { backgroundColor: t.primary },
  dutyChipText: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  dutyChipTextOn: { color: t.onBrand },
  dutyHelp: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.textSecondary },
});
