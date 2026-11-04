import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { LogoMark } from '@/components/shared/Logo';
import { useTheme } from '@/lib/theme-context';

type Props = {
  /** Satıcının yüklediği fotoğraf */
  imageUrl?: string | null;
  /** Uygulamayla gelen tanıtım görseli */
  localImage?: ImageSourcePropType;
  /** Kare görselin kenarı. Geniş görsellerde `height` ve `style` ile birlikte kullanılır. */
  size?: number;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ImageStyle & ViewStyle>;
};

/**
 * Fotoğraf varsa onu gösterir. Yoksa marka işaretli sade bir zemin çizer:
 * satıcının gerçek ürünü gibi görünecek hazır bir yemek fotoğrafı konmaz.
 */
export default function FoodImage({ imageUrl, localImage, size = 64, height, borderRadius = 16, style }: Props) {
  const { colors: t } = useTheme();
  const [failed, setFailed] = useState(false);
  const h = height ?? size;

  useEffect(() => setFailed(false), [imageUrl]);

  const source = imageUrl && !failed ? { uri: imageUrl } : localImage;

  if (source) {
    return (
      <Image
        source={source}
        onError={() => setFailed(true)}
        style={[{ width: size, height: h, borderRadius }, style as StyleProp<ImageStyle>]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={[styles.placeholder, { width: size, height: h, borderRadius, backgroundColor: t.mint }, style as StyleProp<ViewStyle>]}
    >
      <LogoMark
        size={Math.max(16, Math.min(Math.round(h * 0.42), 72))}
        tone="onLight"
        steamColor={t.mint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
