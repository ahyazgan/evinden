import { haversineKm } from './geo.ts';

export type District = { district: string; city: string; latitude: number; longitude: number };

type Row = [district: string, latitude: number, longitude: number];

/** Büyük şehirlerin ilçeleri. Koordinatlar ilçe merkezidir: teslimat alanı listelemede yaklaşık hesaplanır. */
const CITIES: Record<string, Row[]> = {
  'İstanbul': [
    ['Adalar', 40.876, 29.091], ['Arnavutköy', 41.185, 28.741], ['Ataşehir', 40.984, 29.107],
    ['Avcılar', 40.979, 28.721], ['Bağcılar', 41.039, 28.856], ['Bahçelievler', 41.0, 28.863],
    ['Bakırköy', 40.982, 28.874], ['Başakşehir', 41.093, 28.802], ['Bayrampaşa', 41.046, 28.9],
    ['Beşiktaş', 41.043, 29.007], ['Beykoz', 41.125, 29.106], ['Beylikdüzü', 40.982, 28.64],
    ['Beyoğlu', 41.037, 28.977], ['Büyükçekmece', 41.021, 28.585], ['Çatalca', 41.143, 28.461],
    ['Çekmeköy', 41.035, 29.178], ['Esenler', 41.043, 28.876], ['Esenyurt', 41.034, 28.68],
    ['Eyüpsultan', 41.049, 28.934], ['Fatih', 41.019, 28.94], ['Gaziosmanpaşa', 41.066, 28.912],
    ['Güngören', 41.022, 28.872], ['Kadıköy', 40.991, 29.027], ['Kağıthane', 41.079, 28.972],
    ['Kartal', 40.889, 29.186], ['Küçükçekmece', 41.0, 28.78], ['Maltepe', 40.935, 29.131],
    ['Pendik', 40.875, 29.233], ['Sancaktepe', 41.002, 29.231], ['Sarıyer', 41.167, 29.05],
    ['Silivri', 41.074, 28.247], ['Sultanbeyli', 40.968, 29.262], ['Sultangazi', 41.106, 28.868],
    ['Şile', 41.176, 29.613], ['Şişli', 41.06, 28.987], ['Tuzla', 40.816, 29.3],
    ['Ümraniye', 41.016, 29.124], ['Üsküdar', 41.023, 29.015], ['Zeytinburnu', 40.99, 28.905],
  ],
  'Ankara': [
    ['Çankaya', 39.905, 32.86], ['Keçiören', 39.985, 32.865], ['Yenimahalle', 39.97, 32.81],
    ['Mamak', 39.925, 32.915], ['Etimesgut', 39.945, 32.665], ['Sincan', 39.965, 32.58],
    ['Altındağ', 39.95, 32.865], ['Pursaklar', 40.035, 32.9], ['Gölbaşı', 39.79, 32.805],
    ['Polatlı', 39.577, 32.147],
  ],
  'İzmir': [
    ['Konak', 38.418, 27.129], ['Karşıyaka', 38.46, 27.115], ['Bornova', 38.466, 27.217],
    ['Buca', 38.385, 27.175], ['Bayraklı', 38.462, 27.165], ['Çiğli', 38.495, 27.07],
    ['Gaziemir', 38.32, 27.13], ['Balçova', 38.39, 27.045], ['Narlıdere', 38.395, 27.0],
    ['Karabağlar', 38.375, 27.115], ['Güzelbahçe', 38.365, 26.885], ['Çeşme', 38.323, 26.303],
    ['Urla', 38.323, 26.765], ['Menemen', 38.607, 27.07], ['Torbalı', 38.155, 27.36],
  ],
  'Bursa': [
    ['Osmangazi', 40.195, 29.06], ['Nilüfer', 40.215, 28.985], ['Yıldırım', 40.19, 29.105],
    ['Mudanya', 40.375, 28.885], ['Gemlik', 40.432, 29.155], ['İnegöl', 40.078, 29.513],
  ],
  'Antalya': [
    ['Muratpaşa', 36.885, 30.705], ['Kepez', 36.925, 30.725], ['Konyaaltı', 36.865, 30.635],
    ['Alanya', 36.544, 31.995], ['Manavgat', 36.787, 31.443], ['Kemer', 36.6, 30.56],
  ],
  'Adana': [['Seyhan', 36.995, 35.32], ['Çukurova', 37.045, 35.3], ['Yüreğir', 36.985, 35.365], ['Sarıçam', 37.055, 35.39]],
  'Konya': [['Selçuklu', 37.9, 32.48], ['Meram', 37.85, 32.44], ['Karatay', 37.88, 32.515]],
  'Kayseri': [['Melikgazi', 38.73, 35.5], ['Kocasinan', 38.74, 35.465], ['Talas', 38.69, 35.555]],
  'Gaziantep': [['Şahinbey', 37.05, 37.37], ['Şehitkamil', 37.085, 37.37]],
  'Mersin': [['Yenişehir', 36.79, 34.6], ['Mezitli', 36.76, 34.53], ['Toroslar', 36.83, 34.6], ['Akdeniz', 36.805, 34.64], ['Tarsus', 36.918, 34.893]],
  'Kocaeli': [['İzmit', 40.765, 29.94], ['Gebze', 40.802, 29.43], ['Darıca', 40.77, 29.375], ['Körfez', 40.765, 29.775], ['Gölcük', 40.718, 29.82]],
  'Eskişehir': [['Odunpazarı', 39.765, 30.53], ['Tepebaşı', 39.79, 30.505]],
  'Samsun': [['Atakum', 41.34, 36.25], ['İlkadım', 41.29, 36.33], ['Canik', 41.265, 36.36]],
  'Trabzon': [['Ortahisar', 41.003, 39.718]],
  'Diyarbakır': [['Kayapınar', 37.935, 40.18], ['Bağlar', 37.915, 40.2], ['Sur', 37.91, 40.235], ['Yenişehir', 37.935, 40.215]],
  'Denizli': [['Pamukkale', 37.79, 29.09], ['Merkezefendi', 37.785, 29.06]],
  'Muğla': [['Bodrum', 37.034, 27.43], ['Marmaris', 36.855, 28.27], ['Fethiye', 36.622, 29.116], ['Menteşe', 37.215, 28.365]],
  'Aydın': [['Efeler', 37.845, 27.845], ['Kuşadası', 37.86, 27.26], ['Didim', 37.375, 27.27]],
  'Tekirdağ': [['Süleymanpaşa', 40.978, 27.51], ['Çorlu', 41.159, 27.8], ['Çerkezköy', 41.285, 28.0]],
  'Sakarya': [['Adapazarı', 40.78, 30.4], ['Serdivan', 40.76, 30.365]],
  'Manisa': [['Yunusemre', 38.62, 27.41], ['Şehzadeler', 38.615, 27.43]],
  'Hatay': [['Antakya', 36.205, 36.16], ['İskenderun', 36.587, 36.173]],
  'Şanlıurfa': [['Eyyübiye', 37.14, 38.79], ['Haliliye', 37.165, 38.795]],
};

