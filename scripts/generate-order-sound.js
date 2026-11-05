/**
 * Yeni sipariş alarmının sesini üretir: iki tonlu, dikkat çekici, yaklaşık 1,5 saniye.
 * Çalıştır: node scripts/generate-order-sound.js
 *
 * Dosya adında tire yok: expo-notifications sesi Android'de res/raw altına aynı adla kopyalar,
 * orada yalnızca küçük harf, rakam ve alt çizgi geçerlidir, tireli ad derlemeyi bozar.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const LOW_HZ = 880;
const HIGH_HZ = 1175;
const NOTE_SECONDS = 0.2;
const GAP_SECONDS = 0.05;
const REPEATS = 3;
const FADE_SECONDS = 0.008; // Tonun başında ve sonunda çıtlamayı önler.
const PEAK = 0.8;

function note(hz) {
  const count = Math.round(NOTE_SECONDS * SAMPLE_RATE);
  const fade = Math.round(FADE_SECONDS * SAMPLE_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.min(1, i / fade, (count - 1 - i) / fade);
    // Üst harmonik, restoran gürültüsünde ve küçük hoparlörde sesin duyulmasını kolaylaştırır.
    const wave = Math.sin(2 * Math.PI * hz * t) * 0.75 + Math.sin(4 * Math.PI * hz * t) * 0.25;
    out[i] = wave * envelope * PEAK;
  }
  return out;
}

function silence(seconds) {
  return new Float64Array(Math.round(seconds * SAMPLE_RATE));
}

const parts = [];
for (let i = 0; i < REPEATS; i++) {
  parts.push(note(LOW_HZ), silence(GAP_SECONDS), note(HIGH_HZ), silence(GAP_SECONDS));
}
const samples = parts.flatMap((part) => Array.from(part));

const dataSize = samples.length * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0, 'ascii');
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVE', 8, 'ascii');
wav.write('fmt ', 12, 'ascii');
wav.writeUInt32LE(16, 16); // fmt bloğunun boyu
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // tek kanal
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // saniyedeki bayt
wav.writeUInt16LE(2, 32); // örnek başına bayt
wav.writeUInt16LE(16, 34); // örnek başına bit
wav.write('data', 36, 'ascii');
wav.writeUInt32LE(dataSize, 40);
samples.forEach((sample, i) => wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2));

const target = path.join(__dirname, '..', 'assets', 'sounds', 'new_order.wav');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, wav);
console.log(`${target}: ${(samples.length / SAMPLE_RATE).toFixed(2)} sn, ${Math.round(wav.length / 1024)} KB`);
