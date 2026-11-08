import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { openStreetMapUrl } from '@/lib/courier-format';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import type { Coords } from '@/lib/geo';

type Props = {
  line: string;
  /** Verilirse "Haritada aç" bağlantısı çıkar. Bayat ya da olmayan konumda verilmez. */
  courier?: Coords | null;
};

/** Harita çizilemediğinde kuryenin durumunu yazıyla söyler. */
export function CourierLocationCard({ line, courier }: Props) {
  const { colors: t } = useTheme();
  return (
    <View style={[s.card, { backgroundColor: t.surface }]}>
      <View style={[s.icon, { backgroundColor: t.brand }]}>
        <Ionicons name="bicycle-outline" size={22} color={t.onBrand} />
      </View>
      <View style={s.body}>
        <Text style={[s.line, { color: t.text }]} accessibilityLiveRegion="polite">{line}</Text>
        {courier ? (
          <Pressable
            style={s.link}
            onPress={() => Linking.openURL(openStreetMapUrl(courier.latitude, courier.longitude))}
            accessibilityRole="link"
            accessibilityLabel="Kurye konumunu haritada aç"
          >
            <Text style={[s.linkText, { color: t.text }]}>Haritada aç</Text>
            <Ionicons name="open-outline" size={15} color={t.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  line: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  linkText: { fontSize: 14, fontFamily: fonts.semibold, textDecorationLine: 'underline' },
});
