// PGlite (WASM Postgres) üzerinde Supabase benzeri ortam kurar:
// auth.uid(), anon/authenticated rolleri, varsayılan yetkiler ve supabase/migrations/*.sql.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

// Depolama (003, 015, 017) , pg_net (019) ve pg_cron (023) Supabase'e özgüdür; veritabanı güvenliğiyle ilgisi yok.
const SKIP = new Set(['003_storage.sql', '015_storage_owner_delete.sql', '017_seller_documents_storage.sql', '019_push_notifications.sql', '023_payment_expiry_cron.sql', '029_pending_expiry_cron.sql', '042_storage_policies.sql']);

// until: bu numaradan önceki migration'larda durur; yeni migration'ın dolu veritabanına etkisini sınamak için.
export async function createDb({ until } = {}) {
  const db = new PGlite();

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, phone text, phone_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    -- Supabase'in varsayılan yetkileri: yeni tablo/fonksiyon anon ve authenticated'a açılır.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !SKIP.has(f) && (!until || f < until)).sort();
  for (const f of files) {
    let sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    // 005 geçersiz söz dizimi içeriyor (CREATE POLICY IF NOT EXISTS Postgres'te yok).
    sql = sql.replace(/CREATE POLICY IF NOT EXISTS/gi, 'CREATE POLICY');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migration ${f} uygulanamadı: ${e.message}`);
    }
  }
  return db;
}

// 035'teki "aynı anda en çok 2 kapıda ödemeli sipariş" kuralı gerçek müşteri içindir. Bazı eski test dosyaları
// aynı müşteriyle siparişleri tamamlamadan art arda açar ve konuları bu kural değildir. Yalnızca o dosyanın geçici
// veritabanında sınır yükseltilir; varsayılan değişmez, kuralın kendisi operations-tools.test.mjs'de sınanır.
// Kupon hesabını sınayan dosyalar aynı müşteri ve restoranla çok sayıda kuponlu sipariş açar; 041'in 30 günlük sınırı konuları değil.
export async function allowRepeatDoorCoupons(db) {
  await db.exec('ALTER TABLE public.orders DISABLE TRIGGER orders_door_subsidy_guard_trg');
}

export async function allowManyDoorOrders(db) {
  await db.exec(`UPDATE public.app_config SET value = value || '{"door_active_limit": 100000}'::jsonb WHERE key = 'fraud_rules'`);
}

// Verilen kullanıcı olarak (authenticated rolü + JWT sub) sorgu çalıştırır.
// uid null ise service role/SQL editörü gibi davranır (auth.uid() NULL, RLS atlanır).
export async function as(db, uid, sql, params = []) {
  if (uid === null) {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  } else {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);
  }
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

// Hata beklenen çağrı: mesajı ve SQLSTATE kodunu döndürür; hata yoksa null.
export async function failure(db, uid, sql, params = []) {
  try {
    await as(db, uid, sql, params);
    return null;
  } catch (e) {
    return { message: e.message, code: e.code };
  }
}
