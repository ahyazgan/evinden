/** Girişten dönen adresteki tek kullanımlık kodu okur. Kod yalnızca isteği başlatan cihazda oturuma çevrilebilir. */
export function authCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  return new URLSearchParams(query).get('code') || null;
}

/** E-postadaki şifre yenileme bağlantısının kodu. Başka adresteki kod kabul edilmez. */
export function recoveryCodeFromUrl(url: string | null | undefined): string | null {
  if (!url || !/(^|[/:])reset-password\/?(\?|$)/.test(url.split('#')[0])) return null;
  return authCodeFromUrl(url);
}
