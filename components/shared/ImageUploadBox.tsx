import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { pickAndUploadImage, type StorageBucket } from '@/lib/storage';

type Props = {
  /** Current image URL (from DB) */
  imageUrl: string | null;
  /** Görsel yokken zemin */
  fallbackBg?: string;
  /** Supabase storage bucket */
  bucket: StorageBucket;
  /** Path inside the bucket (without extension) */
  path: string;
  /** Aspect ratio for the picker */
  aspect?: [number, number];
  /** Size of the box */
  size?: number;
  /** Geniş görseller için genişlik; verilmezse kare */
  width?: number | '100%';
  /** Border radius */
  borderRadius?: number;
  /** Called with the new public URL after upload */
  onUploaded: (url: string) => void;
};

export default function ImageUploadBox({
  imageUrl,
  fallbackBg = colors.background,
  bucket,
  path,
  aspect = [1, 1],
  size = 88,
  width,
  borderRadius = 22,
  onUploaded,
}: Props) {
  const [uploading, setUploading] = useState(false);

  const handlePress = async () => {
    try {
      setUploading(true);
      const url = await pickAndUploadImage(bucket, path, { aspect });
      if (url) onUploaded(url);
    } catch (e: any) {
      Alert.alert('Yükleme Hatası', e.message ?? 'Fotoğraf yüklenemedi.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Pressable onPress={handlePress} disabled={uploading} style={width ? { width } : undefined} accessibilityRole="button" accessibilityLabel="Fotoğraf yükle">
      <View style={[styles.box, { width: width ?? size, height: size, borderRadius, backgroundColor: fallbackBg }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={[styles.image, { width: width ?? size, height: size, borderRadius }]} />
        ) : (
          <Ionicons name="image-outline" size={28} color={colors.muted} />
        )}
        {uploading && (
          <View style={[styles.overlay, { borderRadius }]}>
            <ActivityIndicator color="#fff" size="small" />
          </View>
        )}
        <View style={styles.badge}>
          <Ionicons name="camera" size={12} color="#fff" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'cover',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
});
