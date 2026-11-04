import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import { geocodeAddress } from './delivery-location';
import { supabase } from './supabase';
import { isLocationStale, parseCourierLocation, type CourierLocation } from './courier-format';
import type { Coords } from './geo';

const WATCH_INTERVAL_MS = 15000;
const WATCH_DISTANCE_M = 30;
/** Telefon hareket etmezse işletim sistemi konum vermez; müşteri kurye kayboldu sanmasın diye elle sorulur. */
const HEARTBEAT_CHECK_MS = 30000;
const HEARTBEAT_AFTER_MS = 60000;
const POLL_MS = 15000;
const CLOCK_TICK_MS = 5000;

// ── Satıcı tarafı: konum paylaşımı ───────────────────────────────────────────
// Yalnızca ön planda çalışır. Arka plan takibi mağaza incelemesinde ayrı gerekçe ister, eklenmedi.

export type SharingState = 'idle' | 'starting' | 'sharing' | 'denied' | 'services_off' | 'failed';
export type SharingStatus = { state: SharingState; sendFailed: boolean };

type Session = {
  subscription: Location.LocationSubscription | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  lastSentAt: number;
  inFlight: Promise<void>;
  stopped: boolean;
};

const IDLE: SharingStatus = { state: 'idle', sendFailed: false };
const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();
let statuses: Record<string, SharingStatus> = {};

function setStatus(orderId: string, status: SharingStatus) {
  statuses = { ...statuses, [orderId]: status };
  listeners.forEach(listener => listener());
}

function closeSession(orderId: string, session: Session) {
  session.stopped = true;
  session.subscription?.remove();
  if (session.heartbeat) clearInterval(session.heartbeat);
  if (sessions.get(orderId) === session) sessions.delete(orderId);
}

/** Liste her konumda yeniden çizilmesin diye yalnızca değişince haber verir. */
function markSent(orderId: string, sendFailed: boolean) {
  const current = statuses[orderId];
  if (current?.state === 'sharing' && current.sendFailed === sendFailed) return;
  setStatus(orderId, { state: 'sharing', sendFailed });
}

async function sendPosition(orderId: string, session: Session, position: Location.LocationObject) {
  if (session.stopped) return;
  session.lastSentAt = Date.now();
  const { latitude, longitude, heading } = position.coords;
  const write = supabase.rpc('update_courier_location', {
    p_order: orderId,
    p_lat: latitude,
    p_lng: longitude,
    p_heading: heading != null && heading >= 0 ? heading : null,
  });
  session.inFlight = Promise.resolve(write).then(({ error }) => {
    if (session.stopped) return;
    // Sipariş yoldan çıktı ya da oturum kapandı: göndermeye devam etmenin anlamı yok.
    if (error?.code === '55000' || error?.code === '42501') {
      closeSession(orderId, session);
      setStatus(orderId, IDLE);
      return;
    }
    markSent(orderId, !!error);
  }).catch(() => {
    if (!session.stopped) markSent(orderId, true);
  });
  await session.inFlight;
}

/** Paylaşımı başlatır ve ekranda gösterilecek durumu döndürür. Sipariş zaten paylaşılıyorsa dokunmaz. */
export async function startSharing(orderId: string): Promise<SharingState> {
  if (sessions.has(orderId)) return statuses[orderId]?.state ?? 'sharing';
  const session: Session = { subscription: null, heartbeat: null, lastSentAt: 0, inFlight: Promise.resolve(), stopped: false };
  sessions.set(orderId, session);
  setStatus(orderId, { state: 'starting', sendFailed: false });

  const finish = (state: SharingState): SharingState => {
    closeSession(orderId, session);
    setStatus(orderId, { state, sendFailed: false });
    return state;
  };

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (session.stopped) return 'idle';
    if (status !== 'granted') return finish('denied');
    if (!(await Location.hasServicesEnabledAsync())) return session.stopped ? 'idle' : finish('services_off');

    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: WATCH_INTERVAL_MS, distanceInterval: WATCH_DISTANCE_M },
      position => { void sendPosition(orderId, session, position); },
    );
    // İzin penceresi açıkken paylaşım durdurulmuş olabilir.
    if (session.stopped) {
      subscription.remove();
      return 'idle';
    }
    session.subscription = subscription;
    session.heartbeat = setInterval(() => {
      if (Date.now() - session.lastSentAt < HEARTBEAT_AFTER_MS) return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(position => sendPosition(orderId, session, position))
        .catch(() => undefined); // Konum alınamazsa müşteri konumu bayat görür, doğrusu da budur.
    }, HEARTBEAT_CHECK_MS);
    setStatus(orderId, { state: 'sharing', sendFailed: false });
    return 'sharing';
  } catch {
    return session.stopped ? 'idle' : finish('failed');
  }
}

