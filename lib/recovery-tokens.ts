/** E-postadaki şifre yenileme bağlantısından oturum bilgilerini okur (adresin # sonrasında olur). */
export function recoveryTokensFromUrl(url: string | null | undefined): { access_token: string; refresh_token: string } | null {
  if (!url) return null;
  const hash = url.split('#')[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get('type') !== 'recovery') return null;
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}
