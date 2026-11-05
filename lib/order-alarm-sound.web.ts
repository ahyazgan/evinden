import { Asset } from 'expo-asset';

export type AlarmPlayResult = 'played' | 'blocked';

// expo-audio web'de play() sonucunu yutar, tarayıcı engellediğinde bunu öğrenemeyiz. Bu yüzden web'de ses
// doğrudan HTMLAudioElement ile çalınır. Aynı öğe kullanılır: Safari dokunuşla açılan öğeye izin verir.
let audio: HTMLAudioElement | null = null;

/** Tarayıcı kullanıcı dokunmadan sesi engeller: 'blocked' döner, hata fırlatmaz. */
export async function playAlarmSound(): Promise<AlarmPlayResult> {
  try {
    if (!audio) audio = new window.Audio(Asset.fromModule(require('../assets/sounds/new_order.wav')).uri);
    audio.currentTime = 0;
    await audio.play();
    return 'played';
  } catch {
    return 'blocked';
  }
}

export function stopAlarmSound(): void {
  audio?.pause();
}

export function releaseAlarmSound(): void {
  audio?.pause();
  audio = null;
}
