// Kullanım ölçümünün saf kısmı: olay listesi, kuyruk ve huni hesabı. Ağ ve React Native bağımlılığı yok.
// Kuralların aynısı veritabanında: 035 analytics_events kısıtları ve analytics_props_valid (son hâli 062). Test karşılaştırır.

export const ANALYTICS_EVENTS = [
  'app_open',
  'view_home',
  'view_restaurant',
  'add_to_cart',
  'view_cart',
  'start_checkout',
  'order_placed',
  'order_failed',
  'payment_online_started',
  'search',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** Adres, telefon, mesaj ve arama metni için anahtar yok; arama yalnızca uzunluk olarak sayılır. */
export const ANALYTICS_PROP_KEYS = ['seller_id', 'method', 'fulfillment', 'scheduled', 'mode', 'length', 'reason', 'source'] as const;

export type AnalyticsProps = Partial<Record<(typeof ANALYTICS_PROP_KEYS)[number], string | number | boolean>>;

export type QueuedEvent = { session_id: string; name: AnalyticsEventName; props: AnalyticsProps };

export const MAX_BATCH = 20;
const MAX_QUEUE = 100;
const FLUSH_DELAY_MS = 5000;
/** Huninin kaybedilemeyecek adımları beklemez: sayfa hemen ardından yenilenebilir. */
const FLUSH_NOW: ReadonlySet<AnalyticsEventName> = new Set<AnalyticsEventName>(['start_checkout', 'order_placed', 'order_failed']);
const SAFE_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

/** Uygulama her açıldığında yenisi üretilir, cihazda saklanmaz. Hesaba bağlı değildir. */
export function newSessionId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

/** Sunucunun kabul etmeyeceği alanlar hiç gönderilmez. */
export function cleanProps(props?: AnalyticsProps | null): AnalyticsProps {
  const clean: AnalyticsProps = {};
  if (!props) return clean;
  for (const key of ANALYTICS_PROP_KEYS) {
    const value = props[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value;
    else if (typeof value === 'string' && SAFE_VALUE.test(value)) clean[key] = value;
  }
  return clean;
}

type TimerApi = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/**
 * Ateşle ve unut: `track` hiçbir durumda hata fırlatmaz, ekranı bekletmez. Olaylar partiler halinde gider.
 * Gönderilemeyen parti kuyruğa döner ve sonraki olayla yeniden denenir; kuyruk dolarsa en eskisi düşer.
 * Tekrar gönderim zarar vermez, huni oturumları tekil sayar.
 */
export function createEventQueue(options: {
  sessionId: string;
  send: (batch: QueuedEvent[]) => Promise<unknown>;
  flushDelayMs?: number;
  timer?: TimerApi;
}) {
  const { sessionId, send, flushDelayMs = FLUSH_DELAY_MS } = options;
  const timer: TimerApi = options.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let queue: QueuedEvent[] = [];
  let handle: unknown = null;
  let sending = false;

  const flush = async (): Promise<void> => {
    if (handle !== null) {
      timer.clear(handle);
      handle = null;
    }
    if (sending || queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    sending = true;
    let sent = true;
    try {
      await send(batch);
    } catch {
      sent = false;
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
    }
    sending = false;
    if (sent && queue.length > 0) await flush();
  };

  const safeFlush = () => flush().catch(() => undefined);

  return {
    track(name: AnalyticsEventName, props?: AnalyticsProps | null): void {
      try {
        queue.push({ session_id: sessionId, name, props: cleanProps(props) });
        if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
        if (queue.length >= MAX_BATCH || FLUSH_NOW.has(name)) {
          void safeFlush();
        } else if (handle === null) {
          handle = timer.set(() => { handle = null; void safeFlush(); }, flushDelayMs);
        }
      } catch {
        // Ölçüm uygulamayı hiçbir zaman etkilemez.
      }
    },
    flush: safeFlush,
    pending: () => queue.length,
  };
}

// ─── Huni ─────────────────────────────────────────────────────────────────────

export const FUNNEL_STEPS: { name: AnalyticsEventName; label: string }[] = [
  { name: 'app_open', label: 'Uygulamayı açtı' },
  { name: 'view_home', label: 'Ana sayfayı gördü' },
  { name: 'view_restaurant', label: 'Restoran açtı' },
  { name: 'add_to_cart', label: 'Sepete ekledi' },
  { name: 'view_cart', label: 'Sepeti açtı' },
  { name: 'start_checkout', label: 'Siparişi onayladı' },
  { name: 'order_placed', label: 'Sipariş verdi' },
];

/** Huninin adımı olmayan, yanında gösterilen sayılar */
export const FUNNEL_EXTRAS: { name: AnalyticsEventName; label: string }[] = [
  { name: 'search', label: 'Arama yaptı' },
  { name: 'payment_online_started', label: 'Online ödemeye geçti' },
  { name: 'order_failed', label: 'Sipariş veremedi' },
];

export type FunnelRow = { step: string; sessions: number | string };

export type FunnelStep = {
  name: AnalyticsEventName;
  label: string;
  sessions: number;
  /** En kalabalık adıma göre çubuk genişliği, 0-100 */
  widthPercent: number;
  /** Bir önceki adımdan kaybedilen oturum yüzdesi. İlk adımda ve önceki adım boşsa null. */
  dropOffPercent: number | null;
};

/** Adımlar sıra denetlemeden sayıldığı için sonraki adım büyük çıkabilir: kayıp sıfırın altına inmez. */
export function funnelSteps(rows: readonly FunnelRow[]): FunnelStep[] {
  const count = (name: string) => Number(rows.find(r => r.step === name)?.sessions ?? 0);
  const widest = Math.max(0, ...FUNNEL_STEPS.map(s => count(s.name)));
  return FUNNEL_STEPS.map((s, i) => {
    const sessions = count(s.name);
    const previous = i === 0 ? 0 : count(FUNNEL_STEPS[i - 1].name);
    return {
      ...s,
      sessions,
      widthPercent: widest === 0 ? 0 : Math.round((sessions / widest) * 100),
      dropOffPercent: previous === 0 ? null : Math.max(0, Math.round((1 - sessions / previous) * 100)),
    };
  });
}

/** Hiç oturum yoksa ekran sıfırlı huni değil, boş durum gösterir. */
export function funnelIsEmpty(rows: readonly FunnelRow[]): boolean {
  return rows.every(r => Number(r.sessions) === 0);
}
