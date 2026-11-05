import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';
import { LOOP_MS, SMILE_LENGTH, logoFrame } from '@/lib/logo-animation';
import { useTheme } from '@/lib/theme-context';

// Gülen kase. scripts/generate-logo-assets.js aynı şekilden simge üretir.
const SMILE = 'M7 30C13 43 23 50 32 50S51 43 57 30';

type Tone = 'onLight' | 'onBrand';

const TONES: Record<Tone, { mark: string; word: string }> = {
  onLight: { mark: colors.primary, word: colors.ink },
  onBrand: { mark: colors.lime, word: '#FFFFFF' },
};

/** Gülen kase işareti: bir nokta ve altında gülüş eğrisi. */
export function LogoMark({ size = 48, tone = 'onLight' }: { size?: number; tone?: Tone }) {
  const { mark } = TONES[tone];
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Circle cx={32} cy={17} r={5.5} fill={mark} />
      <Path d={SMILE} fill="none" stroke={mark} strokeWidth={7} strokeLinecap="round" />
    </Svg>
  );
}

const FRAME_MS = 33;

/** Gülen kase hareketli: gülüş soldan sağa çizilir, nokta zıplayarak yerine oturur. */
export function AnimatedLogoMark({ size = 56, color }: { size?: number; color: string }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setReduceMotion(on); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const start = Date.now();
    const timer = setInterval(() => setProgress(((Date.now() - start) % LOOP_MS) / LOOP_MS), FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  // Hareket azaltma açıksa logo durağan ve tam görünür.
  const frame = reduceMotion ? { opacity: 1, dashOffset: 0, dotY: 17 } : logoFrame(progress);

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Circle cx={32} cy={frame.dotY} r={5.5} fill={color} opacity={frame.opacity} />
      <Path
        d={SMILE}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={[SMILE_LENGTH, SMILE_LENGTH]}
        strokeDashoffset={frame.dashOffset}
        opacity={frame.opacity}
      />
    </Svg>
  );
}

/** Sayfa içi bekleme göstergesi. Düğme içindeki küçük halkaların yerine geçmez. */
export function LogoLoader({ size = 56 }: { size?: number }) {
  const { colors: t } = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Yükleniyor" style={styles.loader}>
      <AnimatedLogoMark size={size} color={t.primary} />
    </View>
  );
}

/**
 * "afiyetli" yazısının harfleri. Bu yazı tipinde f'nin kancası i'nin noktasına değiyor ve ad
 * "afıyetli" gibi okunuyor, bu yüzden f'den sonra biraz boşluk bırakılır. Text içinde kullanılır.
 */
export function BrandWord({ fontSize }: { fontSize: number }) {
  return (
    <>
      a<Text style={{ letterSpacing: fontSize * 0.015 }}>f</Text>iyetli
    </>
  );
}

/** İşaret ve küçük harfli "afiyetli" yazısı */
export function Logo({
  size = 56,
  tone = 'onLight',
  inline = false,
  animated = false,
}: {
  size?: number;
  tone?: Tone;
  /** Yazı işaretin yanında durur (üst alan) */
  inline?: boolean;
  /** İşaret hareket eder: açılış ekranı */
  animated?: boolean;
}) {
  const fontSize = inline ? Math.round(size * 0.96) : Math.round(size * 0.58);
  return (
    <View style={[styles.wrap, inline && styles.inline]} accessible accessibilityRole="image" accessibilityLabel="Afiyetli">
      {animated ? <AnimatedLogoMark size={size} color={TONES[tone].mark} /> : <LogoMark size={size} tone={tone} />}
      <Text
        style={[
          styles.word,
          { fontSize, lineHeight: fontSize * 1.2, letterSpacing: fontSize * -0.03, color: TONES[tone].word },
        ]}
      >
        <BrandWord fontSize={fontSize} />
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', alignSelf: 'flex-start' },
  word: { fontFamily: fonts.display },
  loader: { alignItems: 'center', justifyContent: 'center' },
});
