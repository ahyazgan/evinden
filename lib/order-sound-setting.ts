import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@afiyetli_order_sound';

// Ayar ekranı ile alarm aynı anda açık: değişiklik alarma hemen ulaşır.
const listeners = new Set<(enabled: boolean) => void>();

async function readEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'false';
  } catch {
    return true; // Okunamazsa sipariş kaçmasın, ses açık kalır.
  }
}

/** "Sipariş sesi" ayarı: bu cihazda saklanır, varsayılanı açık. */
export function useOrderSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    readEnabled().then(value => { if (active) setEnabled(value); });
    listeners.add(setEnabled);
    return () => {
      active = false;
      listeners.delete(setEnabled);
    };
  }, []);

  const update = useCallback((next: boolean) => {
    listeners.forEach(listener => listener(next));
    AsyncStorage.setItem(KEY, String(next)).catch(() => undefined);
  }, []);

  return [enabled, update];
}
