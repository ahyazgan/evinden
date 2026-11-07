import { useEffect } from 'react';
import { Platform } from 'react-native';
import { jsonLdText, pageDescription, pageTitle, SITE_URL } from '@/lib/seo';

type Props = {
  /** Yalnız sayfa adı: "Keşfet". Sonuna " | Afiyetli" eklenir. Boşsa sitenin ana başlığı. */
  title?: string | null;
  description?: string | null;
  /** Kökten yol: "/seller/…". Verilirse kanonik adres olur. */
  path?: string;
  /** Hesap, sepet ve panel sayfaları arama sonucuna girmez. */
  noindex?: boolean;
  image?: string | null;
  jsonLd?: Record<string, unknown> | null;
};

const PAGE_JSON_LD_ID = 'seo-page-jsonld';

function setMeta(attr: 'name' | 'property', key: string, content: string | null): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string | null): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

function setPageJsonLd(text: string | null): void {
  let el = document.getElementById(PAGE_JSON_LD_ID);
  if (text == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.id = PAGE_JSON_LD_ID;
    el.setAttribute('type', 'application/ld+json');
    document.head.appendChild(el);
  }
  el.textContent = text;
}

/**
 * Webde sekme başlığı, açıklama, paylaşım kartı, kanonik adres ve sayfanın yapısal verisi.
 * Etiketleri doğrudan günceller (expo-router Head yalnız odaktaki ekranda çalışıyor). Telefonda bir şey yapmaz.
 */
export function Seo({ title, description, path, noindex, image, jsonLd }: Props) {
  const fullTitle = pageTitle(title);
  const desc = pageDescription(description);
  const url = path ? `${SITE_URL}${path}` : null;
  const img = image && /^https:\/\//.test(image) ? image : `${SITE_URL}/og-image.png`;
  const ld = jsonLd ? jsonLdText(jsonLd) : null;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = fullTitle;
    setMeta('name', 'description', desc);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : null);
    setCanonical(url);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', img);
    setPageJsonLd(ld);
  }, [fullTitle, desc, url, noindex, img, ld]);

  // Sayfadan çıkınca o sayfanın yapısal verisi kalmasın.
  useEffect(() => () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && ld) setPageJsonLd(null);
  }, [ld]);

  return null;
}
