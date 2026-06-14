import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { SELLER_AGREEMENTS, COMMISSION_TIERS, DELIVERY_CONFIG } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';

export default function SellerApplyScreen() {
  const router = useRouter();
  const { profile, applyAsSeller } = useAuth();

  const [storeName, setStoreName] = useState('');
  const [city, setCity] = useState('İstanbul');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [showFullText, setShowFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'info' | 'agreements'>('info');

  const toggleAgreement = (id: string) => {
    setAgreements(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const allAgreementsAccepted = SELLER_AGREEMENTS.every(a => agreements[a.id]);

  const goToAgreements = () => {
    if (!storeName.trim()) {
      Alert.alert('Hata', 'Mağaza adı zorunludur.');
      return;
    }
    if (!district.trim()) {
      Alert.alert('Hata', 'İlçe bilgisi zorunludur.');
      return;
    }
    setStep('agreements');
  };

  const submitApplication = async () => {
    if (!allAgreementsAccepted) {
      Alert.alert('Hata', 'Tüm sözleşmeleri kabul etmelisiniz.');
      return;
    }
    setLoading(true);
    await applyAsSeller({
      storeName: storeName.trim(),
      city: city.trim(),
      district: district.trim(),
      address: address.trim(),
      phone: phone.trim(),
    });
    setLoading(false);
    router.replace('/(customer)/profile' as any);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => step === 'agreements' ? setStep('info') : router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#1A1208" />
          </Pressable>
          <Text style={s.headerTitle}>Satıcı Başvurusu</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Progress */}
        <View style={s.progressRow}>
          <View style={[s.progressDot, s.progressDotActive]} />
          <View style={[s.progressDot, step === 'agreements' && s.progressDotActive]} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'info' ? (
            <>
              {/* Intro */}
              <View style={s.introCard}>
                <Text style={s.introEmoji}>🧑‍🍳</Text>
                <Text style={s.introTitle}>Ev Mutfağından Satış Yap!</Text>
                <Text style={s.introSub}>
                  Yemeklerini evinden'de sat, binlerce müşteriye ulaş.
                  Başvurun onaylandıktan sonra hemen satışa başlayabilirsiniz.
                </Text>
              </View>

              {/* Commission & Delivery info */}
              <View style={s.infoCard}>
                <View style={s.infoRow}>
                  <Ionicons name="cash-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoTitle}>Komisyon Oranları</Text>
                    {COMMISSION_TIERS.map(t => (
                      <Text key={t.id} style={s.infoDetail}>
                        {t.label}: %{t.rate} — {t.description}
                      </Text>
                    ))}
                  </View>
                </View>
                <View style={s.infoSep} />
                <View style={s.infoRow}>
                  <Ionicons name="bicycle-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoTitle}>{DELIVERY_CONFIG.label}</Text>
                    <Text style={s.infoDetail}>{DELIVERY_CONFIG.description}</Text>
                  </View>
                </View>
              </View>

              {/* Form */}
              <Text style={s.sectionTitle}>MAĞAZA BİLGİLERİ</Text>
              <View style={s.formCard}>
                <View style={s.fieldWrap}>
                  <Text style={s.label}>Mağaza Adı *</Text>
                  <TextInput
                    style={s.input}
                    value={storeName}
                    onChangeText={setStoreName}
                    placeholder="Örn: Ayşe'nin Ev Yemekleri"
                    placeholderTextColor="#C4B8AA"
                  />
                </View>
                <View style={[s.fieldWrap, s.fieldBorder]}>
                  <Text style={s.label}>Telefon</Text>
                  <TextInput
                    style={s.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+90 5xx xxx xx xx"
                    placeholderTextColor="#C4B8AA"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <Text style={s.sectionTitle}>KONUM</Text>
              <View style={s.formCard}>
                <View style={s.row2}>
                  <View style={[s.fieldWrap, { flex: 1 }]}>
                    <Text style={s.label}>Şehir</Text>
                    <TextInput
                      style={s.input}
                      value={city}
                      onChangeText={setCity}
                      placeholder="İstanbul"
                      placeholderTextColor="#C4B8AA"
                    />
                  </View>
                  <View style={[s.fieldWrap, { flex: 1, borderLeftWidth: 1, borderLeftColor: '#F5F0EA' }]}>
                    <Text style={s.label}>İlçe *</Text>
                    <TextInput
                      style={s.input}
                      value={district}
                      onChangeText={setDistrict}
                      placeholder="Kadıköy"
                      placeholderTextColor="#C4B8AA"
                    />
                  </View>
                </View>
                <View style={[s.fieldWrap, s.fieldBorder]}>
                  <Text style={s.label}>Adres</Text>
                  <TextInput
                    style={s.input}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Sokak, bina no..."
                    placeholderTextColor="#C4B8AA"
                  />
                </View>
              </View>

              <Pressable style={s.primaryBtn} onPress={goToAgreements}>
                <Text style={s.primaryBtnText}>Devam Et</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </Pressable>
            </>
          ) : (
            <>
              {/* Agreements step */}
              <Text style={s.sectionTitle}>SÖZLEŞMELER VE GEREKLILIKLER</Text>
              <Text style={s.agreementsSub}>
                Satıcı olarak devam etmek için aşağıdaki gereklilikleri kabul etmelisiniz.
              </Text>

              {SELLER_AGREEMENTS.map(agreement => (
                <View key={agreement.id} style={s.agreementItem}>
                  <Pressable
                    style={s.checkboxRow}
                    onPress={() => toggleAgreement(agreement.id)}
                  >
                    <View style={[s.checkbox, agreements[agreement.id] && s.checkboxChecked]}>
                      {agreements[agreement.id] && (
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.checkboxLabel}>{agreement.checkboxLabel}</Text>
                      <Text style={s.agreementDesc}>{agreement.description}</Text>
                    </View>
                  </Pressable>
                  {'fullText' in agreement && (
                    <>
                      <Pressable onPress={() => setShowFullText(showFullText === agreement.id ? null : agreement.id)}>
                        <Text style={s.readMore}>
                          {showFullText === agreement.id ? 'Kapat ▲' : 'Sözleşmeyi Oku ▼'}
                        </Text>
                      </Pressable>
                      {showFullText === agreement.id && (
                        <View style={s.fullTextBox}>
                          <Text style={s.fullText}>{agreement.fullText}</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ))}

              <Pressable
                style={[s.primaryBtn, !allAgreementsAccepted && s.btnDisabled]}
                onPress={submitApplication}
                disabled={loading || !allAgreementsAccepted}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.primaryBtnText}>Başvuru Gönder</Text>
                )}
              </Pressable>

              {!allAgreementsAccepted && (
                <Text style={s.hintText}>Tüm sözleşmeleri kabul etmelisiniz</Text>
              )}
            </>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#1A1208' },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  progressDot: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#EDE8E2' },
  progressDotActive: { backgroundColor: colors.primary },

  scroll: { padding: 16, paddingBottom: 40 },

  introCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    marginBottom: 16,
  },
  introEmoji: { fontSize: 48, marginBottom: 12 },
  introTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208', marginBottom: 8 },
  introSub: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 20 },

  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 16,
    marginBottom: 20,
  },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoSep: { height: 1, backgroundColor: '#F5F0EA', marginVertical: 12 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#1A1208', marginBottom: 4 },
  infoDetail: { fontSize: 12, color: '#A89A8A', lineHeight: 18 },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A89A8A',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },

  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    marginBottom: 20,
    overflow: 'hidden',
  },
  fieldWrap: { paddingHorizontal: 14, paddingVertical: 12 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: '#F5F0EA' },
  row2: { flexDirection: 'row' },
  label: { fontSize: 11, fontWeight: '700', color: '#A89A8A', marginBottom: 5, letterSpacing: 0.5 },
  input: { fontSize: 15, color: '#1A1208', padding: 0 },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  agreementsSub: { fontSize: 13, color: '#A89A8A', marginBottom: 16, lineHeight: 19 },
  agreementItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    marginBottom: 10,
    gap: 10,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D1C9BE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxLabel: { fontSize: 14, fontWeight: '700', color: '#1A1208', lineHeight: 20 },
  agreementDesc: { fontSize: 12, color: '#A89A8A', lineHeight: 17, marginTop: 4 },
  readMore: { fontSize: 12, fontWeight: '700', color: colors.primary, marginLeft: 36 },
  fullTextBox: { backgroundColor: '#FAF7F2', borderRadius: 10, padding: 12 },
  fullText: { fontSize: 11, color: '#6B5E50', lineHeight: 16 },
  hintText: { fontSize: 12, color: '#A89A8A', textAlign: 'center', marginTop: 12 },
});
