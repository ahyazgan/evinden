import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Logo } from '@/components/shared/Logo';
import { Button } from '@/components/ui/Button';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

export default function NotFound() {
  const router = useRouter();
  const { colors: t } = useTheme();
  return (
    <View style={[s.wrap, { backgroundColor: t.brand }]}>
      <Logo size={72} tone="onBrand" />
      <Text accessibilityRole="header" style={[s.title, { color: t.accent }]}>Bu sayfa menüde yok</Text>
      <Text style={[s.body, { color: t.onBrand }]}>Bağlantı eskimiş olabilir. Ana sayfadan devam edebilirsin.</Text>
      <View style={s.action}>
        <Button label="Ana sayfaya dön" variant="accent" size="lg" onPress={() => router.replace('/')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  action: { width: '100%', maxWidth: 360 },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, textAlign: 'center', marginTop: 12 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, textAlign: 'center', maxWidth: 360, marginBottom: 8 },
});
