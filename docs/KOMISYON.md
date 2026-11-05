# Restoran komisyonu: nasıl belirlenir

Bu not bir tahmindir, piyasa verisi değildir. iyzico oranını, kurye ücretini ve ortalama sepeti kendi
gerçek rakamlarınla değiştirip aynı hesabı tekrarla. İlk 50 siparişten sonra mutlaka güncelle.

## Özet

| Durum | Komisyon (KDV hariç) |
|---|---|
| Restoranın kendi kuryesi var | **%10–12 + KDV** (alt sınır %7–8) |
| Lansman (ilk 2–3 ay) | %6–7, sonra %10'a çıkış sözleşmede yazılı |
| Kuryeyi platform ödüyor, müşteriden teslimat ~30 TL | %17–18 + KDV |
| Kuryeyi platform ödüyor, müşteriden teslimat ~45 TL | %14–15 + KDV |
| Kuryeyi platform ödüyor, teslimat ücreti kurye maliyetine yakın (~70 TL) | %10–12 + KDV |

Kodda restoran komisyonunun başlangıç değeri **%1** (`016_restaurants.sql`). Bu zarar ettirir.
Canlı değer `app_config.order_pricing` içindeki `restaurant_commission_rate_percent` alanındadır ve
yönetici panelinden değişir.

## Sipariş başına gider (örnek: 400 TL yemek + 30 TL teslimat = 430 TL)

| Gider | Tutar |
|---|---|
| iyzico (yaklaşık %3 + 0,25 TL, 430 TL üzerinden) | ~13 TL |
| SMS/bildirim, sunucu, destek, iade ve sahtecilik payı | ~5 TL |
| **Toplam** | **~18 TL (sepetin yaklaşık %4,5'i)** |

Müşteri parayı platforma öder; masrafların hepsi platformda kalır. Komisyon bu tutarın altına düşerse
her siparişte zarar edilir.

## Restoranın kendi kuryesi varsa (kurye masrafı platformda değil)

| Komisyon | Gelir | Gider | Kalan |
|---|---|---|---|
| %1 | 4 TL | 18 TL | −14 TL (zarar) |
| %5 | 20 TL | 18 TL | +2 TL |
| %8 | 32 TL | 18 TL | +14 TL |
| %10 | 40 TL | 18 TL | +22 TL |
| %12 | 48 TL | 18 TL | +30 TL |

%5'in altına inme. İptal ve iade olan siparişlerde ödeme masrafı platformda kalabilir.

## Kuryeyi platform ödüyorsa (örnek kurye ücreti 70 TL)

Formül: `komisyon % = (kurye ücreti − müşteriden alınan teslimat + ödeme masrafı + diğer gider) ÷ sepet + kâr payı`

| Müşteriden alınan teslimat | Gider | Gereken komisyon |
|---|---|---|
| 30 TL | 88 TL | en az %14,5; kâr payıyla %17–18 |
| 45 TL | 88 TL | en az %11; kâr payıyla %14–15 |
| 70 TL | 88 TL | en az %4,5; kâr payıyla %10–12 |

Kurye masrafı ya müşteriden ya restorandan alınmak zorundadır. Önerilen yol: teslimat ücretini kurye
maliyetine yaklaştırıp komisyonu %10–12 tutmak. Müşteri için fazlaysa orta yol: 45 TL teslimat + %14–15.

## Koddaki ayarlar (esnaf kurye için yeniden düşünülmeli)

Sistem şu an "satıcı kendi teslim eder" modeli için kurulu (`DELIVERY_CONFIG.model = 'seller_courier'`).
Varsayılanlar: teslimat ücreti 15 TL, ücretsiz teslimat eşiği 150 TL.

Kuryeyi platform ödeyecekse:

- 150 TL üstü siparişte müşteri teslimat ödemez, kurye ücretini platform karşılar. Eşiği kaldır ya da yükselt.
- 15 TL teslimat ücreti 70 TL'lik kurye maliyetinin çok altındadır.
- Küçük siparişte kurye masrafı sepeti ezer (150 TL'lik siparişte %47). Minimum sipariş tutarını
  (`min_order_cents`) 200–250 TL civarında tut.

## Sözleşmeye yazılacaklar

- Komisyon **"%X + KDV"** olarak yazılır. KDV içeriyorsa %10 net geliri %8,3'e düşürür.
- İptal/iade durumunda komisyonun alınıp alınmayacağı ve ödeme masrafının kime kalacağı.
- Restoranın kendi kampanya indiriminin komisyon tabanına etkisi.
- Lansman oranının bitiş tarihi ve sonraki oran.

## Lansman uygulaması (migration 044)

- Restoran oranı **%7** (kendi kuryesi olan restoranlar). `app_config.order_pricing` içindeki
  `restaurant_commission_rate_percent` 7 yapıldı, yönetici panelinden değişir.
- **Kuryesi olmayan işletmeler için %8**: satıcıya özel oran tablosu `seller_commission_rates` ile verilir.
  Kayıt varsa tür oranının yerine geçer, yoksa %7 uygulanır. Yalnızca yönetici yazar; satıcı yalnızca kendi
  oranını görür. Komisyon sipariş anında siparişe yazılır, sonradan oran değişince eski siparişler değişmez.

Satıcıya özel oran vermek için (Supabase SQL Editor):

```sql
INSERT INTO public.seller_commission_rates (seller_id, rate_percent, note)
VALUES ('<satici-id>', 8, 'lansman, kuryesi yok')
ON CONFLICT (seller_id) DO UPDATE SET rate_percent = EXCLUDED.rate_percent, note = EXCLUDED.note, updated_at = now();
```

Kaldırmak için: `DELETE FROM public.seller_commission_rates WHERE seller_id = '<satici-id>';`

### Dikkat: %8 yalnızca teslimat ücreti kurye maliyetini karşılıyorsa zarar ettirmez

Uygulamada platformun kurye atadığı bir akış **yoktur**: teslimatı hep satıcı yapar ve teslimat ücreti
satıcının hakkına yazılır. Kuryesi olmayan bir işletmenin siparişini platform karşılayacaksa:

- Kurye ücretini kimin ödediği ve kuryenin nasıl atandığı uygulama dışında yürür.
- %8 komisyon ancak müşteriden alınan teslimat ücreti kurye maliyetine yakınsa (bu notun 3. bölümü, 70 TL
  örneği) zarar yazmaz. Varsayılan 15 TL ücret ve 150 TL üstü ücretsiz teslimat ile her siparişte
  yaklaşık 50 TL zarar edilir.
- Satıcı bazında `sellers.delivery_fee_cents` ve `sellers.free_delivery_threshold_cents` ayarlanabilir;
  kuryesi olmayan işletme için ücreti kurye maliyetine yaklaştır, ücretsiz teslimat eşiğini yüksek tut.
- Teslimat ücretinin platformda kalması (kuryeyi platform ödüyorsa) hakediş hesabında henüz yok; o model
  istenirse ayrıca yazılmalı.

## Yapılacaklar

1. Lansman bitince (sözleşmede yazılı tarihte) restoran komisyonunu %7'den %10'a çıkar; satıcıya özel oranları gözden geçir.
2. iyzico'dan kendi komisyon oranını öğren, tablodaki 13 TL'yi gerçek rakamla değiştir.
3. Esnaf kurye için gerçek fiyat teklifi al, 70 TL'yi gerçek rakamla değiştir.
4. İlk 50 siparişten sonra gerçek iade oranı, kurye maliyeti ve ortalama sepetle yeniden hesapla.
