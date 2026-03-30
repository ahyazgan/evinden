import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';

const SECTIONS = [
  {
    title: '1. Hizmet Tanimi',
    body: 'Evinden, ev yemegi siparis platformudur. Saticilar (ev ascilar) ile musteriler arasinda aracilik hizmeti sunmaktadir. Platform, yemeklerin hazirlanmasi, kalitesi veya gida guvenligi konusunda dogrudan sorumluluk tasiyan taraf degildir; bu sorumluluk satici ve ilgili mevzuata aittir.',
  },
  {
    title: '2. Hesap Olusturma',
    body: 'Kullanicilar hesap olustururken dogru ve guncel bilgi vermekle yukumludur.\n\n' +
      '\u2022 Hesap bilgilerinizin guvenliginden siz sorumlusunuz\n' +
      '\u2022 Hesabinizla yapilan tum islemlerden siz sorumlusunuz\n' +
      '\u2022 18 yasindan kucukler ebeveyn izni olmadan hesap olusturamaz\n' +
      '\u2022 Yanlis veya yaniltici bilgi veren hesaplar askiya alinabilir',
  },
  {
    title: '3. Siparis ve Odeme',
    body: 'Siparis sureci ve odeme kosullari:\n\n' +
      '\u2022 Siparisler satici tarafindan onaylandiktan sonra kesinlesir\n' +
      '\u2022 Fiyatlar satici tarafindan belirlenir ve KDV dahildir\n' +
      '\u2022 Siparis iptali, satici hazirlama surecine baslamadan once yapilabilir\n' +
      '\u2022 Iade kosullari urunun durumuna ve satici politikasina bagli olarak degerlendirilir\n' +
      '\u2022 Platform komisyon ucreti siparis tutarina dahildir',
  },
  {
    title: '4. Satici Sorumluluklari',
    body: 'Platformda satis yapan saticilar asagidaki sorumluluklara sahiptir:\n\n' +
      '\u2022 Gida guvenligine iliskin tum mevzuata uyum saglamak\n' +
      '\u2022 Hijyen kurallarına uymak ve temizlik standartlarini korumak\n' +
      '\u2022 Gerekli izin ve lisanslara sahip olmak\n' +
      '\u2022 Urun bilgilerini dogru ve guncel tutmak\n' +
      '\u2022 Allerjen bilgilerini acikca belirtmek',
  },
  {
    title: '5. Teslimat',
    body: 'Teslimat hizmetine iliskin kosullar:\n\n' +
      '\u2022 Belirtilen teslimat sureleri tahmini olup garanti niteligi tasimaz\n' +
      '\u2022 Teslimat satici kuryeleri tarafindan gerceklestirilir\n' +
      '\u2022 Hava kosullari, trafik vb. nedenlerle gecikme yasanabilir\n' +
      '\u2022 Teslimat adresinin dogru girilmesinden musteri sorumludur\n' +
      '\u2022 Teslimat alani satici tarafindan belirlenmektedir',
  },
  {
    title: '6. Fikri Mulkiyet',
    body: 'Evinden uygulamasinda yer alan tum icerikler (logo, tasarim, yazilim, gorseller, metinler) Evinden\'e aittir ve telif hakki ile korunmaktadir. Izinsiz kopyalama, dagitma veya degistirme yasaktir.',
  },
  {
    title: '7. Sorumluluk Sinirlamasi',
    body: 'Evinden platformu, satici ile musteri arasinda araci konumundadir.\n\n' +
      '\u2022 Yemeklerin kalitesi, tadi veya gida guvenligi satici sorumlulugundadir\n' +
      '\u2022 Teslimat surecinde olusabilecek aksakliklardan dolayi platform sinirli sorumluluk tasir\n' +
      '\u2022 Kullanicilarin birbirleriyle olan anlasmaliklarindan platform sorumlu degildir',
  },
  {
    title: '8. Degisiklikler',
    body: 'Evinden, bu kullanim kosullarini onceden bildirmeksizin degistirme hakkini sakli tutar. Onemli degisikliklerde kullanicilar uygulama ici bildirim veya e-posta yoluyla bilgilendirilir. Degisiklik sonrasi uygulamayi kullanmaya devam etmeniz, yeni kosullari kabul ettiginiz anlamina gelir.',
  },
  {
    title: '9. Uygulanacak Hukuk',
    body: 'Bu kullanim kosullari Turkiye Cumhuriyeti kanunlarina tabidir. Uyusmazlik halinde Istanbul mahkemeleri ve icra daireleri yetkilidir.',
  },
  {
    title: '10. Iletisim',
    body: 'Kullanim kosullari hakkinda soru ve onerileriniz icin:\n\n' +
      'E-posta: destek@evinden.app',
  },
];

export default function TermsScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Kullanim Kosullari</Text>
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
