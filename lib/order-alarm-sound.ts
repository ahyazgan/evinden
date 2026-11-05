import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type AlarmPlayResult = 'played' | 'blocked';

let player: AudioPlayer | null = null;
let modeSet = false;
// Sesi kapat'a basıldıktan sonra yolda kalan çalma isteği sesi yeniden başlatmasın.
let playRequest = 0;

/** iOS'ta sessiz mod düğmesi açıkken de çalsın; arka planda çalmaz. */
async function prepareMode() {
  if (modeSet) return;
  modeSet = true;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'duckOthers' });
}

/** Sesi baştan çalar. Ses sorunu sipariş ekranını asla bozmaz, bu yüzden hata fırlatmaz. */
export async function playAlarmSound(): Promise<AlarmPlayResult> {
  const request = ++playRequest;
  try {
    await prepareMode();
    if (!player) player = createAudioPlayer(require('../assets/sounds/new_order.wav'));
    await player.seekTo(0);
    if (request === playRequest) player.play();
  } catch {
    // Titreşim ve üstteki uyarı yine çalışır.
  }
  return 'played';
}

export function stopAlarmSound(): void {
  playRequest++;
  try {
    player?.pause();
  } catch {
    // Oyuncu zaten kapanmış olabilir.
  }
}

export function releaseAlarmSound(): void {
  playRequest++;
  try {
    player?.remove();
  } catch {
    // Oyuncu zaten kapanmış olabilir.
  }
  player = null;
}
