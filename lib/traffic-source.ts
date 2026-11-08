// Ziyaretçinin nereden geldiği: kaba bir etiket. Tam adres, sorgu metni ve kişisel veri dışarı çıkmaz.
// Değer veritabanı kuralına uyar (062 analytics_props_valid): ^[A-Za-z0-9_-]{1,64}$

const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)google\./, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)yandex\./, 'yandex'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'instagram'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'telegram'],
];

/** utm_source gibi serbest değerleri kurala sığdırır: küçük harf, yalnız harf/rakam/_/-, en çok 40. */
function slug(value: string): string | null {
  const s = value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const LABELS: Record<string, string> = {
  dogrudan: 'Doğrudan / adres yazarak',
  diger: 'Diğer siteler',
  bilinmiyor: 'Bilinmiyor (telefon uygulaması veya eski sürüm)',
  google: 'Google', bing: 'Bing', yandex: 'Yandex', duckduckgo: 'DuckDuckGo',
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', x: 'X (Twitter)',
  tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', telegram: 'Telegram',
};

/** Yönetim ekranında okunur ad: "utm_afis" → "Kampanya: afis". */
export function sourceLabel(source: string): string {
  if (source.startsWith('utm_')) return `Kampanya: ${source.slice(4)}`;
  return LABELS[source] ?? source;
}

/** Siparişe dönen oturum oranı, tam sayı yüzde; oturum yoksa null. */
export function conversionPercent(sessions: number, ordering: number): number | null {
  return sessions > 0 ? Math.round((ordering / sessions) * 100) : null;
}

/**
 * Önce kampanya etiketi (?utm_source=…), sonra gelinen site, yoksa "dogrudan".
 * Bilinmeyen siteler "diger": adres tutulmaz. Kendi sitemizden gelen geçiş "dogrudan" sayılır.
 */
export function trafficSource(pageUrl: string, referrer: string): string {
  try {
    const utm = new URL(pageUrl).searchParams.get('utm_source');
    const tagged = utm ? slug(utm) : null;
    if (tagged) return `utm_${tagged}`;
  } catch {
    // geçersiz adres: gelinen siteye bak
  }
  const from = referrer ? hostOf(referrer) : null;
  if (!from) return 'dogrudan';
  const own = hostOf(pageUrl);
  if (own && from === own) return 'dogrudan';
  for (const [pattern, label] of KNOWN_HOSTS) if (pattern.test(from)) return label;
  return 'diger';
}
