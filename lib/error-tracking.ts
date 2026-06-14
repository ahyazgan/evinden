/**
 * Error tracking wrapper.
 * Uses @sentry/react-native if installed, otherwise falls back to console.
 * Install: npx expo install @sentry/react-native
 * Then set SENTRY_DSN in your environment.
 */

let SentryModule: any = null;
let initialized = false;

/** Sentry'yi başlat */
export function initErrorTracking(dsn?: string): void {
  if (initialized) return;
  try {
    SentryModule = require('@sentry/react-native');
    SentryModule.init({
      dsn: dsn || process.env.EXPO_PUBLIC_SENTRY_DSN || '',
      debug: __DEV__,
      enabled: !__DEV__, // Only in production
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
    });
    initialized = true;
    console.log('[error-tracking] Sentry initialized');
  } catch {
    console.log('[error-tracking] Sentry not installed, using console fallback');
    initialized = true;
  }
}

/** Hata yakala ve raporla */
export function captureException(error: unknown, context?: Record<string, string>): void {
  if (SentryModule) {
    if (context) {
      SentryModule.withScope((scope: any) => {
        Object.entries(context).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
        SentryModule.captureException(error);
      });
    } else {
      SentryModule.captureException(error);
    }
  } else {
    console.error('[error-tracking]', error, context);
  }
}

/** Mesaj gönder */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (SentryModule) {
    SentryModule.captureMessage(message, level);
  } else {
    console.log(`[error-tracking] [${level}]`, message);
  }
}

/** Kullanıcı bilgisi ayarla */
export function setUser(user: { id: string; email?: string; name?: string } | null): void {
  if (SentryModule) {
    SentryModule.setUser(user);
  }
}

/** Breadcrumb ekle */
export function addBreadcrumb(message: string, category?: string, data?: Record<string, string>): void {
  if (SentryModule) {
    SentryModule.addBreadcrumb({ message, category, data, level: 'info' });
  }
}
