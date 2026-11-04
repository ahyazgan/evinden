/**
 * Hata takibi. EXPO_PUBLIC_SENTRY_DSN tanımlıysa ve uygulama geliştirme modunda değilse Sentry'ye gönderir,
 * aksi halde konsola yazar. Kurulum adımları: docs/CANLIYA-ALMA.md
 */
import * as Sentry from '@sentry/react-native';

let enabled = false;

/** Sentry'yi başlat */
export function initErrorTracking(dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN): void {
  if (enabled || __DEV__ || !dsn?.startsWith('https://')) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    // Adres, telefon ve mesaj içerikleri hata kaydına girmesin.
    sendDefaultPii: false,
  });
  enabled = true;
}

/** Hata yakala ve raporla */
export function captureException(error: unknown, context?: Record<string, string>): void {
  if (!enabled) {
    console.error('[error-tracking]', error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Mesaj gönder */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!enabled) {
    console.log(`[error-tracking] [${level}]`, message);
    return;
  }
  Sentry.captureMessage(message, level);
}

/** Kullanıcıyı yalnızca kimliğiyle işaretle: ad ve e-posta hata kaydına girmez. */
export function setUser(user: { id: string } | null): void {
  if (enabled) Sentry.setUser(user ? { id: user.id } : null);
}

/** Breadcrumb ekle */
export function addBreadcrumb(message: string, category?: string, data?: Record<string, string>): void {
  if (enabled) Sentry.addBreadcrumb({ message, category, data, level: 'info' });
}
