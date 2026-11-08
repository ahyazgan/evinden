import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  jsonLdText,
  pageDescription,
  pageTitle,
  restaurantDescription,
  restaurantJsonLd,
  restaurantTitle,
  routeSeo,
} from '../../lib/seo.ts';

const require = createRequire(import.meta.url);
const { buildSitemap, STATIC_PAGES } = require('../../scripts/sitemap.cjs');

const SELLER = {
  id: '11111111-2222-4333-8444-555555555555',
  display_name: 'Usta Dönerci',
  district: 'Kadıköy',
  city: 'İstanbul',
  address_line: 'Moda Cd. 12',
  latitude: 40.98,
  longitude: 29.03,
  rating_avg: 4.56,
  rating_count: 23,
  photo: 'https://cdn.example.com/a.jpg',
  cuisineLabels: ['Döner', 'Burger'],
};

describe('Sayfa başlığı ve açıklama', () => {
  test('başlık yoksa sitenin ana başlığı, varsa sonuna marka', () => {
    assert.equal(pageTitle(), DEFAULT_TITLE);
    assert.equal(pageTitle('  '), DEFAULT_TITLE);
    assert.equal(pageTitle('Keşfet'), 'Keşfet | Afiyetli');
  });
  test('uzun açıklama kelime sınırında kısalır', () => {
    const d = pageDescription('kelime '.repeat(60));
    assert.ok(d.length <= 155, d.length);
    assert.ok(d.endsWith('…'));
    assert.equal(pageDescription(null), DEFAULT_DESCRIPTION);
  });
});

describe('Sayfaların dizin kuralı', () => {
  test('herkese açık sayfalar kanonik adresle, sondaki eğik çizgi yok sayılır', () => {
    assert.deepEqual(routeSeo('/explore/'), { ...routeSeo('/explore'), canonical: '/explore' });
    assert.equal(routeSeo('/').canonical, '/');
    assert.equal(routeSeo('/terms').noindex, undefined);
  });
  test('sepet, hesap ve paneller dizine girmez; restoran sayfası kendi bilgisini verir', () => {
    for (const p of ['/cart', '/orders', '/profile', '/restoran/orders', '/yonetim/dashboard', '/boyle-bir-yer']) {
      assert.equal(routeSeo(p).noindex, true, p);
    }
    assert.deepEqual(routeSeo(`/seller/${SELLER.id}`), { title: null, own: true });
  });
  test('robots.txt, açık sayfaları kapatmaz ve site haritasını gösterir', () => {
    const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)/gm)].map(m => m[1]);
    for (const page of STATIC_PAGES) {
      assert.ok(!disallowed.some(d => page.path.startsWith(d)), page.path);
    }
    assert.ok(!disallowed.some(d => '/seller/x'.startsWith(d)));
    assert.match(robots, /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  });
});

describe('Restoran sayfası', () => {
  test('başlık ve açıklama semt ve mutfakla yazılır', () => {
    assert.equal(restaurantTitle(SELLER), 'Usta Dönerci, Kadıköy');
    assert.equal(restaurantDescription(SELLER), 'Usta Dönerci: Kadıköy bölgesinde döner ve burger. Menüye bak, Afiyetli ile sipariş ver.');
    assert.equal(restaurantDescription({ id: SELLER.id, display_name: 'Ev' }), 'Ev: Menüye bak, Afiyetli ile sipariş ver.');
  });
  test('yapısal veri: puan yalnız gerçek değerlendirme varsa', () => {
    const ld = restaurantJsonLd(SELLER, 'https://x.test');
    assert.equal(ld['@type'], 'Restaurant');
    assert.equal(ld.url, `https://x.test/seller/${SELLER.id}`);
    assert.deepEqual(ld.servesCuisine, ['Döner', 'Burger']);
    assert.deepEqual(ld.aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.6, ratingCount: 23, bestRating: 5, worstRating: 1 });
    assert.equal(ld.address.addressLocality, 'Kadıköy');
    assert.equal(ld.geo.latitude, 40.98);
    const fresh = restaurantJsonLd({ ...SELLER, rating_count: 0, photo: 'data:image/png;base64,AAA', latitude: null });
    assert.equal(fresh.aggregateRating, undefined);
    assert.equal(fresh.image, undefined);
    assert.equal(fresh.geo, undefined);
  });
  test('restoran adındaki </script> sayfayı bozamaz', () => {
    const text = jsonLdText(restaurantJsonLd({ ...SELLER, display_name: '</script><script>alert(1)</script>' }));
    assert.ok(!text.includes('</script'));
    assert.equal(JSON.parse(text).name, '</script><script>alert(1)</script>');
  });
});

describe('Site haritası', () => {
  test('sabit sayfalar ve geçerli kimlikli restoranlar', () => {
    const xml = buildSitemap(
      [{ id: SELLER.id, updated_at: '2026-11-07T10:00:00Z' }, { id: '../../etc', updated_at: null }, null],
      'https://x.test',
    );
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.ok(xml.includes('<loc>https://x.test/</loc>'));
    assert.ok(xml.includes(`<loc>https://x.test/seller/${SELLER.id}</loc><lastmod>2026-11-07</lastmod>`));
    assert.ok(!xml.includes('etc'));
    assert.equal((xml.match(/<url>/g) ?? []).length, STATIC_PAGES.length + 1);
  });
  test('restoran yoksa yalnız sabit sayfalar', () => {
    assert.equal((buildSitemap([]).match(/<url>/g) ?? []).length, STATIC_PAGES.length);
  });
});