/** Ayrıca ilçe listesi olmayan iller: şehir merkezi. */
const CITY_CENTERS: [city: string, latitude: number, longitude: number][] = [
  ['Adıyaman', 37.764, 38.278], ['Afyonkarahisar', 38.757, 30.538], ['Ağrı', 39.72, 43.051],
  ['Aksaray', 38.369, 34.037], ['Amasya', 40.653, 35.833], ['Ardahan', 41.11, 42.702],
  ['Artvin', 41.183, 41.818], ['Balıkesir', 39.649, 27.886], ['Bartın', 41.635, 32.337],
  ['Batman', 37.881, 41.135], ['Bayburt', 40.255, 40.222], ['Bilecik', 40.142, 29.979],
  ['Bingöl', 38.885, 40.498], ['Bitlis', 38.401, 42.108], ['Bolu', 40.735, 31.607],
  ['Burdur', 37.72, 30.29], ['Çanakkale', 40.155, 26.414], ['Çankırı', 40.601, 33.613],
  ['Çorum', 40.55, 34.955], ['Düzce', 40.844, 31.156], ['Edirne', 41.677, 26.556],
  ['Elazığ', 38.675, 39.223], ['Erzincan', 39.75, 39.5], ['Erzurum', 39.905, 41.268],
  ['Giresun', 40.913, 38.39], ['Gümüşhane', 40.46, 39.481], ['Hakkari', 37.574, 43.74],
  ['Iğdır', 39.921, 44.045], ['Isparta', 37.764, 30.556], ['Kahramanmaraş', 37.585, 36.937],
  ['Karabük', 41.2, 32.627], ['Karaman', 37.181, 33.215], ['Kars', 40.608, 43.097],
  ['Kastamonu', 41.376, 33.777], ['Kilis', 36.716, 37.115], ['Kırıkkale', 39.846, 33.515],
  ['Kırklareli', 41.735, 27.225], ['Kırşehir', 39.146, 34.16], ['Kütahya', 39.42, 29.983],
  ['Malatya', 38.355, 38.309], ['Mardin', 37.321, 40.724], ['Muş', 38.734, 41.491],
  ['Nevşehir', 38.625, 34.712], ['Niğde', 37.966, 34.679], ['Ordu', 40.984, 37.879],
  ['Osmaniye', 37.075, 36.246], ['Rize', 41.021, 40.523], ['Siirt', 37.933, 41.946],
  ['Sinop', 42.027, 35.151], ['Sivas', 39.748, 37.016], ['Şırnak', 37.518, 42.459],
  ['Tokat', 40.314, 36.554], ['Tunceli', 39.108, 39.548], ['Uşak', 38.682, 29.408],
  ['Van', 38.494, 43.38], ['Yalova', 40.655, 29.284], ['Yozgat', 39.82, 34.808],
  ['Zonguldak', 41.456, 31.798],
];

