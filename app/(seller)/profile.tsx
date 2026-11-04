import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COMMISSION_DESCRIPTION, DEFAULT_SELLER_TYPE, DELIVERY_CONFIG, HOME_SELLERS_ENABLED, SELLER_TYPE_LABELS } from '@/constants/business';
import { centsToTLInput, parseTLToCents } from '@/lib/pricing';
import { MEAL_CARDS, toggleMealCard } from '@/lib/order-options';
import { geocodeAddress, getCurrentCoords } from '@/lib/delivery-location';
import { useAuth } from '@/lib/auth-context';
import { useDeleteAccount } from '@/lib/useDeleteAccount';
import { CompanyInfoCard } from '@/components/shared/CompanyInfoCard';
import ImageUploadBox from '@/components/shared/ImageUploadBox';
import { TopBar } from '@/components/shared/TopBar';
import { Input } from '@/components/ui/Input';
import { fetchCommissionRates, fetchSellerByUserId, fetchSellerHours, upsertSellerHours, createSeller, updateSeller, type CommissionRates, type SellerRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

type WorkHour = { open: boolean; start: string; end: string };

const DEFAULT_HOURS: WorkHour[] = [
  { open: true,  start: '09:00', end: '20:00' },
  { open: true,  start: '09:00', end: '20:00' },
  { open: true,  start: '09:00', end: '20:00' },
  { open: true,  start: '09:00', end: '20:00' },
  { open: true,  start: '09:00', end: '18:00' },
  { open: true,  start: '10:00', end: '16:00' },
  { open: false, start: '10:00', end: '16:00' },
];

export default function SellerProfileScreen() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const { signOut, profile, updateProfile } = useAuth();
  const confirmDeleteAccount = useDeleteAccount();
  const [sellerRow, setSellerRow] = useState<SellerRow | null>(null);
  const [commissionRates, setCommissionRates] = useState<CommissionRates | null>(null);
  const [storeName, setStoreName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('İstanbul');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [hours, setHours] = useState<WorkHour[]>(DEFAULT_HOURS);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [freeThreshold, setFreeThreshold] = useState('');
  const [minOrder, setMinOrder] = useState('0');
  const [timeMin, setTimeMin] = useState('25');
  const [timeMax, setTimeMax] = useState('40');
  const [radius, setRadius] = useState('10');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mealCards, setMealCards] = useState<string[]>([]);
  const [acceptsScheduled, setAcceptsScheduled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCommissionRates().then(setCommissionRates).catch(() => {});
  }, []);

  // Load seller profile from Supabase
  useEffect(() => {
    if (!profile?.id) { setLoading(false); return; }
    fetchSellerByUserId(profile.id)
      .then(row => {
        if (row) {
          setSellerRow(row);
          setStoreName(row.display_name);
          setBio(row.bio ?? '');
          setCity(row.city ?? 'İstanbul');
          setDistrict(row.district ?? '');
          setAddress(row.address_line ?? '');
          setLogoUrl(row.logo_url);
          setCoverUrl(row.cover_url);
          setDeliveryFee(centsToTLInput(row.delivery_fee_cents));
          setFreeThreshold(centsToTLInput(row.free_delivery_threshold_cents));
          setMinOrder(centsToTLInput(row.min_order_cents ?? 0));
          setTimeMin(String(row.delivery_time_min ?? 25));
          setTimeMax(String(row.delivery_time_max ?? 40));
          setRadius(String(row.delivery_radius_km ?? 10));
          setMealCards(row.meal_cards ?? []);
          setAcceptsScheduled(row.accepts_scheduled ?? true);
          setPickupEnabled(row.pickup_enabled ?? false);
          if (row.latitude != null && row.longitude != null) {
            setCoords({ latitude: Number(row.latitude), longitude: Number(row.longitude) });
          }
          fetchSellerHours(row.id)
            .then(rows => {
              if (rows.length === 0) return;
              setHours(prev => prev.map((h, i) => {
                const saved = rows.find(r => r.day_of_week === i);
                if (!saved) return h;
                return {
                  open: saved.is_open,
                  start: saved.open_time?.slice(0, 5) ?? h.start,
                  end: saved.close_time?.slice(0, 5) ?? h.end,
                };
              }));
            })
            .catch(() => {});
        } else {
          // Pre-fill from auth profile
          setStoreName(profile.seller_store_name ?? '');
          setPhone(profile.phone ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profile]);

  const fillMyLocation = async () => {
    setLocating(true);
    const found = (await getCurrentCoords())
      ?? (address.trim() ? await geocodeAddress([address, district, city].filter(Boolean).join(', ')) : null);
    setLocating(false);
    if (found) setCoords(found);
    else Alert.alert('Konum alınamadı', 'Konum izni ver veya adresini yazıp tekrar dene.');
  };

  const toggleStorePause = async () => {
    if (!sellerRow) return;
    try {
      setSellerRow(await updateSeller(sellerRow.id, { is_paused: !sellerRow.is_paused }));
    } catch {
      Alert.alert('Mağaza güncellenemedi', 'Lütfen tekrar dene.');
    }
  };

  const toggleDay = (idx: number) => {
    setHours(prev => prev.map((h, i) => i === idx ? { ...h, open: !h.open } : h));
  };

  const setTime = (idx: number, field: 'start' | 'end', val: string) => {
    setHours(prev => prev.map((h, i) => i === idx ? { ...h, [field]: val } : h));
  };

  const handleSave = async () => {
    if (!storeName.trim()) {
      Alert.alert('Mağaza adı gerekli');
      return;
    }
    if (!profile?.id) return;
    const fee = parseTLToCents(deliveryFee);
    const threshold = parseTLToCents(freeThreshold);
    const minimum = parseTLToCents(minOrder);
    if (fee === undefined || threshold === undefined || minimum === undefined) {
      Alert.alert('Tutar hatalı', 'Teslimat tutarlarını 15 veya 15,50 biçiminde gir.');
      return;
    }
    const minutesMin = Number(timeMin);
    const minutesMax = Number(timeMax);
    if (![minutesMin, minutesMax].every(m => Number.isInteger(m) && m >= 1 && m <= 300) || minutesMin > minutesMax) {
      Alert.alert('Teslimat süresi hatalı', 'Süreleri dakika olarak gir; en kısa süre en uzundan büyük olamaz.');
      return;
    }
    const radiusKm = Number(radius.trim().replace(',', '.'));
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
      Alert.alert('Teslimat alanı hatalı', 'Teslimat alanı 0 ile 100 km arasında olmalıdır.');
      return;
    }
    const timeFormat = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (hours.some(h => h.open && (!timeFormat.test(h.start) || !timeFormat.test(h.end)))) {
      Alert.alert('Çalışma saati hatalı', 'Saatleri 09:00 biçiminde gir.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        display_name: storeName.trim(),
        bio: bio.trim() || null,
        city: city.trim() || null,
        district: district.trim() || null,
        address_line: address.trim() || null,
        logo_url: logoUrl,
        cover_url: coverUrl,
        delivery_fee_cents: fee,
        free_delivery_threshold_cents: threshold,
        min_order_cents: minimum ?? 0,
        delivery_time_min: minutesMin,
        delivery_time_max: minutesMax,
        delivery_radius_km: radiusKm,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        meal_cards: mealCards,
        accepts_scheduled: acceptsScheduled,
        pickup_enabled: pickupEnabled,
      };

      let savedRow: SellerRow;
      if (sellerRow) {
        // Update existing
        savedRow = await updateSeller(sellerRow.id, payload);
      } else {
        // Create new seller row
        savedRow = await createSeller({
          user_id: profile.id,
          seller_type: DEFAULT_SELLER_TYPE,
          ...payload,
        });
      }
      setSellerRow(savedRow);
      if (phone.trim() !== (profile.phone ?? '')) await updateProfile({ phone: phone.trim() });
      await upsertSellerHours(savedRow.id, hours.map((h, i) => ({
        day_of_week: i, // 0=Pazartesi: DAYS ile aynı sıra
        open_time: h.start,
        close_time: h.end,
        is_open: h.open,
      })));

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      Alert.alert('Kaydetme Hatası', err?.message ?? 'Bir hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <TopBar title="Mağaza ayarları" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={[styles.loadingText, { color: t.textSecondary }]}>Profil yükleniyor...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Mağaza ayarları"
        right={
          <Pressable
            style={[
              styles.topBtn,
              { backgroundColor: saved ? t.accent : isDesktop ? t.primary : t.panel },
              saving && styles.busy,
            ]}
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            {saved ? <Ionicons name="checkmark" size={18} color={t.onAccent} /> : null}
            <Text style={[styles.topBtnText, { color: saved ? t.onAccent : t.onBrand }]}>
              {saving ? 'Kaydediliyor...' : saved ? 'Kaydedildi' : 'Kaydet'}
            </Text>
          </Pressable>
        }
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Kapak fotoğrafı: ana sayfadaki kartta görünür */}
          <View style={styles.coverSection}>
            <ImageUploadBox
              imageUrl={coverUrl}
              fallbackBg={t.surface}
              bucket="food-images"
              path={`sellers/${sellerRow?.id ?? profile?.id ?? 'new'}/cover`}
              aspect={[16, 9]}
              size={170}
              width="100%"
              borderRadius={16}
              onUploaded={setCoverUrl}
            />
            <Text style={[styles.hint, { color: t.textSecondary }]}>Kapak fotoğrafı: müşteri seni ana sayfada bununla görür. En iyi yemeğini, aydınlıkta çek.</Text>
          </View>

          {/* Logo seçimi */}
          <View style={styles.logoSection}>
            <ImageUploadBox
              imageUrl={logoUrl}
              fallbackBg={t.surface}
              bucket="food-images"
              path={`sellers/${sellerRow?.id ?? profile?.id ?? 'new'}/logo`}
              aspect={[1, 1]}
              size={88}
              borderRadius={22}
              onUploaded={setLogoUrl}
            />
            <Text style={[styles.hint, { color: t.textSecondary }]}>Logo veya profil fotoğrafı</Text>
          </View>

          {/* Temel bilgiler */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Temel bilgiler</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <Input
              label="Mağaza adı *"
              value={storeName}
              onChangeText={setStoreName}
              placeholder={!HOME_SELLERS_ENABLED || sellerRow?.seller_type === 'restaurant' ? 'Örn: Kadıköy Lokantası' : "Örn: Ayşe'nin Ev Yemekleri"}
            />
            <Input
              label="Hakkında"
              style={styles.inputMulti}
              value={bio}
              onChangeText={setBio}
              placeholder="Restoranın hakkında kısa bir açıklama..."
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Input
              label="Telefon"
              value={phone}
              onChangeText={setPhone}
              placeholder="+90 5xx xxx xx xx"
              keyboardType="phone-pad"
            />
          </View>

          {/* Adres */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Konum</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <View style={styles.row2}>
              <View style={styles.flex}>
                <Input label="Şehir" value={city} onChangeText={setCity} placeholder="İstanbul" />
              </View>
              <View style={styles.flex}>
                <Input label="İlçe" value={district} onChangeText={setDistrict} placeholder="Kadıköy" />
              </View>
            </View>
            <Input label="Adres" value={address} onChangeText={setAddress} placeholder="Sokak, bina no..." />
          </View>

          {/* Çalışma saatleri */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Çalışma saatleri</Text>
          <View style={[styles.card, styles.hoursCard, { backgroundColor: t.surface }]}>
            {DAYS.map((day, idx) => (
              <View
                key={day}
                style={[styles.dayRow, idx < DAYS.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
              >
                <Text style={[styles.dayName, { color: hours[idx].open ? t.text : t.textMuted }]}>{day}</Text>
                <Switch
                  value={hours[idx].open}
                  onValueChange={() => toggleDay(idx)}
                  trackColor={{ true: t.primary, false: t.divider }}
                  thumbColor={t.onBrand}
                  {...({ activeThumbColor: t.onBrand } as object)}
                  accessibilityLabel={`${day}: açık`}
                />
                {hours[idx].open ? (
                  <View style={styles.timeRow}>
                    <TextInput
                      style={[styles.timeInput, { color: t.text, backgroundColor: t.background }]}
                      value={hours[idx].start}
                      onChangeText={v => setTime(idx, 'start', v)}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel={`${day} açılış saati`}
                    />
                    <Text style={[styles.timeSep, { color: t.textSecondary }]}>–</Text>
                    <TextInput
                      style={[styles.timeInput, { color: t.text, backgroundColor: t.background }]}
                      value={hours[idx].end}
                      onChangeText={v => setTime(idx, 'end', v)}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel={`${day} kapanış saati`}
                    />
                  </View>
                ) : (
                  <Text style={[styles.closedText, { color: t.textSecondary }]}>Kapalı</Text>
                )}
              </View>
            ))}
          </View>

          {/* Teslimat & Komisyon */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Teslimat ve komisyon</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <View>
              <Text style={[styles.label, { color: t.text }]}>Teslimat modeli</Text>
              <View style={styles.deliveryInfoRow}>
                <View style={[styles.iconBox, { backgroundColor: t.background }]}>
                  <Ionicons name="bicycle-outline" size={22} color={t.text} />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.deliveryTitle, { color: t.text }]}>{DELIVERY_CONFIG.label}</Text>
                  <Text style={[styles.deliveryDesc, { color: t.textSecondary }]}>{DELIVERY_CONFIG.description}</Text>
                </View>
              </View>
            </View>
            <Input label="Teslimat ücreti (₺)" value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="decimal-pad" placeholder="Boş bırakılırsa platform ücreti" />
            <Input label="Ücretsiz teslimat limiti (₺)" value={freeThreshold} onChangeText={setFreeThreshold} keyboardType="decimal-pad" placeholder="Boş bırakılırsa platform limiti" />
            <Input label="Minimum sipariş (₺)" value={minOrder} onChangeText={setMinOrder} keyboardType="decimal-pad" placeholder="0" />
            <View>
              <Text style={[styles.label, { color: t.text }]}>Teslimat süresi (dakika)</Text>
              <View style={styles.row2}>
                <View style={styles.flex}>
                  <Input value={timeMin} onChangeText={setTimeMin} keyboardType="number-pad" accessibilityLabel="En kısa teslimat süresi" />
                </View>
                <Text style={[styles.timeSep, styles.rangeSep, { color: t.textSecondary }]}>–</Text>
                <View style={styles.flex}>
                  <Input value={timeMax} onChangeText={setTimeMax} keyboardType="number-pad" accessibilityLabel="En uzun teslimat süresi" />
                </View>
              </View>
            </View>
            <Input label="Teslimat alanı (km)" value={radius} onChangeText={setRadius} keyboardType="decimal-pad" />
            <View>
              <Text style={[styles.label, { color: t.text }]}>Mağaza konumu</Text>
              <Pressable
                style={[styles.locationBtn, { borderColor: t.divider, backgroundColor: t.surface }]}
                onPress={fillMyLocation}
                disabled={locating}
                accessibilityRole="button"
                accessibilityState={{ disabled: locating, busy: locating }}
              >
                {locating ? (
                  <ActivityIndicator size="small" color={t.primary} />
                ) : (
                  <>
                    <Ionicons name={coords ? 'checkmark-circle' : 'location-outline'} size={18} color={coords ? t.success : t.text} />
                    <Text style={[styles.locationBtnText, { color: t.text }]}>{coords ? 'Konum kayıtlı · Güncelle' : 'Konumumu kullan'}</Text>
                  </>
                )}
              </Pressable>
              {!coords && <Text style={[styles.hint, { color: t.textSecondary }]}>Konum girilmezse teslimat alanı uygulanmaz.</Text>}
            </View>
            <View>
              <Text style={[styles.label, { color: t.text }]}>Komisyon oranın</Text>
              <View style={styles.commRow}>
                <Text style={[styles.commLabel, { color: t.text }]}>{SELLER_TYPE_LABELS[sellerRow?.seller_type ?? DEFAULT_SELLER_TYPE]}</Text>
                <Text style={[styles.commDesc, { color: t.textSecondary }]}>Her siparişten</Text>
                <Text style={[styles.commRate, { color: t.text }]}>{commissionRates ? `%${commissionRates[sellerRow?.seller_type ?? DEFAULT_SELLER_TYPE]}` : '-'}</Text>
              </View>
              <Text style={[styles.hint, { color: t.textSecondary }]}>{COMMISSION_DESCRIPTION}</Text>
            </View>
          </View>

          {/* Sipariş seçenekleri */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Sipariş seçenekleri</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <View style={styles.optionRow}>
              <View style={styles.flex}>
                <Text style={[styles.optionTitle, { color: t.text }]}>Gelip alma</Text>
                <Text style={[styles.optionDesc, { color: t.textSecondary }]}>Müşteri siparişini restorandan alır, teslimat ücreti alınmaz.</Text>
              </View>
              <Switch
                value={pickupEnabled}
                onValueChange={setPickupEnabled}
                trackColor={{ true: t.primary, false: t.divider }}
                thumbColor={t.onBrand}
                {...({ activeThumbColor: t.onBrand } as object)}
                accessibilityLabel="Gelip alma"
              />
            </View>
            <View style={[styles.optionRow, styles.optionDivider, { borderTopColor: t.divider }]}>
              <View style={styles.flex}>
                <Text style={[styles.optionTitle, { color: t.text }]}>İleri tarihli sipariş</Text>
                <Text style={[styles.optionDesc, { color: t.textSecondary }]}>Müşteri 7 güne kadar ileri bir saate sipariş verir. Kapalıysan siparişi açılınca yanıtlarsın, 30 dakika açık olduğun süreden sayılır. Saate 15 dakika kala yanıt yoksa sipariş iptal olur.</Text>
              </View>
              <Switch
                value={acceptsScheduled}
                onValueChange={setAcceptsScheduled}
                trackColor={{ true: t.primary, false: t.divider }}
                thumbColor={t.onBrand}
                {...({ activeThumbColor: t.onBrand } as object)}
                accessibilityLabel="İleri tarihli sipariş"
              />
            </View>
            <View style={[styles.optionDivider, { borderTopColor: t.divider }]}>
              <Text style={[styles.optionTitle, { color: t.text }]}>Kapıda yemek kartı</Text>
              <Text style={[styles.optionDesc, { color: t.textSecondary }]}>Kuryede veya kasada geçen kartları seç. Tahsilat sende, komisyon nakit ve kapıda kartla aynı.</Text>
              <View style={styles.cardChips}>
                {MEAL_CARDS.map(card => {
                  const on = mealCards.includes(card.id);
                  return (
                    <Pressable
                      key={card.id}
                      style={[styles.cardChip, { backgroundColor: on ? t.accent : t.background }]}
                      hitSlop={2}
                      onPress={() => setMealCards(prev => toggleMealCard(prev, card.id))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      {on ? <Ionicons name="checkmark" size={16} color={t.onAccent} /> : null}
                      <Text style={[styles.cardChipText, { color: on ? t.onAccent : t.text }]}>{card.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Yalnızca otomatik satıcı ödemesi açıkken görünür */}
          {sellerRow ? <CompanyInfoCard sellerId={sellerRow.id} /> : null}

          {/* Tehlikeli bölge */}
          <Text style={[styles.sectionTitle, { color: t.heading }]}>Hesap</Text>
          <View style={[styles.card, styles.accountCard, { backgroundColor: t.surface }]}>
            <Pressable style={styles.accountRow} onPress={toggleStorePause} accessibilityRole="button">
              <Text style={[styles.accountText, { color: t.text }]}>{sellerRow?.is_paused ? 'Mağazayı aç' : 'Mağazayı geçici kapat'}</Text>
              <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
            </Pressable>
            <Pressable
              style={[styles.accountRow, { borderTopWidth: 1, borderTopColor: t.divider }]}
              onPress={() => Alert.alert('Çıkış yap', 'Hesabından çıkış yapmak istediğine emin misin?', [
                { text: 'İptal', style: 'cancel' },
                { text: 'Çıkış yap', style: 'destructive', onPress: () => signOut() },
              ])}
              accessibilityRole="button"
            >
              <Text style={[styles.accountText, { color: t.text }]}>Çıkış yap</Text>
              <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
            </Pressable>
            <Pressable
              style={[styles.accountRow, { borderTopWidth: 1, borderTopColor: t.divider }]}
              onPress={confirmDeleteAccount}
              accessibilityRole="button"
            >
              <Text style={[styles.accountText, { color: t.danger }]}>Hesabımı sil</Text>
              <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
            </Pressable>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontFamily: fonts.regular, fontSize: 13 },
  busy: { opacity: 0.6 },

  topBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  topBtnText: { fontSize: 14, fontFamily: fonts.bold },

  scroll: { padding: 16, paddingBottom: 40 },

  coverSection: { marginBottom: 16 },
  logoSection: { alignItems: 'center', marginBottom: 12 },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 6 },

  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 8, marginBottom: 8 },

  card: { borderRadius: 16, padding: 14, marginBottom: 12, gap: 12 },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontFamily: fonts.semibold, marginBottom: 5 },
  inputMulti: { minHeight: 64, paddingVertical: 10 },

  hoursCard: { paddingVertical: 2, gap: 0 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12, minHeight: 60 },
  dayName: { width: 34, fontSize: 13, fontFamily: fonts.bold },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  timeInput: { width: 64, height: 44, fontSize: 13, fontFamily: fonts.semibold, borderRadius: 10, paddingHorizontal: 6, textAlign: 'center' },
  timeSep: { fontSize: 13, fontFamily: fonts.regular },
  rangeSep: { paddingHorizontal: 2 },
  closedText: { marginLeft: 'auto', fontSize: 13, fontFamily: fonts.semibold },

  deliveryInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  deliveryTitle: { fontSize: 15, fontFamily: fonts.bold },
  deliveryDesc: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 2 },

  locationBtn: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1 },
  locationBtnText: { fontSize: 14, fontFamily: fonts.bold },

  commRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  commLabel: { fontSize: 13, fontFamily: fonts.bold },
  commDesc: { flex: 1, fontSize: 12, fontFamily: fonts.regular },
  commRate: { fontSize: 15, fontFamily: fonts.extrabold },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  optionDivider: { borderTopWidth: 1, paddingTop: 12 },
  optionTitle: { fontSize: 14, fontFamily: fonts.bold },
  optionDesc: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 2 },
  cardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  cardChip: { height: 40, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cardChipText: { fontSize: 13, fontFamily: fonts.bold },

  accountCard: { paddingVertical: 0, gap: 0 },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50 },
  accountText: { fontSize: 14, fontFamily: fonts.semibold },
});
