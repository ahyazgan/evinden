import { Platform } from 'react-native';

/**
 * Webde public/index.html içindeki açılış görüntüsünü kaldırır. Uygulama kendi açılış ekranını ya da
 * hata ekranını çizince çağrılır; çağrılmazsa görüntü her şeyin üstünde kalır.
 */
export function hideBootSplash(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.getElementById('boot-splash')?.remove();
}