export const DISTRICTS: District[] = [
  ...Object.entries(CITIES).flatMap(([city, rows]) =>
    rows.map(([district, latitude, longitude]) => ({ district, city, latitude, longitude })),
  ),
  ...CITY_CENTERS.map(([city, latitude, longitude]) => ({ district: 'Merkez', city, latitude, longitude })),
];

const POPULAR_KEYS = ['Kadıköy', 'Beşiktaş', 'Üsküdar', 'Beyoğlu', 'Çankaya', 'Konak', 'Nilüfer', 'Muratpaşa'];

export const POPULAR_DISTRICTS: District[] = POPULAR_KEYS.map(
  name => DISTRICTS.find(d => d.district === name) as District,
);

/** Türkçe harfler olmadan da bulunsun: "kadikoy" Kadıköy'ü, "USKUDAR" Üsküdar'ı bulur. */
export function foldTr(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

const SEARCH_LIMIT = 30;

/** Önce adı aramayla başlayanlar gelir. Boş aramada popüler bölgeler döner. */
export function searchDistricts(query: string): District[] {
  const q = foldTr(query);
  if (!q) return POPULAR_DISTRICTS;
  const score = (d: District) => {
    const name = foldTr(d.district);
    const city = foldTr(d.city);
    if (name.startsWith(q)) return 0;
    if (city.startsWith(q)) return 1;
    return name.includes(q) || city.includes(q) || `${name} ${city}`.includes(q) ? 2 : 3;
  };
  return DISTRICTS
    .map(d => ({ d, rank: score(d) }))
    .filter(x => x.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SEARCH_LIMIT)
    .map(x => x.d);
}

/** Cihaz konumunun ad karşılığı: adres servisi yoksa ya da çözemezse başlıkta bu yazılır. */
export function nearestDistrict(latitude: number, longitude: number): District {
  let best = DISTRICTS[0];
  let bestKm = Infinity;
  for (const d of DISTRICTS) {
    const km = haversineKm(latitude, longitude, d.latitude, d.longitude);
    if (km < bestKm) {
      best = d;
      bestKm = km;
    }
  }
  return best;
}

export function findDistrict(district: string, city: string): District | null {
  return DISTRICTS.find(d => d.district === district && d.city === city) ?? null;
}

const hasCoords = (loc: { latitude?: number | null; longitude?: number | null }) => !!loc.latitude && !!loc.longitude;

/**
 * Eski sürümlerin kaydını düzeltir: elle seçim 0,0 koordinatıyla, çözülemeyen konum "Bilinmeyen" adıyla saklanırdı.
 * Koordinatı bulunamayan kayıt olduğu gibi kalır.
 */
export function normalizeSavedLocation<T extends { district: string; city: string; latitude: number; longitude: number }>(loc: T): T {
  if (hasCoords(loc)) {
    if (loc.district !== 'Bilinmeyen' && loc.city !== 'Bilinmeyen') return loc;
    const near = nearestDistrict(loc.latitude, loc.longitude);
    return { ...loc, district: near.district, city: near.city };
  }
  const known = findDistrict(loc.district, loc.city);
  return known ? { ...loc, latitude: known.latitude, longitude: known.longitude } : loc;
}
