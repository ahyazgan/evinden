import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  alarmLabel,
  muteCurrent,
  ordersNeedingReply,
  pruneMuted,
  sameIds,
  shouldSound,
} from '../../lib/order-alarm.ts';

const order = (id, status = 'pending', scheduled_for = null) => ({ id, status, scheduled_for });

describe('hangi sipariş alarm çalar', () => {
  const orders = [
    order('normal'),
    order('planli', 'pending', '2026-11-06T10:00:00Z'),
    order('kabul', 'accepted'),
    order('odeme', 'awaiting_payment'),
    order('iptal', 'cancelled'),
  ];
  const ids = (open) => ordersNeedingReply(orders, open).map((o) => o.id);

  test('restoran açıkken bekleyen normal ve planlı sipariş sayılır', () => {
    assert.deepEqual(ids(true), ['normal', 'planli']);
  });

  test('restoran kapalıyken planlının yanıt süresi işlemez, normal sipariş yine sayılır', () => {
    assert.deepEqual(ids(false), ['normal']);
  });
});

describe('ses kararı', () => {
  test('sipariş yoksa çalmaz, sipariş bitince kendiliğinden susar', () => {
    assert.equal(shouldSound(['a'], [], true), true);
    assert.equal(shouldSound([], [], true), false);
  });

  test('"Sipariş sesi" ayarı kapalıysa çalmaz', () => {
    assert.equal(shouldSound(['a'], [], false), false);
  });

  test('sesi kapat yalnızca o anki siparişleri susturur, yeni sipariş yine çalar', () => {
    const muted = muteCurrent(['a', 'b'], []);
    assert.equal(shouldSound(['a', 'b'], muted, true), false);
    assert.equal(shouldSound(['a', 'b', 'c'], muted, true), true);
    const again = muteCurrent(['a', 'b', 'c'], muted);
    assert.equal(shouldSound(['a', 'b', 'c'], again, true), false);
    assert.equal(new Set(again).size, again.length);
  });

  test('yanıtlanan sipariş listeden düşer, diğerinin sessizliği sürer', () => {
    assert.deepEqual(pruneMuted(['a', 'b'], ['b']), ['b']);
    assert.equal(shouldSound(['b'], ['b'], true), false);
  });

  test('kapanışta düşen planlı sipariş restoran açılınca yeniden çalar', () => {
    const muted = pruneMuted(['planli'], []);
    assert.equal(shouldSound(['planli'], muted, true), true);
  });
});

test('sameIds sıradan bağımsız karşılaştırır, metin sayıyı yazar', () => {
  assert.equal(sameIds(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameIds(['a'], ['a', 'b']), false);
  assert.equal(alarmLabel(3), '3 yeni sipariş');
});

describe('ses dosyası', () => {
  const root = new URL('../../', import.meta.url);
  const FILE = 'new_order.wav';

  test('geçerli PCM WAV, yaklaşık 1,5 saniye, 300 KB altında', () => {
    const url = new URL(`assets/sounds/${FILE}`, root);
    const wav = readFileSync(url);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    const seconds = wav.readUInt32LE(40) / wav.readUInt32LE(28);
    assert.ok(seconds > 1.3 && seconds < 1.7, `süre ${seconds}`);
    assert.ok(statSync(url).size < 300 * 1024);
  });

  test('ad Android kaynağı olarak geçerli, push kanalı ve uygulama ayarı aynı dosyayı kullanır', () => {
    assert.match(FILE.replace(/\.wav$/, ''), /^[a-z][a-z0-9_]*$/);
    const notify = JSON.parse(readFileSync(new URL('app.json', root), 'utf8')).expo.plugins
      .find((p) => Array.isArray(p) && p[0] === 'expo-notifications')[1];
    assert.deepEqual(notify.sounds, [`./assets/sounds/${FILE}`]);
    assert.ok(readFileSync(new URL('lib/notifications.ts', root), 'utf8').includes(`sound: '${FILE}'`));
    assert.ok(readFileSync(new URL('supabase/migrations/038_alarm_consent.sql', root), 'utf8').includes(`'${FILE}'`));
  });
});
