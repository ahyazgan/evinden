/**
 * Uygulama simgelerini gülen kase işaretinden üretir. Şekil components/shared/Logo.tsx ile aynıdır.
 * Çalıştır: node scripts/generate-logo-assets.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const INK = [0x2c, 0x31, 0x2e];
const LIME = [0xc8, 0xf0, 0x31];
const WHITE = [0xff, 0xff, 0xff];

// 64 birimlik kutuda: nokta ve kalın, uçları yuvarlak gülüş eğrisi.
const DOT = { x: 32, y: 17, r: 5.5 };
const STROKE = 7;
const CURVES = [
  [[7, 30], [13, 43], [23, 50], [32, 50]],
  [[32, 50], [41, 50], [51, 43], [57, 30]],
];

function cubic([a, b, c, d], t) {
  const u = 1 - t;
  const at = (i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i];
  return [at(0), at(1)];
}

const POINTS = CURVES.flatMap((curve) => Array.from({ length: 41 }, (_, i) => cubic(curve, i / 40)));

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** İşaretin kenarına uzaklık: içeride negatif. */
function signedDistance(x, y) {
  let best = Math.hypot(x - DOT.x, y - DOT.y) - DOT.r;
  for (let i = 1; i < POINTS.length; i++) {
    best = Math.min(best, segmentDistance(x, y, POINTS[i - 1], POINTS[i]) - STROKE / 2);
  }
  return best;
}

function render(file, { size, background, color, scale }) {
  const png = new PNG({ width: size, height: size });
  const unit = (size * scale) / 64; // bir birimin piksel karşılığı
  const offset = (size - 64 * unit) / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = signedDistance((px + 0.5 - offset) / unit, (py + 0.5 - offset) / unit) * unit;
      const cover = Math.max(0, Math.min(1, 0.5 - d));
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        png.data[i + c] = background
          ? Math.round(background[c] * (1 - cover) + color[c] * cover)
          : color[c];
      }
      png.data[i + 3] = background ? 255 : Math.round(cover * 255);
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', file), PNG.sync.write(png));
  console.log(file);
}

render('icon.png', { size: 1024, background: LIME, color: INK, scale: 0.64 });
render('favicon.png', { size: 48, background: LIME, color: INK, scale: 0.72 });
render('splash-icon.png', { size: 1024, color: LIME, scale: 0.5 });
render('android-icon-foreground.png', { size: 1024, color: INK, scale: 0.44 });
render('android-icon-monochrome.png', { size: 1024, color: WHITE, scale: 0.44 });
render('notification-icon.png', { size: 96, color: WHITE, scale: 0.8 });

// Android arka planı düz limon.
const bg = new PNG({ width: 1024, height: 1024 });
for (let i = 0; i < bg.data.length; i += 4) {
  bg.data[i] = LIME[0];
  bg.data[i + 1] = LIME[1];
  bg.data[i + 2] = LIME[2];
  bg.data[i + 3] = 255;
}
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'android-icon-background.png'), PNG.sync.write(bg));
console.log('android-icon-background.png');
