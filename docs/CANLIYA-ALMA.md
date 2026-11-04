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
4. Şu dosyaları sırayla SQL Editor'da çalıştır: `013`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021`, `022`, `024`, `025`, `026`, `027`, `028`, `029`, `030`, `031`. `023` online ödemeyi açarken çalıştırılır (bölüm 2). Sıra korunmalı; `023` sonradan çalıştırılabilir, `028`, `029`, `030`, `031`.
5. Satıcı hesaplarında `users.role='seller'` ve `is_approved=true` olduğunu kontrol et.
6. Dashboard > Database > Publications altında `supabase_realtime` yayınında `orders`, `messages`, `conversations` görünmelidir (`025` ekler). Canlı sipariş ve mesaj güncellemesi buna bağlıdır.
7. Mevcut satıcıların konumu yoktur: konum girene kadar teslimat alanı onlara uygulanmaz. Satıcılar profil ekranından konum ve teslimat ayarlarını girmelidir.
8. Dashboard > Authentication > URL Configuration > Redirect URLs listesine `evinden://reset-password` eklenir. Eklenmezse şifre sıfırlama bağlantısı uygulamaya dönmez.

## 2. Online ödeme (iyzico)

Online ödeme varsayılan olarak **kapalıdır**; aşağıdakiler bitmeden açma. Kapalıyken uygulama kapıda ödemeyle sorunsuz çalışır.

1. **Sözleşme:** Başkası adına tahsilat yaptığın için iyzico ile **pazaryeri** çözümünü ve satıcılara ödeme sürecini netleştir; bir hukukçu ve mali müşavire danış. Bu kod ödemeyi tek üye iş yeri olarak alır, satıcılara aktarımı yapmaz.
2. **T.C. kimlik:** Uygulama kimlik numarası toplamıyor, iyzico örneğindeki yer tutucuyu gönderiyor. Canlıda kabul edilip edilmediğini iyzico'ya sor.
3. Fonksiyonları yükle:
   ```bash
   npx supabase functions deploy payment-init
   npx supabase functions deploy payment-callback --no-verify-jwt
   npx supabase functions deploy payment-refund
   npx supabase functions deploy payment-reconcile --no-verify-jwt
   ```
4. Önce sandbox anahtarlarını tanımla:
   ```bash
   npx supabase secrets set IYZICO_API_KEY=... IYZICO_SECRET_KEY=... IYZICO_BASE_URL=https://sandbox-api.iyzipay.com CRON_SECRET=<uzun rastgele değer>
   ```
5. `023`'ü çalıştır, ardından mutabakat görevini bağla (aynı `CRON_SECRET`, proje adresinle):
   ```sql
   INSERT INTO public.internal_settings (key, value) VALUES
     ('reconcile_url', 'https://<proje>.supabase.co/functions/v1/payment-reconcile'),
     ('cron_secret', '<uzun rastgele değer>');
   ```
6. Yönetici paneli > Ayarlar > Online Ödeme'yi aç, test kartıyla şunları dene: başarılı ödeme, başarısız ödeme, ödeme sayfasını kapatma, ödenmiş siparişi iptal edip parayı iade etme. Geri çağrı adresini geçici olarak bozup ödeme yaparak mutabakatın parayı 5 dakikada bulduğunu da doğrula.
7. Canlı anahtarları ve `IYZICO_BASE_URL=https://api.iyzipay.com` değerini tanımla.

**Ödeme güvencesi:** Ödeme sayfası açılmış her sipariş 72 saat boyunca iyzico'dan yeniden sorgulanır. Çekim yapılmış ama sipariş kapanmışsa para otomatik olarak iade kuyruğuna girer ve yöneticilere bildirim gider. İade düğmesi yönetici paneli > Siparişler > İade Talepleri'ndedir. Dolandırıcılık incelemesindeki ödeme (`fraudStatus=0`) sipariş sayılmaz; onaylanırsa iade kuyruğuna girer.

## 3. Gerçek Supabase'de denenecekler

