import { useEffect, useState } from 'react';
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
import { SELLER_AGREEMENTS, SELLER_DOCUMENTS, SELLER_TYPE_LABELS, DEFAULT_COMMISSION_RATES, COMMISSION_DESCRIPTION, DELIVERY_CONFIG } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';
import { fetchCommissionRates, type CommissionRates, type SellerDocumentType, type SellerType } from '@/lib/db';
import { pickAndUploadSellerDocument } from '@/lib/storage';
import { geocodeAddress, getCurrentCoords } from '@/lib/delivery-location';
import { fonts } from '@/lib/fonts';

export default function SellerApplyScreen() {
  const router = useRouter();
  const { profile, applyAsSeller } = useAuth();

  const [sellerType, setSellerType] = useState<SellerType>('home');
  const [commissionRates, setCommissionRates] = useState<CommissionRates>(DEFAULT_COMMISSION_RATES);
  const [documents, setDocuments] = useState<Partial<Record<SellerDocumentType, string>>>({});
  const [uploadingDoc, setUploadingDoc] = useState<SellerDocumentType | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [city, setCity] = useState('İstanbul');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [showFullText, setShowFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'info' | 'agreements'>('info');

  useEffect(() => {
    fetchCommissionRates().then(setCommissionRates).catch(() => {});
  }, []);

  const fillMyLocation = async () => {
    setLocating(true);
    const found = (await getCurrentCoords())
      ?? (address.trim() ? await geocodeAddress([address, district, city].filter(Boolean).join(', ')) : null);
    setLocating(false);
    if (found) setCoords(found);
    else Alert.alert('Konum alınamadı', 'Konum izni verin veya adresinizi yazıp tekrar deneyin.');
  };

  const uploadDocument = async (docType: SellerDocumentType) => {
    if (!profile || uploadingDoc) return;
    setUploadingDoc(docType);
    try {
      const path = await pickAndUploadSellerDocument(profile.id, docType);
      if (path) setDocuments(prev => ({ ...prev, [docType]: path }));
    } catch (err: any) {
      Alert.alert('Belge yüklenemedi', err?.message ?? 'Lütfen tekrar deneyin.');
    } finally {
      setUploadingDoc(null);
    }
  };

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
    if (!coords) {
      Alert.alert('Hata', 'Teslimat alanınızın hesaplanabilmesi için mağaza konumunu ekleyin.');
      return;
    }
    if (sellerType === 'restaurant' && SELLER_DOCUMENTS.some(d => !documents[d.id])) {
      Alert.alert('Hata', 'Restoran başvurusu için tüm belgeleri yüklemelisiniz.');
      return;
    }
    setStep('agreements');
  };

  const submitApplication = async () => {
    if (!allAgreementsAccepted) {
      Alert.alert('Hata', 'Tüm sözleşmeleri kabul etmelisiniz.');
      return;
    }
    if (!coords) return;
    setLoading(true);
    try {
      await applyAsSeller({
        storeName: storeName.trim(),
        city: city.trim(),
        district: district.trim(),
        address: address.trim(),
        phone: phone.trim(),
        sellerType,
        latitude: coords.latitude,
        longitude: coords.longitude,
        documents: sellerType === 'restaurant'
          ? SELLER_DOCUMENTS.map(d => ({ docType: d.id, path: documents[d.id]! }))
          : [],
      });
      router.replace('/(customer)/profile' as any);
    } catch (err: any) {
      Alert.alert('Başvuru gönderilemedi', err?.message ?? 'Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => step === 'agreements' ? setStep('info') : router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#151A16" />
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
              {/* Seller type */}
              <View style={s.typeRow}>
                {(['home', 'restaurant'] as const).map(type => (
                  <Pressable
                    key={type}
                    style={[s.typeOption, sellerType === type && s.typeOptionActive]}
                    onPress={() => setSellerType(type)}
                  >
                    <Text style={s.typeEmoji}>{type === 'home' ? '🧑‍🍳' : '🏪'}</Text>
                    <Text style={[s.typeLabel, sellerType === type && s.typeLabelActive]}>{SELLER_TYPE_LABELS[type]}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Intro */}
              <View style={s.introCard}>
                <Text style={s.introEmoji}>{sellerType === 'home' ? '🧑‍🍳' : '🏪'}</Text>
                <Text style={s.introTitle}>{sellerType === 'home' ? 'Ev Mutfağından Satış Yap!' : 'Restoranınla Evinden\'e Katıl!'}</Text>
                <Text style={s.introSub}>
                  {sellerType === 'home'
                    ? 'Yemeklerini evinden\'de sat, binlerce müşteriye ulaş.'
                    : 'Menünü evinden\'e ekle, mahallendeki müşterilere ulaş.'}
                  {' '}Başvurun onaylandıktan sonra hemen satışa başlayabilirsiniz.
                </Text>
              </View>

              {/* Commission & Delivery info */}
              <View style={s.infoCard}>
                <View style={s.infoRow}>
                  <Ionicons name="cash-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoTitle}>Komisyon Oranı: %{commissionRates[sellerType]}</Text>
                    <Text style={s.infoDetail}>{COMMISSION_DESCRIPTION}</Text>
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
                    placeholder={sellerType === 'home' ? "Örn: Ayşe'nin Ev Yemekleri" : 'Örn: Kadıköy Lokantası'}
                    placeholderTextColor="#A3ACA5"
                  />
                </View>
                <View style={[s.fieldWrap, s.fieldBorder]}>
                  <Text style={s.label}>Telefon</Text>
                  <TextInput
                    style={s.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+90 5xx xxx xx xx"
                    placeholderTextColor="#A3ACA5"
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
                      placeholderTextColor="#A3ACA5"
                    />
                  </View>
                  <View style={[s.fieldWrap, { flex: 1, borderLeftWidth: 1, borderLeftColor: '#EFF2EA' }]}>
                    <Text style={s.label}>İlçe *</Text>
                    <TextInput
                      style={s.input}
                      value={district}
                      onChangeText={setDistrict}
                      placeholder="Kadıköy"
                      placeholderTextColor="#A3ACA5"
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
                    placeholderTextColor="#A3ACA5"
                  />
                </View>
                <Pressable style={[s.fieldWrap, s.fieldBorder, s.docRow]} onPress={fillMyLocation} disabled={locating}>
                  <Ionicons
                    name={coords ? 'checkmark-circle' : 'location-outline'}
                    size={22}
                    color={coords ? '#2E7D32' : colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoTitle}>Mağaza Konumu *</Text>
                    <Text style={s.infoDetail}>Teslimat alanınız bu noktaya göre hesaplanır.</Text>
                  </View>
                  {locating
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={s.docAction}>{coords ? 'Güncelle' : 'Konumumu Kullan'}</Text>}
                </Pressable>
              </View>

              {sellerType === 'restaurant' && (
                <>
                  <Text style={s.sectionTitle}>BELGELER</Text>
                  <View style={s.formCard}>
                    {SELLER_DOCUMENTS.map((doc, i) => (
                      <Pressable
                        key={doc.id}
                        style={[s.fieldWrap, s.docRow, i > 0 && s.fieldBorder]}
                        onPress={() => uploadDocument(doc.id)}
                      >
                        <Ionicons
                          name={documents[doc.id] ? 'checkmark-circle' : 'cloud-upload-outline'}
                          size={22}
                          color={documents[doc.id] ? '#2E7D32' : colors.primary}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={s.infoTitle}>{doc.title} *</Text>
                          <Text style={s.infoDetail}>{doc.description}</Text>
                        </View>
                        {uploadingDoc === doc.id
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Text style={s.docAction}>{documents[doc.id] ? 'Değiştir' : 'Yükle'}</Text>}
                      </Pressable>
                    ))}
                  </View>
                  <Text style={s.docHint}>Belgeleriniz gizli saklanır, yalnızca başvuru incelemesi için görüntülenir.</Text>
                </>
              )}

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
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: '#151A16' },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  progressDot: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E3E6DE' },
  progressDotActive: { backgroundColor: colors.primary },

  scroll: { padding: 16, paddingBottom: 40 },

  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  typeOption: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E3E6DE',
    backgroundColor: '#fff',
  },
  typeOptionActive: { borderColor: colors.primary, backgroundColor: '#FFF3E0' },
  typeEmoji: { fontFamily: fonts.regular, fontSize: 24 },
  typeLabel: { fontSize: 14, fontFamily: fonts.bold, color: '#56605A' },
  typeLabelActive: { color: colors.primary },

  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  docAction: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  docHint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17, marginTop: -8, marginBottom: 16 },

  introCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E3E6DE',
    marginBottom: 16,
  },
  introEmoji: { fontFamily: fonts.regular, fontSize: 48, marginBottom: 12 },
  introTitle: { fontSize: 20, fontFamily: fonts.display, color: '#151A16', marginBottom: 8 },
  introSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', textAlign: 'center', lineHeight: 20 },

  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    padding: 16,
    marginBottom: 20,
  },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoSep: { height: 1, backgroundColor: '#EFF2EA', marginVertical: 12 },
  infoTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16', marginBottom: 4 },
  infoDetail: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 18 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: '#6B766F',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },

  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    marginBottom: 20,
    overflow: 'hidden',
  },
  fieldWrap: { paddingHorizontal: 14, paddingVertical: 12 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: '#EFF2EA' },
  row2: { flexDirection: 'row' },
  label: { fontSize: 11, fontFamily: fonts.bold, color: '#6B766F', marginBottom: 5, letterSpacing: 0.5 },
  input: { fontFamily: fonts.regular, fontSize: 15, color: '#151A16', padding: 0 },

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
  primaryBtnText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },

  agreementsSub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', marginBottom: 16, lineHeight: 19 },
  agreementItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
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
  checkboxLabel: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16', lineHeight: 20 },
  agreementDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17, marginTop: 4 },
  readMore: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary, marginLeft: 36 },
  fullTextBox: { backgroundColor: '#FAF8F2', borderRadius: 10, padding: 12 },
  fullText: { fontFamily: fonts.regular, fontSize: 11, color: '#56605A', lineHeight: 16 },
  hintText: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', textAlign: 'center', marginTop: 12 },
});
