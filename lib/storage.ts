import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export type StorageBucket = 'food-images' | 'avatars';

/**
 * Opens the image library, lets the user pick a photo,
 * uploads it to the given Supabase Storage bucket, and returns the public URL.
 *
 * @param bucket  - 'food-images' or 'avatars'
 * @param path    - File path inside the bucket, e.g. 'sellers/demo-1/cover'
 * @param options - Optional overrides for the image picker
 * @returns       Public URL string, or null if the user cancelled
 */
export async function pickAndUploadImage(
  bucket: StorageBucket,
  path: string,
  options?: Pick<ImagePicker.ImagePickerOptions, 'aspect' | 'quality'>,
): Promise<string | null> {
  // Request permission if not already granted
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Fotoğraf galerisine erişim izni gereklidir.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    aspect: options?.aspect ?? [1, 1],
    quality: options?.quality ?? 0.8,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const uri = result.assets[0].uri;
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filePath = `${path}.${ext}`;

  // Convert URI to blob (works on both native and web)
  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from(bucket).upload(filePath, blob, {
    contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    upsert: true,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Deletes a file from the given bucket.
 */
export async function deleteImage(bucket: StorageBucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

/**
 * Returns the public URL for an existing file without uploading.
 */
export function getPublicUrl(bucket: StorageBucket, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
