import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';

const SECTIONS = [
  {
    title: '1. Toplanan Veriler',
    body: 'Evinden uygulamasını kullandığınızda aşağıdaki verileriniz toplanabilir:\n\n' +
      '\u2022 Kişisel Bilgiler: Ad, soyad, telefon numarası, e-posta adresi, teslimat adresi\n' +
      '\u2022 Konum Verileri: Sipariş teslimatı ve teslimat alanı kontrolü için konum bilginiz\n' +
      '\u2022 Ödeme: Online ödemeler iyzico üzerinden yapılır. Kart bilgileriniz uygulamaya ve sunucularımıza gelmez, saklanmaz\n' +
      '\u2022 Sipariş Geçmişi: Geçmiş siparişleriniz ve tercihleriniz\n' +
      '\u2022 Satıcı Belgeleri: Restoran başvurularında vergi levhası ve işletme belgesi. Yalnızca başvuru incelemesi için kullanılır ve gizli saklanır\n' +
      '\u2022 Cihaz Bilgileri: Cihaz modeli, işletim sistemi ve uygulama sürümü',
  },
  {
    title: '2. Verilerin Kullanımı',
    body: 'Toplanan verileriniz aşağıdaki amaçlarla kullanılır:\n\n' +
      '\u2022 Sipariş işlemlerinin gerçekleştirilmesi ve takibi\n' +
      '\u2022 Teslimat sürecinin yönetilmesi\n' +
      '\u2022 Müşteri hizmetleri ve destek sağlanması\n' +
      '\u2022 Uygulama deneyiminin iyileştirilmesi\n' +
      '\u2022 Bildirim ve kampanya bilgilerinin iletilmesi\n' +
      '\u2022 Satıcı ile yazıştığınız mesajların karşı tarafa iletilmesi; uygunsuz diye bildirilen mesajlar yönetici tarafından incelenir',
  },
  {
    title: '3. Verilerin Paylaşılması',
    body: 'Kişisel verileriniz aşağıdaki durumlarda üçüncü taraflarla paylaşılabilir:\n\n' +
      '\u2022 Satıcılar: Siparişlerinizin hazırlanması ve teslimatı için gerekli bilgiler\n' +
      '\u2022 Ödeme Sağlayıcıları: Güvenli ödeme işlemleri için\n' +
      '\u2022 Hata Takibi: Uygulama hatalarını gidermek için Sentry hizmetine hata kaydı ve hesap kimliği (ad, adres ve mesaj içeriği olmadan)\n' +
      '\u2022 Yasal Zorunluluklar: Mahkeme kararı veya yasal düzenleme gerektirdiği hallerde',
  },
  {
    title: '4. Veri Güvenliği',
    body: 'Verilerinizin güvenliği bizim için en önemli önceliktir:\n\n' +
      '\u2022 Tüm veriler SSL/TLS şifreleme ile korunmaktadır\n' +
      '\u2022 Verileriniz güvenli sunucularda saklanmaktadır\n' +
      '\u2022 Düzenli güvenlik denetimleri yapılmaktadır\n' +
      '\u2022 Erişim yetkilendirme sistemleri ile kontrol edilmektedir',
  },
  {
    title: '5. Kullanıcı Hakları (KVKK)',
    body: '6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında aşağıdaki haklara sahipsiniz:\n\n' +
      '\u2022 Kişisel verilerinizin işlenip işlenmediğini öğrenme\n' +
      '\u2022 Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme\n' +
      '\u2022 Kişisel verilerinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme\n' +
      '\u2022 Yurt içinde veya yurt dışında kişisel verilerinizin aktarıldığı üçüncü kişileri bilme\n' +
      '\u2022 Kişisel verilerinizin eksik veya yanlış işlenmiş olması halinde bunların düzeltilmesini isteme\n' +
      '\u2022 Kişisel verilerinizin silinmesini veya yok edilmesini isteme\n\n' +
      'Hesabınızı uygulama içindeki profil ekranından silebilirsiniz. Geçmiş sipariş kayıtları, kimlik ve adres bilgileriniz çıkarılarak saklanır. Mesajlaşmalarınız da silinir; yalnızca uygunsuz diye bildirilmiş mesajların metni inceleme için saklanır.',
  },
  {
    title: '6. Çerezler ve Analitik',
    body: 'Uygulama performansını ölçmek ve deneyiminizi iyileştirmek amacıyla anonim analitik verileri toplanmaktadir. Bu veriler kimliğinizi belirlemek için kullanılamaz ve yalnızca istatistiksel amaçlarla değerlendirilir.',
  },
  {
    title: '7. İletişim',
    body: 'Gizlilik politikamız hakkında sorularınız veya talepleriniz için bizimle iletişime geçebilirsiniz:\n\n' +
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
        <Text style={[styles.headerTitle, { color: t.text }]}>Gizlilik Politikası</Text>
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
    fontFamily: fonts.bold,
    marginBottom: 10,
  },
  sectionBody: {
    fontFamily: fonts.regular, fontSize: 13,
    lineHeight: 20,
  },
  updateDate: {
    textAlign: 'center',
    fontFamily: fonts.regular, fontSize: 12,
    marginTop: 8,
    marginBottom: 16,
  },
});
