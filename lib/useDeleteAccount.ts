import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from './auth-context';
import { deleteUserAccount } from './db';
import { deleteFolder } from './storage';

const KEPT_LOCAL_KEYS = new Set(['@evinden_theme_mode']);

/** Hesap sunucuda çoktan silindi: fotoğraf temizliği başarısız olsa da akış durmaz. */
async function removeUploadedPhotos(userId: string, sellerId: string | null) {
  await Promise.allSettled([
    deleteFolder('avatars', `users/${userId}`),
    ...(sellerId
      ? [deleteFolder('food-images', `sellers/${sellerId}`), deleteFolder('food-images', `menu/${sellerId}`)]
      : []),
  ]);
}

/** Aynı cihazda açılacak başka bir hesap önceki kullanıcının verisini görmesin. */
async function clearLocalUserData() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter(k => k.startsWith('@evinden_') && !KEPT_LOCAL_KEYS.has(k)));
  } catch {}
}

/** Onay sorup hesabı kalıcı olarak silen işlevi döndürür. */
export function useDeleteAccount() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const inProgress = useRef(false);

  const deleteAccount = useCallback(async () => {
    if (!profile || inProgress.current) return;
    inProgress.current = true;
    try {
      const sellerId = await deleteUserAccount();
      await removeUploadedPhotos(profile.id, sellerId);
      await clearLocalUserData();
      signOut();
      router.replace('/(auth)/login' as any);
    } catch (e: any) {
      // Sunucunun açıkladığı engel (devam eden sipariş gibi) olduğu gibi gösterilir.
      Alert.alert('Hesap silinemedi', e?.code === '55000' ? e.message : 'Lütfen tekrar deneyin.');
    } finally {
      inProgress.current = false;
    }
  }, [profile, signOut, router]);

  return useCallback(() => {
    Alert.alert(
      'Hesabı Sil',
      'Hesabınız ve kişisel verileriniz kalıcı olarak silinecek. Geçmiş siparişler, kimlik ve adres bilgileriniz çıkarılarak kayıtlarda kalır. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Hesabımı Sil', style: 'destructive', onPress: deleteAccount },
      ],
    );
  }, [deleteAccount]);
}
