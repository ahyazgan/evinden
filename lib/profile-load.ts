/** Profil yükleme kararı. Supabase'e bağlı değildir, bu yüzden hata durumları test edilebilir. */

export type DbError = { code?: string; message?: string } | null;

type Deps<Row> = {
  /** Satır yoksa `{ data: null, error: null }` döner. */
  read: () => Promise<{ data: Row | null; error: DbError }>;
  insert: () => Promise<{ data: Row | null; error: DbError }>;
  wait?: (ms: number) => Promise<void>;
};

export const READ_ATTEMPTS = 3;
const RETRY_MS = 400;
const UNIQUE_VIOLATION = '23505';
const defaultWait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Hesabın profil satırını getirir, yalnızca satırın gerçekten olmadığı görülürse oluşturur.
 * Okuma hatası "profil yok" demek değildir: öyle sayılırsa satıcı veya yönetici geçici bir
 * bağlantı hatasında müşteri profiline düşer. Okunamazsa null döner, rol uydurulmaz.
 */
export async function loadProfileRow<Row>({ read, insert, wait = defaultWait }: Deps<Row>): Promise<Row | null> {
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    const { data, error } = await read();
    if (data) return data;
    if (!error) {
      const created = await insert();
      if (created.data) return created.data;
      // Başka bir istek satırı aynı anda oluşturdu: yeniden okunur.
      if (created.error?.code === UNIQUE_VIOLATION) {
        const again = await read();
        return again.data ?? null;
      }
      return null;
    }
    if (attempt < READ_ATTEMPTS) await wait(RETRY_MS * attempt);
  }
  return null;
}

/** Eş zamanlı yüklemelerde yalnızca en son başlatılanın sonucu kullanılır. */
export function latestOnly() {
  let current = 0;
  return () => {
    const id = ++current;
    return () => id === current;
  };
}
