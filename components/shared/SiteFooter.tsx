import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BrandWord, LogoMark } from '@/components/shared/Logo';
import { PLATFORM_LEGAL, SITE_URL } from '@/constants/business';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type LinkItem = { label: string; route?: string; url?: string };

const COLUMNS: { title: string; links: LinkItem[] }[] = [
  {
    title: 'Afiyetli',
    links: [
      { label: 'Tanıtım', url: `${SITE_URL}/tanitim/` },
      { label: 'Yardım', route: '/(customer)/help' },
      { label: 'Bize ulaş', url: `mailto:${PLATFORM_LEGAL.email}` },
    ],
  },
  {
    title: 'İş ortaklığı',
    links: [{ label: 'Restoranını ekle', route: '/(customer)/seller-apply' }],
  },
  {
    title: 'Yasal',
    links: [
      { label: 'Kullanım koşulları', route: '/(customer)/terms' },
      { label: 'Gizlilik politikası', route: '/(customer)/privacy' },
      { label: 'Satış sözleşmesi', route: '/(customer)/sales-terms' },
      { label: 'Hesap silme', url: `${SITE_URL}/hesap-silme/` },
    ],
  },
];

/** Masaüstü ana sayfanın alt bölümü. Telefonda bu bağlantılar Profil ekranındadır. */
export function SiteFooter() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const open = (link: LinkItem) => {
    if (link.route) router.push(link.route as any);
    else if (link.url) Linking.openURL(link.url).catch(() => undefined);
  };

  return (
    <View style={[s.wrap, { borderTopColor: t.divider }]}>
      <View style={s.columns}>
        <View style={s.brand}>
          <View style={s.logo}>
            <LogoMark size={26} tone="onLight" />
            <Text style={{ color: t.heading }}><BrandWord fontSize={20} /></Text>
          </View>
          <Text style={[s.slogan, { color: t.textSecondary }]}>Afiyetli olsun.</Text>
        </View>
        {COLUMNS.map(col => (
          <View key={col.title} style={s.column}>
            <Text style={[s.title, { color: t.heading }]}>{col.title}</Text>
            {col.links.map(link => (
              <Pressable key={link.label} style={s.link} onPress={() => open(link)} accessibilityRole="link">
                <Text style={[s.linkText, { color: t.textSecondary }]}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <Text style={[s.copy, { color: t.textMuted }]}>
        © {new Date().getFullYear()} {PLATFORM_LEGAL.title || PLATFORM_LEGAL.name}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 40, paddingTop: 28, borderTopWidth: 1 },
  columns: { flexDirection: 'row', gap: 32, flexWrap: 'wrap' },
  brand: { flex: 1, minWidth: 200, gap: 8 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slogan: { fontSize: 14, fontFamily: fonts.regular },
  column: { minWidth: 160, gap: 2 },
  title: { fontSize: 14, fontFamily: fonts.bold, marginBottom: 6 },
  link: { minHeight: 32, justifyContent: 'center' },
  linkText: { fontSize: 14, fontFamily: fonts.regular },
  copy: { fontSize: 12, fontFamily: fonts.regular, marginTop: 20 },
});
