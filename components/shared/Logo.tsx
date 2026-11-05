import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';

const ARCH = 'M8 60V32a24 24 0 0 1 48 0v28Z';
const BOWL = 'M16 40h32a16 16 0 0 1-32 0Z';
const STEAM = 'M32 12c-4.500 4 4.500 8 0 12-1.200 1.200-1.200 3 0 5';

type Tone = 'onLight' | 'onBrand';

const TONES: Record<Tone, { arch: string; bowl: string; word: string }> = {
  onLight: { arch: colors.primary, bowl: colors.lime, word: colors.ink },
  onBrand: { arch: '#FFFFFF', bowl: colors.lime, word: '#FFFFFF' },
};

/** Kemerli kapı içinde dumanı tüten kase. 24 pikselin altında duman çizilmez. */
export function LogoMark({
  size = 48,
  tone = 'onLight',
  steamColor,
}: {
  size?: number;
  tone?: Tone;
  /** Dumanın rengi: işaretin durduğu zemin */
  steamColor?: string;
}) {
  const t = TONES[tone];
  const steam = steamColor ?? (tone === 'onBrand' ? colors.primary : '#FFFFFF');
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d={ARCH} fill={t.arch} />
      <Path d={BOWL} fill={t.bowl} />
      {size >= 24 ? (
        <Path d={STEAM} fill="none" stroke={steam} strokeWidth={4.5} strokeLinecap="round" />
      ) : null}
    </Svg>
  );
}

/** İşaret ve küçük harfli "afiyetli" yazısı */
export function Logo({
  size = 56,
  tone = 'onLight',
  steamColor,
  inline = false,
}: {
  size?: number;
  tone?: Tone;
  steamColor?: string;
  /** Yazı işaretin yanında durur (üst alan) */
  inline?: boolean;
}) {
  const fontSize = inline ? Math.round(size * 0.96) : Math.round(size * 0.58);
  return (
    <View style={[styles.wrap, inline && styles.inline]} accessible accessibilityRole="image" accessibilityLabel="Afiyetli">
      <LogoMark size={size} tone={tone} steamColor={steamColor} />
      <Text
        style={[
          styles.word,
          { fontSize, lineHeight: fontSize * 1.2, letterSpacing: fontSize * -0.03, color: TONES[tone].word },
        ]}
      >
        afiyetli
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', alignSelf: 'flex-start' },
  word: { fontFamily: fonts.display },
});