Yerel testler bunları sınayamaz:

- Hesap silme `auth.users` kaydını siliyor mu, silinen hesapla giriş reddediliyor mu?
- Başka bir kullanıcı `seller-documents` deposundaki belgeyi açamıyor mu, admin açabiliyor mu?
- Hesap silinince fotoğraf ve belgeler siliniyor mu?
- Fiyat değiştirince sepette "Tutar güncellendi" uyarısı çıkıyor mu?
- Sipariş durumu değişince müşterinin telefonuna push geliyor mu?
- Ödemesi tamamlanmayan sipariş 30 dakikada iptal oluyor mu (`023`)?
- Şifre sıfırlama: Girişte Şifremi unuttum, e-postadaki bağlantı telefonda uygulamayı açıyor, yeni şifre çalışıyor.
- Cevapsız sipariş: 10. dakikada satıcıya hatırlatma, 30. dakikada iptal ve (online ödemede) iade başlıyor.
- Satıcı siparişte müşterinin adını ve telefonunu görüyor; teslimden sonra telefon kapanıyor.

## 4. Uygulama (EAS)

1. `eas init` ile `app.json`'a `extra.eas.projectId` ekle. Bu olmadan push token alınamaz.
2. EAS ortamına `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` ekle.
   Hata takibi için sentry.io'da ücretsiz React Native projesi açıp DSN değerini `EXPO_PUBLIC_SENTRY_DSN` olarak ekle. Eklenmezse uygulama çalışır, yalnızca hata kaydı gönderilmez.
   Okunabilir hata satırları için sonradan: `SENTRY_ORG`, `SENTRY_PROJECT` ve `SENTRY_AUTH_TOKEN` ekle, `eas.json`'daki `SENTRY_DISABLE_AUTO_UPLOAD` satırlarını kaldır.
3. `eas build --profile production --platform all`, ardından `eas submit`.
4. Cihazda dene: mağaza değerlendirme penceresi, adres ve konum bulma, ödeme sayfasından uygulamaya dönüş.

## 5. Satıcı ödemeleri

Yönetici panelinde "Satıcılara Ödenecek" kartından Satıcı Ödemeleri ekranı açılır. Ekran parayı göndermez: havaleyi bankadan yap, sonra "Hesap kesimini kaydet" ile işle. Nakit ve kapıda kart siparişlerinde para satıcıdadır, bu yüzden bakiye çoğunlukla satıcıdan alınacak komisyondur.

`024` çalıştığında daha önce teslim edilmiş tüm siparişler ilk hesap kesimine girer. Veritabanında uygulama dışında ödenmiş gerçek siparişler varsa önce onları ayıkla.

Nakit siparişte iade onaylandığında parayı müşteriye satıcı verir; uygulama bu ödemeyi izlemez, yalnızca siparişi kazançtan düşer.

Satıcı sözleşmesinin 5. maddesi bu akışa göre güncellendi; yayınlamadan önce hukukçuya gösterilmeli.

## 6. Tanıtım sayfası

`evinden_landing.html` dosyasını yayınla. Rakip komisyon karşılaştırmasındaki %28 ve %25 değerlerinin güncel olduğunu doğrula.

## 7. Yasal metinler ve telefon doğrulama

- `constants/business.ts` içindeki `PLATFORM_LEGAL` alanlarını (unvan, adres, vergi numarası) doldur. Boş alanlar sözleşmede görünmez.
- `app/(customer)/sales-terms.tsx` taslaktır: ön bilgilendirme, mesafeli satış sözleşmesi ve cayma hakkı metnini hukukçuya göster. Metin değişince `SALES_TERMS_VERSION` artır; her sipariş onaylanan sürümle kaydedilir.
- Telefon doğrulama kapalı gelir. Önce Supabase > Authentication > Providers > Phone bölümünde SMS sağlayıcısını kur, deneme numarasıyla kod geldiğini gör, sonra Yönetici > Ayarlar > Telefon doğrulama anahtarını aç.
