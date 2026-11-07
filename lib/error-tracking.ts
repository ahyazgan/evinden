/**
 * Hata takibi. EXPO_PUBLIC_SENTRY_DSN tanımlıysa ve uygulama geliştirme modunda değilse Sentry'ye gönderir,
 * aksi halde konsola yazar. Kurulum adımları: docs/CANLIYA-ALMA.md
 *
 * Sentry kitaplığı büyük (webde ~2 MB kaynak). Ayrı parça olarak sonradan yüklenir, ilk açılışı bekletmez.
 * Yüklenene kadar gelen hatalar kuyrukta bekler ve yüklenince gönderilir.
 */
import { Platform } from 'react-native';

type SentryModule = typeof import('@sentry/react-native');

let sentry: SentryModule | null = null;
let starting = false;
let pendingUser: { id: string } | null | undefined;
const pending: ((s: SentryModule) => void)[] = [];
const MAX_PENDING = 20;

/** Webde ilk çizimden sonra, boşta kalınca yüklenir; telefonda hemen. */
const WEB_DELAY_MS = 2500;

function whenReady(fn: (s: SentryModule) => void): void {
  if (sentry) fn(sentry);
  else if (starting && pending.length < MAX_PENDING) pending.push(fn);
}

async function load(dsn: string): Promise<void> {
  try {
    const mod = await import('@sentry/react-native');
    mod.init({
      dsn,
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
      // Adres, telefon ve mesaj içerikleri hata kaydına girmesin.
      sendDefaultPii: false,
      // İstek adreslerindeki sorgu parçası kişisel veri taşıyabilir.
      beforeBreadcrumb: breadcrumb => {
        const url = breadcrumb.data?.url;
        if (typeof url === 'string') breadcrumb.data = { ...breadcrumb.data, url: url.split('?')[0] };
        return breadcrumb;
      },
    });
    sentry = mod;
    if (pendingUser !== undefined) mod.setUser(pendingUser);
    pending.splice(0).forEach(fn => fn(mod));
  } catch (e) {
    starting = false;
    pending.length = 0;
    console.error('[error-tracking] Sentry yüklenemedi', e);
  }
}

/** Sentry'yi başlat */
export function initErrorTracking(dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN): void {
  if (starting || __DEV__ || !dsn?.startsWith('https://')) return;
  starting = true;
  if (Platform.OS === 'web') setTimeout(() => void load(dsn), WEB_DELAY_MS);
  else void load(dsn);
}

/** Hata yakala ve raporla */
export function captureException(error: unknown, context?: Record<string, string>): void {
  if (!starting) {
    console.error('[error-tracking]', error, context);
    return;
  }
  whenReady(s => s.captureException(error, context ? { extra: context } : undefined));
}

/** Mesaj gönder */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!starting) {
    console.log(`[error-tracking] [${level}]`, message);
    return;
  }
  whenReady(s => s.captureMessage(message, level));
}

/** Kullanıcıyı yalnızca kimliğiyle işaretle: ad ve e-posta hata kaydına girmez. */
export function setUser(user: { id: string } | null): void {
  if (!starting) return;
  if (sentry) sentry.setUser(user);
  else pendingUser = user;
}

/** Breadcrumb ekle */
export function addBreadcrumb(message: string, category?: string, data?: Record<string, string>): void {
  whenReady(s => s.addBreadcrumb({ message, category, data, level: 'info' }));
}
