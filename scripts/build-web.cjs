// Web yayın klasörünü hazırlar: uygulama kökte, tanıtım sayfası /tanitim altında.
// Kullanım: node scripts/build-web.cjs   Çıktı: dist/
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildSitemap, fetchActiveSellers } = require('./sitemap.cjs');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

execSync('npx expo export --platform web --output-dir dist --clear', { cwd: root, stdio: 'inherit' });

const landing = path.join(dist, 'tanitim');
fs.mkdirSync(landing, { recursive: true });
fs.copyFileSync(path.join(root, 'afiyetli_landing.html'), path.join(landing, 'index.html'));

// Tanıtım sayfasının kullandığı görseller göreli yolla okunur.
const html = fs.readFileSync(path.join(landing, 'index.html'), 'utf8');
const used = new Set([...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map(m => m[1]));
for (const rel of used) {
  const target = path.join(landing, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, rel), target);
}

/** .env'deki herkese açık Supabase değerleri (ortamda varsa o kullanılır). Değerler yazdırılmaz. */
function publicEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find(l => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

(async () => {
  const sellers = await fetchActiveSellers(publicEnv('EXPO_PUBLIC_SUPABASE_URL'), publicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'));
  fs.writeFileSync(path.join(dist, 'sitemap.xml'), buildSitemap(sellers));

  for (const required of ['index.html', '_headers', 'hesap-silme/index.html', 'tanitim/index.html', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest']) {
    if (!fs.existsSync(path.join(dist, required))) throw new Error(`Eksik dosya: ${required}`);
  }
  console.log(`Hazır: dist (tanıtım görseli ${used.size}, site haritasında restoran ${sellers.length})`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
