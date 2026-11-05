import * as Linking from 'expo-linking';
import { recoveryCodeFromUrl } from './recovery-tokens';

// Uygulama arka plandayken gelen bağlantı, ekran açılmadan önce düşer; bu yüzden en baştan dinlenir.
let pendingUrl: string | null = null;

Linking.addEventListener('url', ({ url }) => {
  if (recoveryCodeFromUrl(url)) pendingUrl = url;
});

/** Bekleyen şifre yenileme bağlantısını bir kez verir. */
export function takePendingRecoveryUrl(): string | null {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
}
