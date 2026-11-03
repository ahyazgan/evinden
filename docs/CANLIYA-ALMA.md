# Canlıya alma

Sıra önemlidir: önce veritabanı, sonra uygulama. Eski uygulama sürümü `013`'ten sonra sipariş veremez.

## 1. Veritabanı (Supabase)

Önce yedek al ve mümkünse ayrı bir test projesinde dene.

1. `005` ile gelen tabloların var olduğunu doğrula. `005`'teki `CREATE POLICY IF NOT EXISTS` Postgres'te geçersizdir; tablolar yoksa önce o satırı `CREATE POLICY` yapıp `005`'i çalıştır.
2. Çift yorum kontrolü. Sonuç dönerse fazla yorumları temizle, yoksa benzersiz indeks atlanır:
   ```sql
   SELECT order_id, count(*) FROM public.reviews WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1;
   ```
3. Dashboard > Database > Extensions altında `pg_net` ve `pg_cron` açık olmalıdır.
4. Şu dosyaları sırayla SQL Editor'da çalıştır: `013`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021`, `022`, `023`.
5. Satıcı hesaplarında `users.role='seller'` ve `is_approved=true` olduğunu kontrol et.
6. Mevcut satıcıların konumu yoktur: konum girene kadar teslimat alanı onlara uygulanmaz. Satıcılar profil ekranından konum ve teslimat ayarlarını girmelidir.

## 2. Online ödeme (iyzico)

Online ödeme varsayılan olarak **kapalıdır**; aşağıdakiler bitmeden açma. Kapalıyken uygulama kapıda ödemeyle sorunsuz çalışır.

1. **Sözleşme:** Başkası adına tahsilat yaptığın için iyzico ile **pazaryeri** çözümünü ve satıcılara ödeme sürecini netleştir; bir hukukçu ve mali müşavire danış. Bu kod ödemeyi tek üye iş yeri olarak alır, satıcılara aktarımı yapmaz.
2. **T.C. kimlik:** Uygulama kimlik numarası toplamıyor, iyzico örneğindeki yer tutucuyu gönderiyor. Canlıda kabul edilip edilmediğini iyzico'ya sor.
3. Fonksiyonları yükle:
   ```bash
   npx supabase functions deploy payment-init
   npx supabase functions deploy payment-callback --no-verify-jwt
   npx supabase functions deploy payment-refund
   ```
4. Önce sandbox anahtarlarını tanımla:
   ```bash
   npx supabase secrets set IYZICO_API_KEY=... IYZICO_SECRET_KEY=... IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
   ```
5. Yönetici paneli > Ayarlar > Online Ödeme'yi aç, test kartıyla şunları dene: başarılı ödeme, başarısız ödeme, ödeme sayfasını kapatma, ödenmiş siparişi iptal edip parayı iade etme.
6. Canlı anahtarları ve `IYZICO_BASE_URL=https://api.iyzipay.com` değerini tanımla.

Dolandırıcılık incelemesindeki ödemeler (`fraudStatus=0`) ödenmiş sayılmaz. Bu durumda sipariş 20 dakika sonra iptal olur; çekim gerçekleştiyse `order_payments.last_error` kaydına bakıp iyzico panelinden işlem yap.

## 3. Gerçek Supabase'de denenecekler

Yerel testler bunları sınayamaz:

- Hesap silme `auth.users` kaydını siliyor mu, silinen hesapla giriş reddediliyor mu?
- Başka bir kullanıcı `seller-documents` deposundaki belgeyi açamıyor mu, admin açabiliyor mu?
- Hesap silinince fotoğraf ve belgeler siliniyor mu?
- Fiyat değiştirince sepette "Tutar güncellendi" uyarısı çıkıyor mu?
- Sipariş durumu değişince müşterinin telefonuna push geliyor mu?
- Ödemesi tamamlanmayan sipariş 20 dakikada iptal oluyor mu (`023`)?

## 4. Uygulama (EAS)

1. `eas init` ile `app.json`'a `extra.eas.projectId` ekle. Bu olmadan push token alınamaz.
2. EAS ortamına `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` ekle.
3. `eas build --profile production --platform all`, ardından `eas submit`.
4. Cihazda dene: mağaza değerlendirme penceresi, adres ve konum bulma, ödeme sayfasından uygulamaya dönüş.

## 5. Tanıtım sayfası

`evinden_landing.html` dosyasını yayınla. Rakip komisyon karşılaştırmasındaki %28 ve %25 değerlerinin güncel olduğunu doğrula.
