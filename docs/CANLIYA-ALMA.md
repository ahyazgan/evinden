# Canlıya alma

Sıra önemlidir: önce veritabanı, sonra uygulama. Eski uygulama sürümü `013`'ten sonra sipariş veremez.

## 1. Veritabanı (Supabase)

Önce yedek al ve mümkünse ayrı bir test projesinde dene.

1. `005` ile gelen tabloların var olduğunu doğrula. `005`'teki `CREATE POLICY IF NOT EXISTS` Postgres'te geçersizdir; tablolar yoksa önce o satırı `CREATE POLICY` yapıp `005`'i çalıştır.
2. Çift yorum kontrolü. Sonuç dönerse fazla yorumları temizle, yoksa benzersiz indeks atlanır:
   ```sql
   SELECT order_id, count(*) FROM public.reviews WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1;
   ```
3. Şu dosyaları sırayla SQL Editor'da çalıştır: `013`, `014`, `015`, `016`, `017`, `018`, `019`.
   `019` için Dashboard > Database > Extensions altında `pg_net` açık olmalıdır.
4. Satıcı hesaplarında `users.role='seller'` ve `is_approved=true` olduğunu kontrol et.

## 2. Gerçek Supabase'de denenecekler

Yerel testler bunları sınayamaz:

- Hesap silme `auth.users` kaydını siliyor mu, silinen hesapla giriş reddediliyor mu?
- Başka bir kullanıcı `seller-documents` deposundaki belgeyi açamıyor mu, admin açabiliyor mu?
- Hesap silinince fotoğraf ve belgeler siliniyor mu?
- Fiyat değiştirince sepette "Tutar güncellendi" uyarısı çıkıyor mu?
- Sipariş durumu değişince müşterinin telefonuna push geliyor mu?

## 3. Uygulama (EAS)

1. `eas init` ile `app.json`'a `extra.eas.projectId` ekle. Bu olmadan push token alınamaz.
2. EAS ortamına `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` ekle.
3. `eas build --profile production --platform all`, ardından `eas submit`.
4. Mağaza değerlendirme penceresini cihazda bir kez dene.

## 4. Tanıtım sayfası

`evinden_landing.html` dosyasını yayınla. Rakip komisyon karşılaştırmasındaki %28 ve %25 değerlerinin güncel olduğunu doğrula.
