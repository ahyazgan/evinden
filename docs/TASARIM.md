# Evinden tasarım kuralları: Koyu ve Limon

Kullanıcının onayladığı tasarım. Yeni ekran yazarken veya ekran değiştirirken buna uy.

## Renkler

Sabit renk yazma, `useTheme()` içindeki `colors` anahtarlarını kullan.

| Anahtar | Değer | Nerede |
|---|---|---|
| `brand`, `primary` | `#2C312E` antrasit | Üst alan, alt bar, ana düğme, koyu kart |
| `panel` | `#3E4440` | Koyu yüzeydeki kutu: arama, geri düğmesi, ikincil düğme |
| `accent` | `#C8F031` limon | Yalnızca etkin durum, onay ve sepet düğmesi. Üstüne `onAccent` yazı |
| `onBrand` | `#FFFFFF` | Koyu yüzeydeki yazı ve simge |
| `onBrandSoft` | `#C4CAC5` | Koyu yüzeydeki ikincil yazı |
| `background` | `#F1F2EE` | Bütün sayfaların zemini |
| `surface` | `#FFFFFF` | Bütün kartlar ve paneller |
| `text`, `heading` | `#151A16` | Açık zemindeki yazı |
| `textSecondary` | `#56605A` | Açıklama ve yardımcı bilgi |
| `textMuted` | `#5E6862` | Yer tutucu, pasif simge |
| `divider`, `surfaceBorder` | `#E3E6DE` | Çizgi ve kenarlık |
| `danger` | `#C62828` | Yalnızca hata ve iptal |
| `success` | `#2E7D32` | Yalnızca başarılı durum |

Limon beyaz zeminde yazı veya simge olarak kullanılmaz, okunmaz. Mavi, mor, pembe ve turuncu kullanılmaz.

## Bileşenler

- **Üst alan:** `components/shared/TopBar.tsx` içindeki `TopBar`. Telefonda koyu ve alttan yuvarlak, masaüstünde sade başlık. Güvenli alanı kendisi ayarlar, bu yüzden ekranda `SafeAreaView` üst kenarı kullanılmaz.
- **Sepet:** `CartButton` veya `TopBar cart`. Alt barda sepet yok.
- **Arama:** `SearchField`. `TopBar` içindeyse koyu, dışındaysa beyaz görünür.
- **Alt bar:** `ChainTabBar`. Müşteri tarafında içeriğin üstünde yüzer, bu yüzden sekme ekranları kaydırma alanının altına `useTabBarSpace()` kadar boşluk koyar.
- **Düğme:** `components/ui/Button.tsx`. Ana eylem `primary`, onay vurgusu `accent`.

## Ölçüler

- Kart: beyaz, köşe 16, iç boşluk 8-14. Kenarlık ve gölge yok.
- Düğme: köşe 12, en az 46 yükseklik. Seçim çipi: köşe 10, 40 yükseklik.
- Dokunma alanı en az 44 piksel. İkona `accessibilityLabel` ver.
- Başlık yazısı `fonts.display`, metin Figtree (`fonts.regular` ve diğerleri).

## Dil

"Sen" diye hitap et, kısa ve samimi yaz. Arayüzde emoji kullanma, `Ionicons` kullan.
