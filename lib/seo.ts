// Arama motoru ve paylaşım bilgileri: sayfa başlığı, açıklama, restoran yapısal verisi (schema.org).
// Saf işlevler; ekrana yazan bileşen components/shared/Seo.tsx.

export const SITE_URL = 'https://afiyetli.ahyazgab.workers.dev';
export const SITE_NAME = 'Afiyetli';
export const DEFAULT_TITLE = 'Afiyetli: yakınındaki restoranlardan yemek siparişi';
export const DEFAULT_DESCRIPTION = 'Afiyetli ile yakınındaki restoranlardan yemek siparişi ver, siparişini adım adım izle.';

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 155;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** "Menü | Afiyetli"; başlık yoksa sitenin ana başlığı. */
export function pageTitle(title?: string | null): string {
  const t = title?.trim();
  if (!t) return DEFAULT_TITLE;
  return clip(`${t} | ${SITE_NAME}`, MAX_TITLE + SITE_NAME.length);
}

export function pageDescription(description?: string | null): string {
  const d = description?.trim();
  return d ? clip(d, MAX_DESCRIPTION) : DEFAULT_DESCRIPTION;
}

export type RouteSeo = {
  title: string | null;
  description?: string;
  noindex?: boolean;
  canonical?: string;
  /** Sayfa başlığını ekranın kendisi verir (restoran sayfası): ortak düzen dokunmaz. */
  own?: boolean;
};

/** Herkese açık sayfalar: başlık, açıklama ve kanonik adres. */
const PUBLIC_ROUTES: Record<string, Omit<RouteSeo, 'canonical'>> = {
  '/': { title: null },
  '/explore': { title: 'Keşfet', description: 'Yakınındaki restoranları mutfağa, puana ve teslimat süresine göre keşfet.' },
  '/food-category': { title: 'Yemekler', description: 'Kategoriye göre yemekler: yakınındaki restoranların menüsünden seç, sipariş ver.' },
  '/campaign': { title: 'Kampanyalar', description: 'Yakınındaki restoranların indirimleri ve kampanyaları.' },
  '/seller-apply': { title: 'Restoranını ekle', description: "Restoranını Afiyetli'ye ekle: menünü gir, yakınındaki müşterilerden sipariş al." },
  '/help': { title: 'Yardım', description: 'Sipariş, teslimat, ödeme ve iade hakkında sık sorulan sorular.' },
  '/terms': { title: 'Kullanım koşulları' },
  '/privacy': { title: 'Gizlilik ve KVKK aydınlatma metni' },
  '/sales-terms': { title: 'Mesafeli satış sözleşmesi' },
  '/login': { title: 'Giriş yap', description: "Afiyetli hesabına giriş yap, siparişini ver ve izle." },
  '/register': { title: 'Kayıt ol', description: 'Afiyetli hesabı aç, yakınındaki restoranlardan sipariş ver.' },
};

/** Restoran sayfası kendi başlığını verir; bilinmeyen müşteri sayfaları (sepet, hesap) dizine girmez. */
export function routeSeo(pathname: string): RouteSeo {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const known = PUBLIC_ROUTES[path];
  if (known) return { ...known, canonical: path };
  if (path.startsWith('/seller/')) return { title: null, own: true };
  if (path.startsWith('/restoran')) return { title: 'Restoran paneli', noindex: true };
  if (path.startsWith('/yonetim')) return { title: 'Yönetim', noindex: true };
  return { title: null, noindex: true };
}

export type SeoSeller = {
  id: string;
  display_name: string;
  bio?: string | null;
  city?: string | null;
  district?: string | null;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  photo?: string | null;
  cuisineLabels?: string[];
};

/** Restoran sayfasının başlığı: "Usta Dönerci, Kadıköy" */
export function restaurantTitle(s: SeoSeller): string {
  return s.district ? `${s.display_name}, ${s.district}` : s.display_name;
}

/** "Kadıköy'de döner ve burger. Menüye bak, Afiyetli ile sipariş ver." gibi; tanıtım yazısı varsa o eklenir. */
export function restaurantDescription(s: SeoSeller): string {
  const kinds = (s.cuisineLabels ?? []).map(k => k.toLocaleLowerCase('tr-TR'));
  const what = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} ve ${kinds[kinds.length - 1]}` : kinds[0];
  const where = s.district ?? s.city;
  const lead = what && where ? `${where} bölgesinde ${what}.` : what ? `${what[0].toLocaleUpperCase('tr-TR')}${what.slice(1)}.` : where ? `${where} bölgesinde restoran.` : '';
  const bio = s.bio?.trim() ? ` ${s.bio.trim()}` : '';
  return pageDescription(`${s.display_name}: ${lead}${bio} Menüye bak, Afiyetli ile sipariş ver.`.replace(/\s+/g, ' '));
}

type JsonLd = Record<string, unknown>;

/** schema.org Restaurant. Puan yalnızca gerçek değerlendirme varsa eklenir (Google uydurma puanı cezalandırır). */
export function restaurantJsonLd(s: SeoSeller, site = SITE_URL): JsonLd {
  const url = `${site}/seller/${s.id}`;
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${url}#restaurant`,
    name: s.display_name,
    url,
  };
  if (s.photo && /^https:\/\//.test(s.photo)) data.image = s.photo;
  if (s.cuisineLabels?.length) data.servesCuisine = s.cuisineLabels;
  if (s.bio?.trim()) data.description = pageDescription(s.bio);
  if (s.district || s.city || s.address_line) {
    data.address = {
      '@type': 'PostalAddress',
      ...(s.address_line ? { streetAddress: s.address_line } : {}),
      ...(s.district ? { addressLocality: s.district } : {}),
      ...(s.city ? { addressRegion: s.city } : {}),
      addressCountry: 'TR',
    };
  }
  if (typeof s.latitude === 'number' && typeof s.longitude === 'number' && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) {
    data.geo = { '@type': 'GeoCoordinates', latitude: s.latitude, longitude: s.longitude };
  }
  const count = Number(s.rating_count) || 0;
  const avg = Number(s.rating_avg) || 0;
  if (count > 0 && avg > 0) {
    data.aggregateRating = { '@type': 'AggregateRating', ratingValue: Math.round(avg * 10) / 10, ratingCount: count, bestRating: 5, worstRating: 1 };
  }
  data.potentialAction = { '@type': 'OrderAction', target: url };
  return data;
}

/** <script type="application/ld+json"> içine güvenle konacak metin: "</script" kapanışı kaçırılır. */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
