import { useState } from 'react';
import {
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { COMMISSION_TIERS, DELIVERY_CONFIG } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';

const LOGO_OPTIONS = ['🍲', '🥘', '🍳', '🥗', '🥙', '🌮', '🍱', '🥐', '🎂', '🍰', '🥩', '🐟', '🍜', '🍝', '🫕', '🧆'];

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
  const { signOut } = useAuth();
  const [storeName, setStoreName] = useState('Demo Mutfağım');
  const [bio, setBio] = useState('Her gün taze pişirilen geleneksel Türk yemekleri.');
  const [city, setCity] = useState('İstanbul');
  const [district, setDistrict] = useState('Kadıköy');
  const [address, setAddress] = useState('Moda Cad. 42');
  const [phone, setPhone] = useState('+90 532 000 00 00');
  const [logo, setLogo] = useState('🍲');
  const [hours, setHours] = useState<WorkHour[]>(DEFAULT_HOURS);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleDay = (idx: number) => {
    setHours(prev => prev.map((h, i) => i === idx ? { ...h, open: !h.open } : h));
  };

  const setTime = (idx: number, field: 'start' | 'end', val: string) => {
    setHours(prev => prev.map((h, i) => i === idx ? { ...h, [field]: val } : h));
  };

  const handleSave = () => {
    if (!storeName.trim()) {
      Alert.alert('Mağaza adı gerekli');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mağaza Ayarları</Text>
          <Pressable
            style={[styles.saveBtn, saved && styles.saveBtnDone]}
            onPress={handleSave}
          >
            <Text style={styles.saveBtnText}>{saved ? '✓ Kaydedildi' : 'Kaydet'}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Logo seçimi */}
          <View style={styles.logoSection}>
            <Pressable style={styles.logoCircle} onPress={() => setLogoPickerOpen(v => !v)}>
              <Text style={styles.logoText}>{logo}</Text>
            </Pressable>
            <Text style={styles.logoHint}>Logo seç</Text>
          </View>

          {logoPickerOpen ? (
            <View style={styles.logoPicker}>
              {LOGO_OPTIONS.map(e => (
                <Pressable
                  key={e}
                  style={[styles.logoOption, logo === e && styles.logoOptionActive]}
                  onPress={() => { setLogo(e); setLogoPickerOpen(false); }}
                >
                  <Text style={styles.logoOptionText}>{e}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Temel bilgiler */}
          <Text style={styles.sectionTitle}>Temel Bilgiler</Text>
          <View style={styles.card}>
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Mağaza Adı *</Text>
              <TextInput
                style={styles.input}
                value={storeName}
                onChangeText={setStoreName}
                placeholder="Örn: Ayşe'nin Ev Yemekleri"
                placeholderTextColor="#C4B8AA"
              />
            </View>
            <View style={[styles.fieldWrap, styles.fieldBorder]}>
              <Text style={styles.label}>Hakkında</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={bio}
                onChangeText={setBio}
                placeholder="Mutfağınız hakkında kısa açıklama..."
                placeholderTextColor="#C4B8AA"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
            <View style={[styles.fieldWrap, styles.fieldBorder]}>
              <Text style={styles.label}>Telefon</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+90 5xx xxx xx xx"
                placeholderTextColor="#C4B8AA"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* Adres */}
          <Text style={styles.sectionTitle}>Konum</Text>
          <View style={styles.card}>
            <View style={styles.row2}>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <Text style={styles.label}>Şehir</Text>
                <TextInput
                  style={styles.input}
                  value={city}
                  onChangeText={setCity}
                  placeholder="İstanbul"
                  placeholderTextColor="#C4B8AA"
                />
              </View>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <Text style={styles.label}>İlçe</Text>
                <TextInput
                  style={styles.input}
                  value={district}
                  onChangeText={setDistrict}
                  placeholder="Kadıköy"
                  placeholderTextColor="#C4B8AA"
                />
              </View>
            </View>
            <View style={[styles.fieldWrap, styles.fieldBorder]}>
              <Text style={styles.label}>Adres</Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder="Sokak, bina no..."
                placeholderTextColor="#C4B8AA"
              />
            </View>
          </View>

          {/* Çalışma saatleri */}
          <Text style={styles.sectionTitle}>Çalışma Saatleri</Text>
          <View style={styles.card}>
            {DAYS.map((day, idx) => (
              <View
                key={day}
                style={[styles.dayRow, idx < DAYS.length - 1 && styles.dayRowBorder]}
              >
                <Text style={[styles.dayName, !hours[idx].open && styles.dayNameClosed]}>
                  {day}
                </Text>
                <Switch
                  value={hours[idx].open}
                  onValueChange={() => toggleDay(idx)}
                  trackColor={{ true: colors.primary, false: '#E0E0E0' }}
                  thumbColor="#fff"
                />
                {hours[idx].open ? (
                  <View style={styles.timeRow}>
                    <TextInput
                      style={styles.timeInput}
                      value={hours[idx].start}
                      onChangeText={v => setTime(idx, 'start', v)}
                      keyboardType="numbers-and-punctuation"
                    />
                    <Text style={styles.timeSep}>–</Text>
                    <TextInput
                      style={styles.timeInput}
                      value={hours[idx].end}
                      onChangeText={v => setTime(idx, 'end', v)}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                ) : (
                  <Text style={styles.closedText}>Kapalı</Text>
                )}
              </View>
            ))}
          </View>

          {/* Teslimat & Komisyon */}
          <Text style={styles.sectionTitle}>Teslimat & Komisyon</Text>
          <View style={styles.card}>
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Teslimat Modeli</Text>
              <View style={styles.deliveryInfoRow}>
                <Text style={styles.deliveryEmoji}>🛵</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deliveryTitle}>{DELIVERY_CONFIG.label}</Text>
                  <Text style={styles.deliveryDesc}>{DELIVERY_CONFIG.description}</Text>
                </View>
              </View>
            </View>
            <View style={[styles.fieldWrap, styles.fieldBorder]}>
              <Text style={styles.label}>Varsayılan Teslimat Ücreti</Text>
              <Text style={styles.input}>₺{(DELIVERY_CONFIG.defaultDeliveryFeeCents / 100).toFixed(2).replace('.', ',')}</Text>
            </View>
            <View style={[styles.fieldWrap, styles.fieldBorder]}>
              <Text style={styles.label}>Komisyon Oranları</Text>
              {COMMISSION_TIERS.map(t => (
                <View key={t.id} style={styles.commRow}>
                  <Text style={styles.commLabel}>{t.label}</Text>
                  <Text style={styles.commDesc}>{t.description}</Text>
                  <Text style={styles.commRate}>%{t.rate}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Tehlikeli bölge */}
          <Text style={styles.sectionTitle}>Hesap</Text>
          <View style={styles.card}>
            <Pressable style={styles.dangerRow}>
              <Text style={styles.dangerText}>Mağazayı Geçici Kapat</Text>
              <Text style={styles.dangerArrow}>›</Text>
            </Pressable>
            <Pressable
              style={[styles.dangerRow, { borderTopWidth: 1, borderTopColor: '#F0ECE6' }]}
              onPress={() => Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
                { text: 'İptal', style: 'cancel' },
                { text: 'Çıkış Yap', style: 'destructive', onPress: () => signOut() },
              ])}
            >
              <Text style={[styles.dangerText, { color: '#C62828' }]}>Çıkış Yap</Text>
              <Text style={styles.dangerArrow}>›</Text>
            </Pressable>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveBtnDone: { backgroundColor: '#3DBE7A' },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  scroll: { padding: 16, paddingBottom: 48 },

  logoSection: { alignItems: 'center', marginBottom: 20 },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#EDE8E2',
    marginBottom: 6,
  },
  logoText: { fontSize: 46 },
  logoHint: { fontSize: 12, color: '#A89A8A' },

  logoPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 12,
    marginBottom: 20,
    justifyContent: 'center',
  },
  logoOption: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  logoOptionActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: '#FFF5F0' },
  logoOptionText: { fontSize: 24 },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A89A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 4,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    marginBottom: 20,
    overflow: 'hidden',
  },
  fieldWrap: { paddingHorizontal: 14, paddingVertical: 12 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: '#F5F0EA' },
  row2: { flexDirection: 'row', gap: 0 },
  label: { fontSize: 11, fontWeight: '700', color: '#A89A8A', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    fontSize: 15,
    color: '#1A1208',
    backgroundColor: 'transparent',
    padding: 0,
  },
  inputMulti: { height: 64, paddingTop: 2 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
  },
  dayRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' },
  dayName: { width: 30, fontSize: 13, fontWeight: '700', color: '#1A1208' },
  dayNameClosed: { color: '#C4B8AA' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  timeInput: {
    width: 50,
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1208',
    backgroundColor: '#FAF7F2',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 6,
    paddingVertical: 4,
    textAlign: 'center',
  },
  timeSep: { fontSize: 13, color: '#A89A8A' },
  closedText: { marginLeft: 'auto', fontSize: 12, color: '#C4B8AA', fontWeight: '600' },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dangerText: { fontSize: 14, fontWeight: '600', color: '#E53935' },
  dangerArrow: { fontSize: 18, color: '#FFCDD2' },

  deliveryInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  deliveryEmoji: { fontSize: 28 },
  deliveryTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  deliveryDesc: { fontSize: 12, color: '#A89A8A', marginTop: 2, lineHeight: 17 },
  commRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  commLabel: { fontSize: 13, fontWeight: '700', color: '#1A1208', width: 90 },
  commDesc: { fontSize: 12, color: '#A89A8A', flex: 1 },
  commRate: { fontSize: 15, fontWeight: '800', color: colors.primary },
});