/**
 * Paylaşımı durdurur. Teslim ve iptalde konumu sunucu kendisi siler, o zaman clearServer false verilir.
 * Son konum sunucudan silinemezse false döner.
 */
export async function stopSharing(orderId: string, { clearServer = true }: { clearServer?: boolean } = {}): Promise<boolean> {
  const session = sessions.get(orderId);
  if (session) {
    closeSession(orderId, session);
    await session.inFlight; // Yoldaki yazım silmeden sonra satırı geri getirmesin.
  }
  if (statuses[orderId] && statuses[orderId] !== IDLE) setStatus(orderId, IDLE);
  if (!clearServer) return true;
  const { error } = await supabase.rpc('stop_courier_location', { p_order: orderId });
  return !error;
}

function subscribeStatuses(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getStatuses = () => statuses;

/** Sipariş kimliğine göre paylaşım durumları; kaydı olmayan sipariş paylaşılmıyordur. */
export function useSharingStatuses(): Record<string, SharingStatus> {
  return useSyncExternalStore(subscribeStatuses, getStatuses, getStatuses);
}

export const sharingStatusOf = (all: Record<string, SharingStatus>, orderId: string): SharingStatus => all[orderId] ?? IDLE;

// ── Müşteri tarafı: konumu okuma ─────────────────────────────────────────────

let channelSeq = 0;

export type CourierLocationView = {
  location: CourierLocation | null;
  stale: boolean;
  now: number;
};

/**
 * Siparişin kurye konumu. Realtime anında getirir; sorgu her 15 sn yine çalışır, çünkü telefon uykudan
 * dönünce kanal sessizce kopabilir ve süzgeçli kanala silme olayı gelmez.
 */
export function useCourierLocation(orderId: string | undefined, enabled: boolean): CourierLocationView {
  const [location, setLocation] = useState<CourierLocation | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !orderId) {
      setLocation(null);
      return;
    }
    let alive = true;

    const load = async () => {
      const { data, error } = await supabase
        .from('order_courier_locations')
        .select('order_id, lat, lng, heading, updated_at')
        .eq('order_id', orderId)
        .maybeSingle();
      // Hata olursa son konum kalır; süresi dolunca bayat görünür.
      if (alive && !error) setLocation(parseCourierLocation(data));
      if (alive) setNow(Date.now());
    };

    load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    const channel = supabase
      .channel(`courier-location-${orderId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_courier_locations', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setLocation(payload.eventType === 'DELETE' ? null : parseCourierLocation(payload.new as Record<string, any>));
          setNow(Date.now());
        },
      )
      .subscribe();

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
      supabase.removeChannel(channel);
    };
  }, [orderId, enabled]);

  return { location, stale: location ? isLocationStale(location.updatedAt, now) : false, now };
}

/** Teslimat adresinin koordinatı. Sipariş kaydında tutulmaz, müşterinin telefonunda çözülür; bulunamazsa null. */
export function useDeliveryPoint(address: string | null | undefined, enabled: boolean): Coords | null {
  const [point, setPoint] = useState<Coords | null>(null);

  useEffect(() => {
    if (!enabled || !address) {
      setPoint(null);
      return;
    }
    let alive = true;
    geocodeAddress(`${address}, Türkiye`).then(found => {
      if (alive) setPoint(found);
    });
    return () => { alive = false; };
  }, [address, enabled]);

  return point;
}
