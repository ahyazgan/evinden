// Uygulama ile veritabanı arasındaki sözleşme: yazım hatası veya eksik migration çalışma anında
// sessizce başarısız olur (burada bir kez olmuştu), bu yüzden kaynak kod taranarak denetlenir.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = ['app', 'lib', 'components', join('supabase', 'functions')]
  .flatMap((d) => sourceFiles(join(ROOT, d)))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

function findAll(regex) {
  return sources.flatMap(({ path, text }) => [...text.matchAll(regex)].map((m) => ({ path, match: m })));
}

let db;
before(async () => {
  db = await createDb();
});

describe('Uygulama ve veritabanı uyumu', () => {
  test('kullanılan tüm tablolar var', async () => {
    const rows = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows;
    const tables = new Set(rows.map((r) => r.table_name));
    const used = findAll(/\.from\('([a-z_]+)'\)/g).filter((u) => !/storage\s*\.from/.test(u.match.input.slice(Math.max(0, u.match.index - 12), u.match.index + 6)));
    assert.ok(used.length > 20);
    for (const { path, match } of used) {
      assert.ok(tables.has(match[1]), `${path}: '${match[1]}' tablosu yok`);
    }
  });

  test('çağrılan tüm RPC fonksiyonları var ve parametre adları tutuyor', async () => {
    const fns = (await db.query(`
      SELECT p.proname, p.proargnames, p.pronargdefaults, p.pronargs
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace`)).rows;
    const byName = new Map(fns.map((f) => [f.proname, f]));

    const calls = findAll(/\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*\{([\s\S]*?)\}\s*\))?/g);
    const rpcHelper = findAll(/rpc\('([a-z_]+)',\s*\{([\s\S]*?)\}\)/g);
    assert.ok(calls.length >= 5);

    for (const { path, match } of [...calls, ...rpcHelper]) {
      const fn = byName.get(match[1]);
      assert.ok(fn, `${path}: ${match[1]} fonksiyonu yok`);
      const sent = [...(match[2] ?? '').matchAll(/\b(p_[a-z_]+)\s*:/g)].map((m) => m[1]);
      const names = fn.proargnames ?? [];
      for (const arg of sent) {
        assert.ok(names.includes(arg), `${path}: ${match[1]} için '${arg}' parametresi yok`);
      }
      const required = names.slice(0, fn.pronargs - fn.pronargdefaults);
      for (const arg of required) {
        assert.ok(sent.includes(arg), `${path}: ${match[1]} için zorunlu '${arg}' gönderilmiyor`);
      }
    }
  });

  test('Edge Function\'ların çağırdığı sunucu fonksiyonları service_role ile çalışabilir', async () => {
    for (const fn of ['record_payment_init', 'mark_order_paid', 'mark_order_refunded', 'record_payment_error']) {
      const r = await db.query(`
        SELECT has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS client,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
          FROM pg_proc p WHERE proname=$1`, [fn]);
      assert.deepEqual(r.rows[0], { service: true, client: false, anon: false }, fn);
    }
  });

  test('sipariş sorgularının kullandığı kolonlar var', async () => {
    const cols = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='orders'`)).rows.map((r) => r.column_name));
    for (const c of ['payment_method', 'payment_status', 'refund_status', 'refund_reason', 'cancel_reason', 'commission_rate', 'discount_cents', 'coupon_code']) {
      assert.ok(cols.has(c), c);
    }
    const sellers = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='sellers'`)).rows.map((r) => r.column_name));
    for (const c of ['seller_type', 'is_paused', 'delivery_fee_cents', 'free_delivery_threshold_cents', 'min_order_cents', 'delivery_time_min', 'delivery_time_max', 'delivery_radius_km', 'latitude', 'longitude', 'uses_weekly_menu', 'logo_url', 'cover_url']) {
      assert.ok(sellers.has(c), c);
    }
  });

  test('SellerRow türündeki tüm alanlar veritabanında var', async () => {
    const cols = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='sellers'`)).rows.map((r) => r.column_name));
    const db_ts = readFileSync(join(ROOT, 'lib', 'db.ts'), 'utf8').replaceAll('\r\n', '\n');
    const body = db_ts.match(/export type SellerRow = \{([\s\S]*?)\n\};/)[1];
    const fields = [...body.matchAll(/^\s+([a-z_]+)\??:/gm)].map((m) => m[1]);
    assert.ok(fields.length > 15);
    for (const f of fields) assert.ok(cols.has(f), `sellers.${f} yok`);
  });

  test('ödül bedelleri uygulama ve sunucuda aynı', async () => {
    const loyalty = readFileSync(join(ROOT, 'lib', 'loyalty.ts'), 'utf8');
    const def = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname='redeem_reward'`)).rows[0].prosrc;
    for (const m of loyalty.matchAll(/id: '([a-z_0-9]+)'[^\n]*?pointsCost: (\d+)/g)) {
      assert.match(def, new RegExp(`WHEN '${m[1]}'\\s+THEN v_cost := ${m[2]};`), `${m[1]} bedeli farklı`);
    }
  });
});
