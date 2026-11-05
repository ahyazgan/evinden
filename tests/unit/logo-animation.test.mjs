import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_MS, SMILE_LENGTH, logoFrame } from '../../lib/logo-animation.ts';

describe('logo animasyonu', () => {
  test('tur görünmezden başlar ve görünmez biter, döngüde sıçrama olmaz', () => {
    assert.equal(logoFrame(0).opacity, 0);
    assert.equal(logoFrame(1).opacity, 0);
    assert.equal(logoFrame(0).dashOffset, SMILE_LENGTH);
  });

  test('turun ortasında logo tam çizilmiş ve nokta yerindedir', () => {
    assert.deepEqual(logoFrame(0.7), { opacity: 1, dashOffset: 0, dotY: 17 });
  });

  test('gülüş geri gitmez, nokta çizim alanından taşmaz', () => {
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const f = logoFrame(i / 100);
      assert.ok(f.dashOffset <= last + 1e-9);
      last = f.dashOffset;
      assert.ok(f.opacity >= 0 && f.opacity <= 1);
      assert.ok(f.dotY >= 5.5 && f.dotY <= 17, String(f.dotY));
    }
  });

  test('gülüş uzunluğu eğriyi kaplar', () => {
    const c = [[[7, 30], [13, 43], [23, 50], [32, 50]], [[32, 50], [41, 50], [51, 43], [57, 30]]];
    let length = 0;
    for (const [a, b, d, e] of c) {
      let prev = a;
      for (let i = 1; i <= 200; i++) {
        const t = i / 200;
        const u = 1 - t;
        const q = [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * d[k] + t * t * t * e[k]);
        length += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
      }
    }
    assert.ok(SMILE_LENGTH >= length);
    assert.ok(LOOP_MS > 0);
  });
});
