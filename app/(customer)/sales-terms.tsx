import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { PLATFORM_LEGAL, SALES_TERMS_VERSION } from '@/constants/business';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

// Taslak metin: canlıdan önce hukukçuya gösterilecek (docs/CANLIYA-ALMA.md, bölüm 7).
const company = [PLATFORM_LEGAL.title, PLATFORM_LEGAL.address, PLATFORM_LEGAL.taxNumber && `Vergi no: ${PLATFORM_LEGAL.taxNumber}`]
  .filter(Boolean)
  .join(', ');

const SECTIONS = [
  {
    title: 'Taraflar',
    body: `Satıcı: Siparişini verdiğin restoran. Adı sepette ve sipariş ekranında yazar.\n\nAracı hizmet sağlayıcı: ${company || PLATFORM_LEGAL.name}. İletişim: ${PLATFORM_LEGAL.email}. Evinden, satıcı ile seni buluşturan platformdur; yemeği satıcı hazırlar ve satıcı teslim eder.`,
  },
  {
    title: 'Sipariş ve fiyat',
    body: 'Ürünler, adetler, seçenekler, teslimat ücreti, indirim ve vergiler dahil toplam tutar sepette gösterilir. Onayladığın tutar siparişe yazılır. Sipariş, satıcı kabul edince kesinleşir. Satıcı 30 dakika içinde yanıt vermezse sipariş iptal olur. İleri tarihli siparişte restoran kapalıysa siparişini açılınca yanıtlar, 30 dakika restoranın açık olduğu süreden sayılır; seçtiğin saate 15 dakika kala hâlâ yanıt yoksa sipariş iptal olur.',
  },
  {
    title: 'Ödeme',
    body: 'Kapıda nakit, kapıda kart, restoran kabul ediyorsa kapıda yemek kartı veya açıksa online ödeme seçebilirsin. Online ödemede kart bilgilerin Evinden\'e değil ödeme kuruluşuna iletilir.',
  },
  {
    title: 'Teslimat',
    body: 'Teslimat, satıcı tarafından yazdığın adrese yapılır. Süreler tahminidir. Adresin doğru ve eksiksiz olmasından sen sorumlusun. Gelip almayı seçtiysen siparişi restorandan sen alırsın, teslimat ücreti ödemezsin. İleri bir saate verdiğin sipariş de satıcı kabul edince kesinleşir.',
  },
  {
    title: 'Cayma hakkı',
    body: 'Hazırlanan yemek çabuk bozulan bir ürün olduğu için teslimden sonra cayma hakkı kullanılamaz. Satıcı hazırlamaya başlamadan önce siparişini iptal edebilirsin.',
  },
  {
    title: 'Sorun olursa',
    body: 'Eksik, yanlış veya bozuk ürün için Siparişlerim ekranından iade talebi ya da Yardım ve destek ekranından talep açabilirsin. Tüketici hakem heyetine ve tüketici mahkemesine başvuru hakkın saklıdır.',
  },
  {
    title: 'Alerjen',
    body: 'Alerjen bilgisini satıcı girer. Alerjin varsa ürün sayfasındaki bilgiyi oku, emin değilsen siparişten önce satıcıya mesaj at.',
  },
];

export default function SalesTermsScreen() {
  const { colors: t } = useTheme();
  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar title="Satış sözleşmesi" subtitle={`Sürüm ${SALES_TERMS_VERSION}`} back />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[s.card, { backgroundColor: t.surface }]}>
          <Text style={[s.lead, { color: t.textSecondary }]}>
            Ön bilgilendirme ve mesafeli satış sözleşmesi. Siparişini onaylamadan önce oku.
          </Text>
          {SECTIONS.map(section => (
            <View key={section.title} style={s.section}>
              <Text style={[s.title, { color: t.heading }]}>{section.title}</Text>
              <Text style={[s.body, { color: t.text }]}>{section.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },
  card: { borderRadius: 16, padding: 16, gap: 16 },
  lead: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  section: { gap: 4 },
  title: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  body: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular },
});
