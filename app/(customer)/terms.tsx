import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { TopBar } from '@/components/shared/TopBar';

const SECTIONS = [
  {
    title: '1. Hizmet Tanımı',
    body: 'Afiyetli, restoran siparişi platformudur. Satıcılar (restoranlar) ile müşteriler arasında aracılık hizmeti sunmaktadır. Platform, yemeklerin hazırlanması, kalitesi veya gıda güvenliği konusunda doğrudan sorumluluk taşıyan taraf değildir; bu sorumluluk satıcı ve ilgili mevzuata aittir.',
  },
  {
    title: '2. Hesap Oluşturma',
    body: 'Kullanıcılar hesap oluştururken doğru ve güncel bilgi vermekle yükümlüdür.\n\n' +
      '\u2022 Hesap bilgilerinizin güvenliğinden siz sorumlusunuz\n' +
      '\u2022 Hesabınızla yapılan tüm işlemlerden siz sorumlusunuz\n' +
      '\u2022 18 yaşından küçükler ebeveyn izni olmadan hesap oluşturamaz\n' +
      '\u2022 Yanlış veya yanıltıcı bilgi veren hesaplar askıya alınabilir',
  },
  {
    title: '3. Sipariş ve Ödeme',
    body: 'Sipariş süreci ve ödeme koşulları:\n\n' +
      '\u2022 Siparişler satıcı tarafından onaylandıktan sonra kesinleşir\n' +
      '\u2022 Fiyatlar satıcı tarafından belirlenir ve KDV dahildir\n' +
      '\u2022 Sipariş iptali, satıcı hazırlama sürecine başlamadan önce yapılabilir\n' +
      '\u2022 İade koşulları ürünün durumuna ve satıcı politikasına bağlı olarak değerlendirilir\n' +
      '\u2022 Platform komisyon ücreti sipariş tutarına dahildir',
  },
  {
    title: '4. Satıcı Sorumlulukları',
    body: 'Platformda satış yapan satıcılar aşağıdaki sorumluluklara sahiptir:\n\n' +
      '\u2022 Gıda güvenliğine ilişkin tüm mevzuata uyum sağlamak\n' +
      '\u2022 Hijyen kurallarına uymak ve temizlik standartlarını korumak\n' +
      '\u2022 Gerekli izin ve lisanslara sahip olmak\n' +
      '\u2022 Ürün bilgilerini doğru ve güncel tutmak\n' +
      '\u2022 Alerjen bilgilerini açıkça belirtmek',
  },
  {
    title: '5. Teslimat',
    body: 'Teslimat hizmetine ilişkin koşullar:\n\n' +
      '\u2022 Belirtilen teslimat süreleri tahmini olup garanti niteliği taşımaz\n' +
      '\u2022 Teslimat satıcı kuryeleri tarafından gerçekleştirilir\n' +
      '\u2022 Hava koşulları, trafik vb. nedenlerle gecikme yaşanabilir\n' +
      '\u2022 Teslimat adresinin doğru girilmesinden müşteri sorumludur\n' +
      '\u2022 Teslimat alanı satıcı tarafından belirlenmektedir',
  },
  {
    title: '6. Fikri Mülkiyet',
    body: 'Afiyetli uygulamasında yer alan tüm içerikler (logo, tasarım, yazılım, görseller, metinler) Afiyetli\'ye aittir ve telif hakkı ile korunmaktadır. İzinsiz kopyalama, dağıtma veya değiştirme yasaktır.',
  },
  {
    title: '7. Sorumluluk Sınırlaması',
    body: 'Afiyetli platformu, satıcı ile müşteri arasında aracı konumundadır.\n\n' +
      '\u2022 Yemeklerin kalitesi, tadı veya gıda güvenliği satıcı sorumluluğundadır\n' +
      '\u2022 Teslimat sürecinde oluşabilecek aksaklıklardan dolayı platform sınırlı sorumluluk taşır\n' +
      '\u2022 Kullanıcıların birbirleriyle olan anlaşmazlıklarından platform sorumlu değildir',
  },
  {
    title: '8. Değişiklikler',
    body: 'Afiyetli, bu kullanım koşullarını önceden bildirmeksizin değiştirme hakkını saklı tutar. Önemli değişikliklerde kullanıcılar uygulama içi bildirim veya e-posta yoluyla bilgilendirilir. Değişiklik sonrası uygulamayı kullanmaya devam etmeniz, yeni koşulları kabul ettiğiniz anlamına gelir.',
  },
  {
    title: '9. Uygulanacak Hukuk',
    body: 'Bu kullanım koşulları Türkiye Cumhuriyeti kanunlarına tabidir. Uyuşmazlık halinde İstanbul mahkemeleri ve icra daireleri yetkilidir.',
  },
  {
    title: '10. İletişim',
    body: 'Kullanım koşulları hakkında soru ve önerileriniz için:\n\n' +
      'E-posta: destek@afiyetli.app',
  },
];

export default function TermsScreen() {
  const { colors: t } = useTheme();

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Kullanım koşulları" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section, idx) => (
          <View key={idx} style={[styles.card, { backgroundColor: t.surface }]}>
            <Text style={[styles.sectionTitle, { color: t.heading }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: t.textSecondary }]}>{section.body}</Text>
          </View>
        ))}

        <Text style={[styles.updateDate, { color: t.textSecondary }]}>
          Son güncelleme: 31 Mart 2026
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 10 },
  card: { borderRadius: 16, padding: 14 },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, marginBottom: 8 },
  sectionBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  updateDate: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, marginTop: 6 },
});
