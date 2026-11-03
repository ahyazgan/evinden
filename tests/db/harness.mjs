// PGlite (WASM Postgres) üzerinde Supabase benzeri ortam kurar:
// auth.uid(), anon/authenticated rolleri, varsayılan yetkiler ve supabase/migrations/*.sql.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

// Depolama (003, 015, 017) ve pg_net (019) Supabase'e özgüdür; veritabanı güvenliğiyle ilgisi yok.
const SKIP = new Set(['003_storage.sql', '015_storage_owner_delete.sql', '017_seller_documents_storage.sql', '019_push_notifications.sql']);

export async function createDb() {
  const db = new PGlite();

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    -- Supabase'in varsayılan yetkileri: yeni tablo/fonksiyon anon ve authenticated'a açılır.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !SKIP.has(f)).sort();
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
