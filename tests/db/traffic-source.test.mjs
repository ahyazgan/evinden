// 062: app_open olayında ziyaretçi kaynağı ve yöneticinin "Nereden geldiler" tablosu.
import { test, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, as, failure } from './harness.mjs';
import { newSessionId } from '../../lib/analytics-core.ts';

let db;
let admin;
let buyer;
let sellerUser;

async function user(role) {
  const id = randomUUID();
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${id}');
    INSERT INTO public.users (id, name, role, is_approved) VALUES ('${id}','Test','${role}',true);
  `);
  return id;
}

before(async () => {
  db = await createDb();
  admin = await user('admin');
  buyer = await user('buyer');
  sellerUser = await user('seller');
});

const trackSql = 'SELECT public.track_events($1::jsonb) AS n';
const trackAs = async (uid, events) => Number((await as(db, uid, trackSql, [JSON.stringify(events)])).rows[0].n);
const ev = (session_id, name, props = {}) => ({ session_id, name, props });
const sources = async (days = 7) =>
  (await as(db, admin, 'SELECT * FROM public.admin_traffic_sources($1)', [days])).rows
    .map((r) => [r.source, Number(r.sessions), Number(r.ordering_sessions)]);

describe('kaynak alanı', () => {
  beforeEach(() => db.exec('DELETE FROM public.analytics_events'));

  test('source kabul edilir; boşluklu veya uzun değer kısıta takılıp atlanır', async () => {
    const s = newSessionId();
    const saved = await trackAs(buyer, [
      ev(s, 'app_open', { source: 'google' }),
      ev(s, 'app_open', { source: 'utm_afis-kadikoy' }),
      ev(s, 'app_open', { source: 'https://site.example/yol?ad=Ayse' }),
      ev(s, 'app_open', { source: 'x'.repeat(65) }),
      ev(s, 'app_open', { kaynak: 'google' }),
    ]);
    assert.equal(saved, 2);
  });
});

describe('admin_traffic_sources', () => {
  beforeEach(() => db.exec('DELETE FROM public.analytics_events'));

  test('yalnızca yönetici, dönem 1-180', async () => {
    assert.equal((await failure(db, buyer, 'SELECT * FROM public.admin_traffic_sources(7)'))?.code, '42501');
    for (const days of [0, 181]) {
      assert.equal((await failure(db, admin, 'SELECT * FROM public.admin_traffic_sources($1)', [days]))?.code, '22023');
    }
  });

  test('kaynak başına tekil oturum ve siparişe dönen oturum; satıcı sayılmaz, eski olay girmez', async () => {
    const [a, b, c, d, e, old] = Array.from({ length: 6 }, () => newSessionId());
    await trackAs(buyer, [
      ev(a, 'app_open', { source: 'google' }), ev(a, 'app_open', { source: 'google' }), ev(a, 'order_placed'),
      ev(b, 'app_open', { source: 'google' }),
      ev(c, 'app_open', { source: 'instagram' }), ev(c, 'order_placed'),
      ev(d, 'app_open'),
      ev(old, 'app_open', { source: 'whatsapp' }),
    ]);
    await trackAs(sellerUser, [ev(e, 'app_open', { source: 'google' })]);
    await db.exec(`UPDATE public.analytics_events SET created_at = now() - interval '10 days' WHERE session_id = '${old}'`);

    assert.deepEqual(await sources(7), [
      ['google', 2, 1],
      ['bilinmiyor', 1, 0],
      ['instagram', 1, 1],
    ]);
    assert.deepEqual((await sources(30)).find((r) => r[0] === 'whatsapp'), ['whatsapp', 1, 0]);
  });

  test('giriş yapmamış istemci çağıramaz', async () => {
    const { rows } = await db.query(`
      SELECT has_function_privilege('anon', 'public.admin_traffic_sources(integer)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.admin_traffic_sources(integer)', 'EXECUTE') AS auth`);
    assert.deepEqual(rows[0], { anon: false, auth: true });
  });
});
