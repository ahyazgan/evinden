import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';

const SECTIONS = [
  {
    title: '1. Toplanan Veriler',
    body: 'Evinden uygulamasini kullandiginizda asagidaki verileriniz toplanabilir:\n\n' +
      '\u2022 Kisisel Bilgiler: Ad, soyad, telefon numarasi, e-posta adresi, teslimat adresi\n' +
      '\u2022 Konum Verileri: Siparis teslimati icin konum bilginiz\n' +
      '\u2022 Siparis Gecmisi: Gecmis siparisleriniz ve tercihleriniz\n' +
      '\u2022 Cihaz Bilgileri: Cihaz modeli, isletim sistemi ve uygulama surumu',
  },
  {
    title: '2. Verilerin Kullanimi',
    body: 'Toplanan verileriniz asagidaki amaclarla kullanilir:\n\n' +
      '\u2022 Siparis islemlerinin gerceklestirilmesi ve takibi\n' +
      '\u2022 Teslimat surecinin yonetilmesi\n' +
      '\u2022 Musteri hizmetleri ve destek saglanmasi\n' +
      '\u2022 Uygulama deneyiminin iyilestirilmesi\n' +
      '\u2022 Bildirim ve kampanya bilgilerinin iletilmesi',
  },
  {
    title: '3. Verilerin Paylasilmasi',
    body: 'Kisisel verileriniz asagidaki durumlarda ucuncu taraflarla paylasilabilir:\n\n' +
      '\u2022 Saticilar: Siparislerinizin hazirlanmasi ve teslimati icin gerekli bilgiler\n' +
      '\u2022 Odeme Saglayicilari: Guvenli odeme islemleri icin\n' +
      '\u2022 Yasal Zorunluluklar: Mahkeme karari veya yasal duzenleme gerektirdigi hallerde',
  },
  {
    title: '4. Veri Guvenligi',
    body: 'Verilerinizin guvenligi bizim icin en onemli onceliktir:\n\n' +
      '\u2022 Tum veriler SSL/TLS sifreleme ile korunmaktadir\n' +
      '\u2022 Verileriniz guvenli sunucularda saklanmaktadir\n' +
      '\u2022 Duzenli guvenlik denetimleri yapilmaktadir\n' +
      '\u2022 Erisim yetkilendirme sistemleri ile kontrol edilmektedir',
  },
  {
    title: '5. Kullanici Haklari (KVKK)',
    body: '6698 sayili Kisisel Verilerin Korunmasi Kanunu (KVKK) kapsaminda asagidaki haklara sahipsiniz:\n\n' +
      '\u2022 Kisisel verilerinizin islenip islenmedigini ogrenme\n' +
      '\u2022 Kisisel verileriniz islenmisse buna iliskin bilgi talep etme\n' +
      '\u2022 Kisisel verilerinizin islenme amacini ve bunlarin amacina uygun kullanilip kullanilmadigini ogrenme\n' +
      '\u2022 Yurt icinde veya yurt disinda kisisel verilerinizin aktarildigi ucuncu kisileri bilme\n' +
      '\u2022 Kisisel verilerinizin eksik veya yanlis islenmis olmasi halinde bunlarin duzeltilmesini isteme\n' +
      '\u2022 Kisisel verilerinizin silinmesini veya yok edilmesini isteme',
  },
  {
    title: '6. Cerezler ve Analitik',
    body: 'Uygulama performansini olcmek ve deneyiminizi iyilestirmek amaciyla anonim analitik verileri toplanmaktadir. Bu veriler kimliginizi belirlemek icin kullanilamaz ve yalnizca istatistiksel amaclarla degerlendirilir.',
  },
  {
    title: '7. Iletisim',
    body: 'Gizlilik politikamiz hakkinda sorulariniz veya talepleriniz icin bizimle iletisime gecebilirsiniz:\n\n' +
      'E-posta: destek@evinden.app',
  },
];

export default function PrivacyScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Gizlilik Politikasi</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section, idx) => (
          <View key={idx} style={[styles.card, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: t.textSecondary }]}>{section.body}</Text>
          </View>
        ))}

        <Text style={[styles.updateDate, { color: t.textMuted }]}>
          Son guncelleme: 31 Mart 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 32 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: fonts.extrabold,
  },
  scroll: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: fonts.bold,
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 20,
  },
  updateDate: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 16,
  },
});
