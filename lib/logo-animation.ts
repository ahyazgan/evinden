/** Gülen kase animasyonunun bir karesi. Çizimden bağımsızdır, bu yüzden test edilebilir. */

export const SMILE_LENGTH = 68;
export const LOOP_MS = 1600;
const DOT_REST_Y = 17;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function between(p: number, from: number, to: number, a: number, b: number) {
  return a + (b - a) * ((p - from) / (to - from));
}

/** p: turun neresinde olduğu, 0 ile 1 arası. Gülüş çizilir, nokta zıplayıp oturur, sonra kaybolur. */
export function logoFrame(p: number) {
  const opacity = p < 0.04 ? p / 0.04 : p > 0.88 ? (1 - p) / 0.12 : 1;
  const dashOffset = p < 0.45 ? SMILE_LENGTH * (1 - easeInOutCubic(p / 0.45)) : 0;
  let dotY = DOT_REST_Y;
  if (p < 0.3) dotY = between(p, 0, 0.3, 6, DOT_REST_Y);
  else if (p < 0.42) dotY = between(p, 0.3, 0.42, DOT_REST_Y, 12);
  else if (p < 0.54) dotY = between(p, 0.42, 0.54, 12, DOT_REST_Y);
  return { opacity, dashOffset, dotY };
}
