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
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SELLER_AGREEMENTS, SELLER_DOCUMENTS, SELLER_TYPE_LABELS, DEFAULT_COMMISSION_RATES, COMMISSION_DESCRIPTION, DELIVERY_CONFIG } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';
import { fetchCommissionRates, type CommissionRates, type SellerDocumentType, type SellerType } from '@/lib/db';
import { pickAndUploadSellerDocument } from '@/lib/storage';
import { geocodeAddress, getCurrentCoords } from '@/lib/delivery-location';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TopBar } from '@/components/shared/TopBar';

const TYPE_ICONS: Record<SellerType, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  restaurant: 'storefront-outline',
};

export default function SellerApplyScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
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
    else Alert.alert('Konum alınamadı', 'Konum izni ver veya adresini yazıp tekrar dene.');
  };

  const uploadDocument = async (docType: SellerDocumentType) => {
    if (!profile || uploadingDoc) return;
    setUploadingDoc(docType);
    try {
      const path = await pickAndUploadSellerDocument(profile.id, docType);
      if (path) setDocuments(prev => ({ ...prev, [docType]: path }));
    } catch (err: any) {
      Alert.alert('Belge yüklenemedi', err?.message ?? 'Lütfen tekrar dene.');
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
      Alert.alert('Hata', 'Teslimat alanının hesaplanabilmesi için mağaza konumunu ekle.');
      return;
    }
    if (sellerType === 'restaurant' && SELLER_DOCUMENTS.some(d => !documents[d.id])) {
      Alert.alert('Hata', 'Restoran başvurusu için tüm belgeleri yüklemelisin.');
      return;
    }
    setStep('agreements');
  };

  const submitApplication = async () => {
    if (!allAgreementsAccepted) {
      Alert.alert('Hata', 'Tüm sözleşmeleri kabul etmelisin.');
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
      Alert.alert('Başvuru gönderilemedi', err?.message ?? 'Lütfen tekrar dene.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TopBar
          title="Satıcı başvurusu"
          onBack={() => step === 'agreements' ? setStep('info') : router.back()}
        />

        <View style={s.progressRow}>
          <View style={[s.progressDot, { backgroundColor: t.brand }]} />
          <View style={[s.progressDot, { backgroundColor: step === 'agreements' ? t.brand : t.divider }]} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'info' ? (
            <>
              <View style={s.typeRow}>
                {(['home', 'restaurant'] as const).map(type => {
                  const on = sellerType === type;
                  return (
                    <Pressable
                      key={type}
                      style={[s.typeOption, { backgroundColor: t.surface, borderColor: on ? t.brand : t.surface }]}
                      onPress={() => setSellerType(type)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <View style={[s.iconCircle, { backgroundColor: on ? t.accent : t.chip }]}>
                        <Ionicons name={TYPE_ICONS[type]} size={20} color={on ? t.onAccent : t.text} />
                      </View>
                      <Text style={[s.typeLabel, { color: t.text }]}>{SELLER_TYPE_LABELS[type]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={[s.card, s.intro, { backgroundColor: t.surface }]}>
                <Text style={[s.introTitle, { color: t.heading }]}>{sellerType === 'home' ? 'Ev mutfağından satış yap!' : 'Restoranınla Evinden\'e katıl!'}</Text>
                <Text style={[s.introSub, { color: t.textSecondary }]}>
                  {sellerType === 'home'
                    ? 'Yemeklerini evinden\'de sat, binlerce müşteriye ulaş.'
                    : 'Menünü evinden\'e ekle, mahallendeki müşterilere ulaş.'}
                  {' '}Başvurun onaylandıktan sonra hemen satışa başlayabilirsin.
                </Text>
              </View>

              <View style={[s.card, { backgroundColor: t.surface }]}>
                <View style={s.infoRow}>
                  <Ionicons name="cash-outline" size={20} color={t.text} />
                  <View style={s.flexText}>
                    <Text style={[s.infoTitle, { color: t.text }]}>Komisyon oranı: %{commissionRates[sellerType]}</Text>
                    <Text style={[s.infoDetail, { color: t.textSecondary }]}>{COMMISSION_DESCRIPTION}</Text>
                  </View>
                </View>
                <View style={[s.sep, { backgroundColor: t.divider }]} />
                <View style={s.infoRow}>
                  <Ionicons name="bicycle-outline" size={20} color={t.text} />
                  <View style={s.flexText}>
                    <Text style={[s.infoTitle, { color: t.text }]}>{DELIVERY_CONFIG.label}</Text>
                    <Text style={[s.infoDetail, { color: t.textSecondary }]}>{DELIVERY_CONFIG.description}</Text>
                  </View>
                </View>
              </View>

              <Text style={[s.sectionTitle, { color: t.heading }]}>Mağaza bilgileri</Text>
              <View style={[s.card, s.form, { backgroundColor: t.surface }]}>
                <Input
                  label="Mağaza adı *"
                  accessibilityLabel="Mağaza adı"
                  value={storeName}
                  onChangeText={setStoreName}
                  placeholder={sellerType === 'home' ? "Örn: Ayşe'nin Ev Yemekleri" : 'Örn: Kadıköy Lokantası'}
                />
                <Input
                  label="Telefon"
                  accessibilityLabel="Telefon"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+90 5xx xxx xx xx"
                  keyboardType="phone-pad"
                />
              </View>

              <Text style={[s.sectionTitle, { color: t.heading }]}>Konum</Text>
              <View style={[s.card, s.form, { backgroundColor: t.surface }]}>
                <View style={s.row2}>
                  <View style={s.flexText}>
                    <Input label="Şehir" accessibilityLabel="Şehir" value={city} onChangeText={setCity} placeholder="İstanbul" />
                  </View>
                  <View style={s.flexText}>
                    <Input label="İlçe *" accessibilityLabel="İlçe" value={district} onChangeText={setDistrict} placeholder="Kadıköy" />
                  </View>
                </View>
                <Input label="Adres" accessibilityLabel="Adres" value={address} onChangeText={setAddress} placeholder="Sokak, bina no..." />
                <Pressable style={s.docRow} onPress={fillMyLocation} disabled={locating} accessibilityRole="button">
                  <Ionicons
                    name={coords ? 'checkmark-circle' : 'location-outline'}
                    size={22}
                    color={coords ? t.success : t.text}
                  />
                  <View style={s.flexText}>
                    <Text style={[s.infoTitle, { color: t.text }]}>Mağaza konumu *</Text>
                    <Text style={[s.infoDetail, { color: t.textSecondary }]}>Teslimat alanın bu noktaya göre hesaplanır.</Text>
                  </View>
                  {locating
                    ? <ActivityIndicator size="small" color={t.primary} />
                    : <Text style={[s.docAction, { color: t.text }]}>{coords ? 'Güncelle' : 'Konumumu kullan'}</Text>}
                </Pressable>
              </View>

              {sellerType === 'restaurant' && (
                <>
                  <Text style={[s.sectionTitle, { color: t.heading }]}>Belgeler</Text>
                  <View style={[s.card, { backgroundColor: t.surface }]}>
                    {SELLER_DOCUMENTS.map((doc, i) => (
                      <Pressable
                        key={doc.id}
                        style={[s.docRow, i > 0 && { borderTopWidth: 1, borderTopColor: t.divider }]}
                        onPress={() => uploadDocument(doc.id)}
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name={documents[doc.id] ? 'checkmark-circle' : 'cloud-upload-outline'}
                          size={22}
                          color={documents[doc.id] ? t.success : t.text}
                        />
                        <View style={s.flexText}>
                          <Text style={[s.infoTitle, { color: t.text }]}>{doc.title} *</Text>
                          <Text style={[s.infoDetail, { color: t.textSecondary }]}>{doc.description}</Text>
                        </View>
                        {uploadingDoc === doc.id
                          ? <ActivityIndicator size="small" color={t.primary} />
                          : <Text style={[s.docAction, { color: t.text }]}>{documents[doc.id] ? 'Değiştir' : 'Yükle'}</Text>}
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[s.hint, { color: t.textSecondary, textAlign: 'left' }]}>Belgelerin gizli saklanır, yalnızca başvuru incelemesi için görüntülenir.</Text>
                </>
              )}

              <View style={s.action}>
                <Button label="Devam et" size="lg" fullWidth onPress={goToAgreements} />
              </View>
            </>
          ) : (
            <>
              <Text style={[s.sectionTitle, { color: t.heading }]}>Sözleşmeler ve gereklilikler</Text>
              <Text style={[s.agreementsSub, { color: t.textSecondary }]}>
                Satıcı olarak devam etmek için aşağıdaki gereklilikleri kabul etmelisin.
              </Text>

              {SELLER_AGREEMENTS.map(agreement => {
                const checked = !!agreements[agreement.id];
                const open = showFullText === agreement.id;
                return (
                  <View key={agreement.id} style={[s.card, { backgroundColor: t.surface }]}>
                    <Pressable
                      style={s.checkboxRow}
                      onPress={() => toggleAgreement(agreement.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                    >
                      <View style={[s.checkbox, checked ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.textMuted }]}>
                        {checked && <Ionicons name="checkmark" size={14} color={t.onAccent} />}
                      </View>
                      <View style={s.flexText}>
                        <Text style={[s.checkboxLabel, { color: t.text }]}>{agreement.checkboxLabel}</Text>
                        <Text style={[s.infoDetail, { color: t.textSecondary, marginTop: 4 }]}>{agreement.description}</Text>
                      </View>
                    </Pressable>
                    {'fullText' in agreement && (
                      <>
                        <Pressable
                          style={s.readMore}
                          onPress={() => setShowFullText(open ? null : agreement.id)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: open }}
                        >
                          <Text style={[s.docAction, { color: t.text }]}>{open ? 'Kapat' : 'Sözleşmeyi oku'}</Text>
                          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.text} />
                        </Pressable>
                        {open && (
                          <View style={[s.fullTextBox, { backgroundColor: t.background }]}>
                            <Text style={[s.fullText, { color: t.textSecondary }]}>{agreement.fullText}</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                );
              })}

              <View style={s.action}>
                <Button
                  label="Başvuruyu gönder"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={!allAgreementsAccepted}
                  onPress={submitApplication}
                />
              </View>

              {!allAgreementsAccepted && (
                <Text style={[s.hint, { color: t.textSecondary }]}>Tüm sözleşmeleri kabul etmelisin</Text>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  flexText: { flex: 1, minWidth: 0 },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 14, paddingBottom: 2 },
  progressDot: { width: 40, height: 4, borderRadius: 2 },

  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 },

  typeRow: { flexDirection: 'row', gap: 10 },
  typeOption: { flex: 1, alignItems: 'center', gap: 8, padding: 12, borderRadius: 16, borderWidth: 2 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { fontSize: 14, fontFamily: fonts.bold, textAlign: 'center' },

  card: { borderRadius: 16, padding: 14 },
  intro: { gap: 6 },
  introTitle: { fontSize: 20, lineHeight: 26, fontFamily: fonts.display, letterSpacing: -0.4 },
  introSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },

  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  sep: { height: 1, marginVertical: 12 },
  infoTitle: { fontSize: 14, fontFamily: fonts.bold, marginBottom: 2 },
  infoDetail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },

  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 4 },
  form: { gap: 12 },
  row2: { flexDirection: 'row', gap: 10 },

  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  docAction: { fontSize: 13, fontFamily: fonts.bold },

  action: { marginTop: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },

  agreementsSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: -6 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxLabel: { fontSize: 14, fontFamily: fonts.bold, lineHeight: 20 },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginLeft: 36 },
  fullTextBox: { borderRadius: 12, padding: 12 },
  fullText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
