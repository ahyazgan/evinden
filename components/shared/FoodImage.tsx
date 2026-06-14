import { Image, StyleSheet, Text, View, type ImageSourcePropType, type ImageStyle, type ViewStyle } from 'react-native';

type Props = {
  /** Remote URL */
  imageUrl?: string | null;
  /** Local require() asset */
  localImage?: ImageSourcePropType;
  emoji: string;
  bg: string;
  size: number;
  borderRadius?: number;
  fontSize?: number;
  style?: ViewStyle & ImageStyle;
};

/**
 * Displays a real image if available (remote URL or local asset),
 * otherwise shows emoji on colored background.
 */
export default function FoodImage({ imageUrl, localImage, emoji, bg, size, borderRadius = 16, fontSize, style }: Props) {
  const emojiSize = fontSize ?? size * 0.5;

  // Remote URL takes priority
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[{ width: size, height: size, borderRadius }, style]}
        resizeMode="cover"
      />
    );
  }

  // Local asset
  if (localImage) {
    return (
      <Image
        source={localImage}
        style={[{ width: size, height: size, borderRadius }, style]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius, backgroundColor: bg }, style]}>
      <Text style={{ fontSize: emojiSize }}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
