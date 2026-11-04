import type { AuthError } from '@supabase/supabase-js';

export function mapAuthErrorToTurkish(error: AuthError | Error): string {
  const code = 'code' in error ? (error as AuthError).code : '';
  const msg = (error.message ?? '').toLowerCase();

  if (code === 'otp_expired' || msg.includes('expired')) {
    return 'Doğrulama kodunun süresi doldu. Yeni kod iste.';
  }
  if (
    code === 'invalid_credentials' ||
    msg.includes('invalid') ||
    msg.includes('token') ||
    msg.includes('otp') ||
    msg.includes('wrong')
  ) {
    return 'Girdiğin kod hatalı veya geçersiz. Tekrar dene.';
  }
  if (msg.includes('rate') || msg.includes('too many')) {
    return 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Bağlantı hatası. İnternetini kontrol edip tekrar dene.';
  }

  return error.message || 'Bir hata oluştu. Tekrar dene.';
}
