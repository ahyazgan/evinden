import type { AuthError } from '@supabase/supabase-js';

export function mapAuthErrorToTurkish(error: AuthError | Error): string {
  const code = 'code' in error ? (error as AuthError).code : '';
  const msg = (error.message ?? '').toLowerCase();

  if (code === 'otp_expired' || msg.includes('expired')) {
    return 'Doğrulama kodunun süresi doldu. Yeni kod isteyin.';
  }
  if (
    code === 'invalid_credentials' ||
    msg.includes('invalid') ||
    msg.includes('token') ||
    msg.includes('otp') ||
    msg.includes('wrong')
  ) {
    return 'Girdiğiniz kod hatalı veya geçersiz. Lütfen tekrar deneyin.';
  }
  if (msg.includes('rate') || msg.includes('too many')) {
    return 'Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin.';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Bağlantı hatası. İnternetinizi kontrol edip tekrar deneyin.';
  }

  return error.message || 'Bir hata oluştu. Lütfen tekrar deneyin.';
}
