// Birinci taraf kullanım ölçümü. Kuyruk ve kurallar analytics-core'da, burası yalnızca ağı bağlar.
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { createEventQueue, newSessionId, type AnalyticsEventName, type AnalyticsProps } from './analytics-core';

const queue = createEventQueue({
  sessionId: newSessionId(),
  send: async batch => {
    const { error } = await supabase.rpc('track_events', { p_events: batch });
    if (error) throw error;
  },
});

// Uygulama arka plana geçince bekleyen olaylar kaybolmasın.
try {
  AppState.addEventListener('change', state => {
    if (state !== 'active') void queue.flush();
  });
} catch {
  // Olmayan ortamda süre dolunca yine gider.
}

/** Hata fırlatmaz, ekranı bekletmez. Adres, telefon, mesaj veya arama metni verme. */
export function track(name: AnalyticsEventName, props?: AnalyticsProps): void {
  queue.track(name, props);
}
