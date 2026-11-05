/** Depoda izin verilen fotoğraf türleri (003). */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Dosya uzantısı ve türü. Webde adres `data:image/jpeg;base64,...` ya da `blob:` olur, sonundan
 * uzantı okunamaz; bu yüzden önce seçicinin bildirdiği tür kullanılır.
 */
export function imageFileType(uri: string, mimeType?: string | null): { ext: string; contentType: string } {
  const fromMime = mimeType ? EXTENSIONS[mimeType.toLowerCase()] : undefined;
  if (fromMime) return { ext: fromMime, contentType: CONTENT_TYPES[fromMime] };

  const data = /^data:(image\/[a-z+.-]+)[;,]/i.exec(uri);
  const fromData = data ? EXTENSIONS[data[1].toLowerCase()] : undefined;
  if (fromData) return { ext: fromData, contentType: CONTENT_TYPES[fromData] };

  const tail = uri.split(/[?#]/)[0].split('/').pop() ?? '';
  const ext = tail.includes('.') ? (tail.split('.').pop() ?? '').toLowerCase() : '';
  const contentType = CONTENT_TYPES[ext];
  if (contentType) return { ext: ext === 'jpeg' ? 'jpg' : ext, contentType };
  return { ext: 'jpg', contentType: 'image/jpeg' };
}

/**
 * Her yükleme yeni bir dosyadır. Aynı adın üstüne yazmak depo kuralına takılır (003: güncellemede
 * ilk klasör kullanıcı kimliği olmalı, uygulama `menu/...` altına yazar) ve eski fotoğraf önbellekte kalır.
 */
export function uniqueUploadPath(path: string, ext: string, now: number = Date.now()): string {
  return `${path}-${now}.${ext}`;
}
