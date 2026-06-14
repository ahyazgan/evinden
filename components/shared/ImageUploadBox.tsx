import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { pickAndUploadImage, type StorageBucket } from '@/lib/storage';

type Props = {
  /** Current image URL (from DB) */
  imageUrl: string | null;
  /** Fallback emoji + bg when no image */
  fallbackEmoji?: string;
  fallbackBg?: string;
  /** Supabase storage bucket */
  bucket: StorageBucket;
  /** Path inside the bucket (without extension) */
  path: string;
  /** Aspect ratio for the picker */
  aspect?: [number, number];
  /** Size of the box */
  size?: number;
  /** Border radius */
  borderRadius?: number;
  /** Called with the new public URL after upload */
  onUploaded: (url: string) => void;
};

export default function ImageUploadBox({
  imageUrl,
  fallbackEmoji = '📷',
  fallbackBg = '#F5F0EA',
  bucket,
  path,
  aspect = [1, 1],
  size = 88,
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
    <Pressable onPress={handlePress} disabled={uploading}>
      <View style={[styles.box, { width: size, height: size, borderRadius, backgroundColor: fallbackBg }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={[styles.image, { width: size, height: size, borderRadius }]} />
        ) : (
          <Text style={styles.emoji}>{fallbackEmoji}</Text>
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
    borderWidth: 2,
    borderColor: '#EDE8E2',
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'cover',
  },
  emoji: {
    fontSize: 40,
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
