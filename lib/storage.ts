import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { imageFileType, uniqueUploadPath } from './upload-path';

export type StorageBucket = 'food-images' | 'avatars' | 'seller-documents';

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

  const { uri, mimeType } = result.assets[0];
  const { ext, contentType } = imageFileType(uri, mimeType);
  const filePath = uniqueUploadPath(path, ext);

  // Convert URI to blob (works on both native and web)
  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from(bucket).upload(filePath, blob, {
    contentType,
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Picks a photo of a business document and uploads it to the private documents bucket.
 * Cropping is off so the whole document stays readable; each upload gets a new path.
 *
 * @returns Storage path (not a URL, the bucket is private), or null if the user cancelled
 */
export async function pickAndUploadSellerDocument(userId: string, docType: string): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Fotoğraf galerisine erişim izni gereklidir.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
  if (result.canceled || result.assets.length === 0) return null;

  const { uri, mimeType } = result.assets[0];
  const { ext, contentType } = imageFileType(uri, mimeType);
  const filePath = `${userId}/${docType}-${Date.now()}.${ext}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from('seller-documents').upload(filePath, blob, { contentType });
  if (error) throw new Error(error.message);
  return filePath;
}

/**
 * Returns a short-lived link for a document in the private bucket.
 */
export async function getSellerDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('seller-documents').createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Deletes a file from the given bucket.
 */
export async function deleteImage(bucket: StorageBucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

/**
 * Deletes every file directly under a folder in the given bucket.
 */
export async function deleteFolder(bucket: StorageBucket, folder: string): Promise<void> {
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (error) throw new Error(error.message);
  const paths = (data ?? []).map(file => `${folder}/${file.name}`);
  if (paths.length === 0) return;
  const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
  if (removeError) throw new Error(removeError.message);
}

/**
 * Returns the public URL for an existing file without uploading.
 */
export function getPublicUrl(bucket: StorageBucket, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
