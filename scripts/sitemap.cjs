// Site haritası: herkese açık sayfalar ve yayındaki restoranlar. build-web.cjs çağırır.
const SITE = 'https://afiyetli.ahyazgab.workers.dev';

/** Arama sonucuna girmesi istenen sabit sayfalar. Panel, hesap ve sipariş sayfaları yok (robots.txt). */
const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/explore', changefreq: 'daily', priority: '0.8' },
  { path: '/seller-apply', changefreq: 'monthly', priority: '0.6' },
  { path: '/tanitim/', changefreq: 'monthly', priority: '0.6' },
  { path: '/help', changefreq: 'monthly', priority: '0.4' },
  { path: '/terms', changefreq: 'yearly', priority: '0.2' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.2' },
  { path: '/sales-terms', changefreq: 'yearly', priority: '0.2' },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

/** sellers: [{ id, updated_at }] — yalnız etkin restoranlar verilmeli. */
function buildSitemap(sellers = [], site = SITE) {
  const urls = STATIC_PAGES.map(p => ({ loc: site + p.path, changefreq: p.changefreq, priority: p.priority }));
  for (const s of sellers) {
    if (!s || !UUID.test(String(s.id))) continue;
    const lastmod = s.updated_at && !Number.isNaN(Date.parse(s.updated_at)) ? new Date(s.updated_at).toISOString().slice(0, 10) : null;
    urls.push({ loc: `${site}/seller/${s.id}`, changefreq: 'daily', priority: '0.9', lastmod });
  }
  const body = urls
    .map(u => `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Etkin restoranları herkese açık anahtarla çeker. Ulaşılamazsa boş liste: harita sabit sayfalarla çıkar. */
async function fetchActiveSellers(supabaseUrl, anonKey) {
  if (!supabaseUrl || !anonKey) return [];
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/sellers?select=id,updated_at&is_active=eq.true&limit=5000`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

module.exports = { SITE, STATIC_PAGES, buildSitemap, fetchActiveSellers };
