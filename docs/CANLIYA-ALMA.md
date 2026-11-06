# Canlıya alma

Sıra önemlidir: önce veritabanı, sonra uygulama. Eski uygulama sürümü `013`'ten sonra sipariş veremez.

Ev aşçıları şimdilik askıda, uygulama yalnızca restoranlarla çalışır. Yeniden açmak için `constants/business.ts` içindeki `HOME_SELLERS_ENABLED` değerini `true` yap; listeler ve başvurudaki tür seçimi geri gelir, ekran metinleri ve `afiyetli_landing.html` ayrıca geri yazılır, `041`'deki `sellers_force_type_trg` tetikleyicisi de kaldırılır.

## 1. Veritabanı (Supabase)

Önce yedek al ve mümkünse ayrı bir test projesinde dene.

1. `005` ile gelen tabloların var olduğunu doğrula. `005`'teki `CREATE POLICY IF NOT EXISTS` Postgres'te geçersizdir; tablolar yoksa önce o satırı `CREATE POLICY` yapıp `005`'i çalıştır.
2. Çift yorum kontrolü. Sonuç dönerse fazla yorumları temizle, yoksa benzersiz indeks atlanır:
   ```sql
   SELECT order_id, count(*) FROM public.reviews WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1;
   ```
3. Dashboard > Database > Extensions altında `pg_net` ve `pg_cron` açık olmalıdır.
4. Şu dosyaları sırayla SQL Editor'da çalıştır: `013`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `021`, `022`, `024`, `025`, `026`, `027`, `028`, `029`, `030`, `031`, `032`, `033`, `034`, `035`, `036`, `037`, `038`, `039`, `040`, `041`, `042`, `043`, `044`, `045`, `046`, `047`, `048`, `049`, `050`, `051`, `052`, `053`, `054`. `023` online ödemeyi açarken çalıştırılır (bölüm 2). Sıra korunmalı; `023` sonradan çalıştırılabilir, `028`, `029`, `030`, `031`, `032`, `033`, `034`, `035`, `036`, `037`, `038`, `039`, `040`, `041`, `042`, `043`, `044`, `045`, `046`, `047`, `048`, `049`, `050`, `051`, `052`, `053`, `054`.
5. Satıcı hesaplarında `users.role='seller'` ve `is_approved=true` olduğunu kontrol et.
6. Dashboard > Database > Publications altında `supabase_realtime` yayınında `orders`, `messages`, `conversations` (`025` ekler) ve `order_courier_locations` (`032` ekler) görünmelidir. Canlı sipariş, mesaj ve kurye konumu güncellemesi buna bağlıdır.
7. Mevcut satıcıların konumu yoktur: konum girene kadar teslimat alanı onlara uygulanmaz. Satıcılar profil ekranından konum ve teslimat ayarlarını girmelidir.
8. `040` uygulamadan önce çalıştırılmalıdır: yeni uygulama satıcı sayfasında seçim gruplarını da okur, tablo yoksa menü açılmaz.
9. `038` sonrası hiçbir kullanıcının kampanya izni yoktur: kampanya duyurusu izin verene kadar kimseye gitmez, hizmet duyurusu herkese gider. Yeni sipariş alarmının sesi ve `new-orders` kanalı için yeni uygulama derlemesi gerekir (`expo-audio`, `app.json`).
10. Dashboard > Authentication > URL Configuration: Site URL web adresi olur (`https://afiyetli.ahyazgab.workers.dev`), Redirect URLs listesine `afiyetli://reset-password` ve `https://afiyetli.ahyazgab.workers.dev/reset-password` eklenir. Eklenmezse şifre sıfırlama bağlantısı uygulamaya dönmez. Sıfırlama isteği hangi cihazda yapıldıysa bağlantı da orada açılmalıdır.
11. Dashboard > Authentication > Providers > Email: en az 8 karakter şifre kuralını aç (uygulama da 8 ister). Authentication > SMTP: Supabase'in hazır e-postası saatte çok az gönderir; kayıt onayı ve şifre sıfırlama için kendi SMTP hesabını bağla.
12. **Telefon doğrulama açılana kadar platform destekli kuponlar kapalı kalır.** Her yeni e-posta yeni kupon demek olduğu için tohum kuponlar ve davet programı canlıda durduruldu. Telefon doğrulamayı açtıktan sonra yeniden aç:
    ```sql
    UPDATE public.coupons SET is_active = TRUE, expires_at = NULL WHERE code IN ('LEZZET20','LEZZET10','TATLI15','KAHVALTI25','UCRETSIZ');
    DELETE FROM public.app_config WHERE key = 'referral_program';
    ```
13. Sahte sipariş sınırları (`041`): platformun karşıladığı indirim aynı müşteri ve restoran için 30 günde bir kez kapıda kullanılır. Sipariş başına en çok ₺500 puan kazandırır, kapıda ödemede günde bir sipariş puan yazar. Satıcılara hesap kesimi öderken platform destekli siparişlere bak: kapıda paranın el değiştirdiği doğrulanamaz.

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
- Telefonla ilgili kupon ve davet kuralları (`035`, `037`) yalnızca doğrulanmış telefonda çalışır: telefon doğrulamayı açmadan etkisizdir. Kupon hakkı hesap silinince sıfırlanmaz: `coupon_phone_uses` numaranın kendisini değil, kupon ve numaranın özetini saklar. Eşikler `app_config.fraud_rules` içindedir, müşteriye görünmez. Kapıda ödeme sınırı (`door_active_limit`) saatine `door_active_horizon_hours` (2) saatten fazla olan planlı siparişi ve durumu `door_active_stale_hours` (12) saattir değişmeyen siparişi saymaz; unutulan sipariş kapatılmaz, yönetici canlı izlemede görür. Ölçüm olaylarını 180 günden sonra `029` görevi siler.
- Şifre sıfırlama: Girişte Şifremi unuttum, e-postadaki bağlantı telefonda uygulamayı açıyor, yeni şifre çalışıyor.
- Cevapsız sipariş: 10. dakikada satıcıya hatırlatma, 30. dakikada iptal ve (online ödemede) iade başlıyor.
- Satıcı siparişte müşterinin adını ve telefonunu görüyor; teslimden sonra telefon kapanıyor.

## Web sitesi

Cloudflare'de `afiyetli` projesi (https://afiyetli.ahyazgab.workers.dev). Yayınlamak için:

```bash
node scripts/build-web.cjs
npx wrangler deploy
```

Uygulama kökte, tanıtım sayfası `/tanitim`, mağazaların istediği sayfalar `/privacy` ve `/hesap-silme`. Güvenlik başlıkları `public/_headers` içindedir; yeni bir dış servis eklenirse oradaki izin listesine de yazılır. Alan adı alınınca projeye bağlanır, `SITE_URL` ile birlikte `public/index.html` ve `afiyetli_landing.html` güncellenir. `destek@afiyetli.app` adresi alan adı alınmadan çalışmaz, uygulamada ve yasal metinlerde bu adres yazılıdır.

## 4. Uygulama (EAS)

1. Expo projesi bağlıdır (`@ahyazgan/afiyetli`). Deneme için: `npx eas-cli build --platform android --profile preview`.
2. Supabase adresi ve herkese açık anahtar derlemeye `.env` dosyasından gider (`.easignore` bunun için vardır). Android bildirimleri için Expo projesine Firebase FCM anahtarı eklenmelidir.
   Hata takibi için sentry.io'da ücretsiz React Native projesi açıp DSN değerini `EXPO_PUBLIC_SENTRY_DSN` olarak ekle. Eklenmezse uygulama çalışır, yalnızca hata kaydı gönderilmez.
   Okunabilir hata satırları için sonradan: `SENTRY_ORG`, `SENTRY_PROJECT` ve `SENTRY_AUTH_TOKEN` ekle, `eas.json`'daki `SENTRY_DISABLE_AUTO_UPLOAD` satırlarını kaldır.
3. `eas build --profile production --platform all`, ardından `eas submit`. iOS için Apple Developer hesabı, gönderim için `eas.json` içinde `submit` bilgileri gerekir.
4. Cihazda dene: mağaza değerlendirme penceresi, adres ve konum bulma, ödeme sayfasından uygulamaya dönüş.

## Canlı kurye haritası

Sipariş "Yola çıktı" olunca satıcı uygulaması telefonun konumunu gönderir, müşteri takip ekranında görür. Konum geçmişi tutulmaz; teslim, iptal veya "Paylaşımı durdur" ile satır silinir. 6 saat güncellenmeyen satırı da `029` görevi siler (`037`).

- **iOS:** Apple Haritalar kullanılır, anahtar gerekmez.
- **Android:** Google Maps API anahtarı gerekir. Google Cloud Console'da "Maps SDK for Android" için anahtar al, `app.json` içinde `android.config.googleMaps.apiKey` alanına yaz, `extra.androidGoogleMapsReady` değerini `true` yap, yeni build al. İkisi birlikte değişmeli: anahtarsız MapView uygulamayı kapatır, bu yüzden değer `false` iken Android müşteri harita yerine yazı ve "Haritada aç" bağlantısı görür.
- **Web:** Harita çizilmez, yazı ve OpenStreetMap bağlantısı gösterilir. Teslimat noktası cihazda adresten bulunduğu için webde mesafe yazılmaz.
- **Konum izni metinleri** `app.json` içindedir, yalnızca ön plan konumu kullanılır. Kurye uygulamadan çıkarsa ya da telefon kilitlenirse paylaşım durur; arka plan takibi mağaza incelemesinde ayrı gerekçe ister, eklenmedi.
- **Telefonda dene:** Satıcı hesabıyla sipariş ilerlet, "Yola çıktı" de, izni ver, yürü. Müşteri telefonunda haritadaki işaretin ve "Kurye 1,2 km uzakta · 20 sn önce" satırının güncellendiğini gör. Satıcı uygulamasını kapat, 2 dakika sonra "güncel değil" yazısını gör. "Teslim edildi" de, satırın silindiğini doğrula.

## 5. Satıcı ödemeleri

Yönetici panelinde "Satıcılara Ödenecek" kartından Satıcı Ödemeleri ekranı açılır. Ekran parayı göndermez: havaleyi bankadan yap, sonra "Hesap kesimini kaydet" ile işle. "Ödeme listesi" düğmesi, platformun borçlu olduğu satıcıları IBAN ve tutarıyla CSV olarak verir (web'de iner, telefonda paylaşılır); dosyada IBAN olduğu için güvenli yerde tut. Nakit ve kapıda kart siparişlerinde para satıcıdadır, bu yüzden bakiye çoğunlukla satıcıdan alınacak komisyondur.

`024` çalıştığında daha önce teslim edilmiş tüm siparişler ilk hesap kesimine girer. Veritabanında uygulama dışında ödenmiş gerçek siparişler varsa önce onları ayıkla.

Nakit siparişte iade onaylandığında parayı müşteriye satıcı verir; uygulama bu ödemeyi izlemez, yalnızca siparişi kazançtan düşer.

Satıcı sözleşmesinin 5. maddesi bu akışa göre güncellendi; yayınlamadan önce hukukçuya gösterilmeli.

## Otomatik satıcı ödemesi

> **Uyarı: bu akış iyzico'ya karşı hiç çalıştırılmadı.** Pazaryeri sözleşmesi olmadığı için yalnızca iyzico belgelerine ve sahte iyzico yanıtlı testlere dayanıyor. Sandbox'ta aşağıdaki denemelerin tamamı geçmeden canlıda açma. Anahtar kapalıyken (`036` böyle gelir) bugünkü elle ödeme akışı hiç değişmez.

Açıkken para şöyle yürür: ödeme iyzico'da korumalı havuzda bekler, sipariş teslim edildikten sonra bekletme süresi (varsayılan 24 saat, `054`) dolunca `payment-approve` onay verir, iyzico satıcının payını IBAN'ına, kalanı platforma gönderir. Bekletme süresinde açılan iade talebi onayı durdurur; para restorana geçmeden iade edilebilir. Süre Satıcı Ödemeleri > Ödeme takvimi'nden değişir. Satıcının payı `order_net_cents` ile aynıdır: komisyon platformda kalır, bahşişin tamamı restoranındır. iyzico'nun işlem ücreti platform payından düşer.

**Sandbox'ta mutlaka dene, büyük bahşiş:** Bahşişten komisyon alınmaz ama iyzico'nun ücreti bahşişi de içeren toplam üzerinden kesiliyorsa, küçük tutarlı siparişte yüksek bahşiş ücreti platform payının üstüne çıkarabilir. Kodda ücret oranı varsayılmadı; `computeMarketplaceSplit` yalnızca platform payının sıfırdan büyük olmasına bakar. Küçük sipariş ve en yüksek bahşişle (₺500) ödeme alıp iyzico panelinde ne kesildiğine ve iyzico'nun bu durumda ne döndürdüğüne bak. Pay ücrete yetmiyorsa açmadan önce kural eklenmeli.

**Haftalık hesap kesimi (`054`):**
- **Ne zaman:** Dönem kesim gününün (varsayılan pazartesi) 00:00'ında biter. Bekletme süresi dolunca kesilir; 24 saat bekletmeyle salı 06:00. `weekly-settlement` görevi her gün 06:00'da çalışır, her restoran için hesap kesimi açar ve `pg_cron` ile `054` içinde kurulur.
- **İlk kesim:** Yükleme anında kapanmış dönem kesilmiş sayılır; ilk otomatik kesim bir sonraki dönemde yapılır ve o zamana kadarki tüm açık bakiyeyi kapsar.
- **Kesime giren siparişler:**
  - Dönem sonuna kadar teslim edilmiş siparişler (pazar akşamı dahil).
  - Önceden kesilip sonradan iade edilen siparişlerin ters kaydı.
  - İade incelemesindeki sipariş beklemede kalır.
- **Nasıl hesaplanır:** Kapıda ödenen siparişin komisyonu, online alacaktan düşülür. Sonuç ya restorana ödenecek tutar ya da restorandan alınacak komisyondur.
- **Ödeme:** Kesim "ödeme bekliyor" olarak açılır ve restorana bildirim gider.
  - Satıcı Ödemeleri > Ödeme bekleyen kesimler'de havale listesini (CSV) indir, havaleyi yap.
  - "Havale yapıldı" ile işaretle; restorana "Ödemen gönderildi" bildirimi gider.
  - Havaleden önce kesimdeki bir siparişin iadesi onaylanırsa sipariş kesimden çıkar ve tutar düşer. Eski tutarla işaretleme reddedilir, ekran güncel tutarı gösterir.
  - Ödenmemiş kesimi olan restoran hesabını silemez.
- **Görev çalışmadıysa:** "Kesimi şimdi çalıştır" son dönemi keser. Aynı dönem iki kez kesilmez.
- **Elle kesim:** Beklemeden ödeme gerekiyorsa "Henüz kesilmemiş bakiyeler"den elle kesim eskisi gibi yapılır.
- **Kontrol:** Görevin kurulduğunu şu sorguyla gör:
  ```sql
  SELECT jobname, schedule FROM cron.job WHERE jobname = 'weekly-settlement';
  ```

**Elle kalanlar:**
- Kapıda ödenen siparişlerin (nakit, kart, yemek kartı) komisyonu haftalık kesimde restorandan alınacak tutar olarak çıkar; tahsilatı sen yaparsın.
- iyzico kaydı olmayan satıcının online siparişleri ve platform kuponu yüzünden satıcı payının sepet tutarını aştığı siparişler. Bunlar `LISTING` ile alınır, para platforma gelir, satıcıya havale ile ödenir (`order_payments.fallback_reason` nedenini söyler).
- Onayı geri çekilemeyen iade. Para satıcıya geçmiş olabilir: iyzico panelinden bak, müşteriye panelden iade edip "iade edildi" olarak işaretle. Önce "İade Et"i en az bir kez dene: iyzico onaylı dediyse sipariş o denemede onaylı olarak kaydedilir (`037`), satıcının payı da işaretleyince hesap kesiminde ondan alınacak borç olarak görünür. iyzico'ya hiç ulaşılamadıysa kayıt "bekliyor" kalır ve borç doğmaz: durum sorgusu cevap verene kadar işaretleme.

**Adımlar:**

1. **Sözleşme:** iyzico ile pazaryeri sözleşmesi aç (entegrasyon için entegrasyon@iyzico.com, hesap için destek@iyzico.com). Sandbox hesabının da pazaryeri olarak tanımlanmasını iste.
2. **Mali müşavir, stopaj:** iyzico'nun [stopaj sayfasına](https://docs.iyzico.com/urunler/pazaryeri/pazaryeri-entegrasyonu/pazaryerlerinde-stopaj-uygulamasi) göre 6563 sayılı Kanun kapsamındaki aracı, alt satıcıya yaptığı ödemelerde KDV hariç net satış tutarının %1'i kadar stopajı kendisi hesaplayıp hakedişten düşer. iyzico hesap yapmaz, `withholdingTax` alanı yalnızca rapor içindir. **Kodda stopaj yoktur**, `subMerchantPrice` stopajsız gider. Kapsamda olup olmadığını ve elle ödemede de geçerli olup olmadığını müşavirine sor; kapsamdaysan açmadan önce bu hesap eklenmeli.
3. **Hukuk:** satıcı sözleşmesinin 5. maddesi ve KVKK aydınlatma metni, yetkilinin T.C. kimlik numarasının iyzico'ya aktarılmasını anlatacak şekilde güncellenmeli.
4. `036`'yı çalıştır (bölüm 1). pg_cron açıksa `payment-approve` görevi kendiliğinden kurulur, değilse sonradan ekle:
   ```sql
   SELECT cron.schedule('payment-approve', '*/5 * * * *', 'SELECT public.run_payment_approve()');
   ```
5. Fonksiyonları yükle. Yeni gizli değer yok, bölüm 2'deki iyzico anahtarları ve `CRON_SECRET` kullanılır. Değişen ortak kod yüzünden diğerleri de yeniden yüklenir:
   ```bash
   npx supabase functions deploy submerchant-sync
   npx supabase functions deploy payment-approve --no-verify-jwt
   npx supabase functions deploy payment-init
   npx supabase functions deploy payment-callback --no-verify-jwt
   npx supabase functions deploy payment-refund
   npx supabase functions deploy payment-reconcile --no-verify-jwt
   ```
6. Onay görevini bağla (aynı `CRON_SECRET`, proje adresinle):
   ```sql
   INSERT INTO public.internal_settings (key, value) VALUES
     ('approve_url', 'https://<proje>.supabase.co/functions/v1/payment-approve')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```
7. **Sandbox'ta dene.** `IYZICO_BASE_URL` sandbox iken anahtarı aç:
   ```sql
   UPDATE public.app_config SET value = '{"enabled": true}' WHERE key = 'iyzico_marketplace';
   ```
   Bir test restoranıyla sırayla doğrula: profil ekranında şirket bilgisi ve IBAN gir, Satıcı Ödemeleri'nden "iyzico'ya kaydet" (anahtar dönmeli); online sipariş ver ve `order_payments.marketplace` doğru mu bak; iyzico panelinde tutar ve alt üye payı doğru mu; teslim et, en geç 5 dakikada kırılım onaylı olmalı (`transactionStatus` 2) ve Satıcı Ödemeleri'nde bu sipariş görünmemeli; teslimden önce iptal edip iade; onaydan sonra iade (önce onay geri çekilmeli); onaylı siparişte iyzico'nun gerçekte ne döndürdüğü; kaydı olmayan satıcıda `LISTING` ödemesi; IBAN'ı değiştirip "güncelle"; bahşişli ve kuponlu sipariş; küçük siparişte en yüksek bahşiş (yukarıdaki not).
8. **Canlıya geçiş:** hesap pazaryeri olarak tanımlandığı andan itibaren anahtarsız `PRODUCT` ödemesi 5077 hatası verir (belge). Yani canlı hesap dönüştüğünde anahtar **aynı anda** açılmalı, yoksa online ödeme durur. Bu anı iyzico ile planla. Sipariş almadan önce satıcıları kaydet.
9. Kapatmak için aynı sorguyu `false` ile çalıştır. Yeni siparişler bugünkü akışa döner, sıradaki onaylar işlenmeye devam eder. Hesap pazaryeri olarak kaldıysa kapalı akış da 5077 alır, iyzico'ya sor.

**İzleme:** Satıcı Ödemeleri ekranının altında, anahtar açıkken satıcıların kayıt durumu ve parası iyzico'da bekleyen siparişler görünür. On denemede onay alamayan veya tutarı uyuşmayan sipariş burada "Onay başarısız" olarak kalır, satıcıya para gitmez.

## 5.1 Kurumsal operasyonlar (SLA, e-fatura, iade, mutabakat)

- `045`–`052` migration'ları SLA motorunu, karar raporlarını, e-fatura/iade/mutabakat tablolarını, yönetici operasyon özetini ve pazar yeri operasyon temellerini (ürün değişikliği onayı, destek konuşması, fotoğraflı iade, kalite skoru) kurar. `052` restoranın kendi gecikme ve fatura kaydını açar, iade kararını tek yola indirir, mutabakatı ödeme tarihine çevirir ve iade edilen siparişin faturası için düzeltme akışı ekler. Hepsini sırayla, aynı oturumda çalıştır; `048` çalışmadan zamanlanmış görev yeni motora bağlanmaz.
- **SLA:** Görev mevcut `expire-pending-orders` cron'unda çalışır. Bekleyen sipariş eskisi gibi 10. dakikada hatırlatılır, 30. dakikada iptal edilir; bu, SLA kapalı olsa da çalışır. SLA açıkken ek olarak ihlal kaydı tutulur.
  - Varsayılan kural yalnızca kayıt tutar: hazırlanmaya 90 dakikada başlanmayan sipariş iptal edilmez, ihlal olarak yazılır; ceza tutarı 0 TL'dir.
  - "Siparişi iptal et" seçilirse hazırlama eşiği en az 90 dakika olmalıdır (restoran 60 dakikaya kadar hazırlık süresi seçebilir). Planlı siparişte süre planlanan saatten başlar.
  - SLA cezası hakedişten kendiliğinden düşülmez; "Tahsil edildi" yalnızca kayıttır.
- **Restoran:** Restoran panelinde "Gecikme ve fatura" ekranı kendi SLA kayıtlarını, cezalarını ve yönetim notunu; kurumsal fatura taleplerini ve platformun kestiği komisyon faturalarını gösterir.
- **İade:** Karar yalnızca `admin_decide_refund_case` / `admin_decide_refund` ile verilir; Siparişler ekranındaki onay/ret düğmeleri de bu yolu kullanır, sipariş tablosuna doğrudan karar yazılamaz. Kısmi iade yoktur; onay tutarın tamamı içindir. Yemek kartı ve kapıda kart dahil tüm ödeme yöntemlerinde iade talebi açılabilir. Hesabını silen müşterinin fatura ve iade kayıtları müşteri bağı kopmuş olarak kalır.
- **Mutabakat:** Beklenen tutar, iyzico/banka dökümü gibi para hareketinin tarihine göre hesaplanır: dönemde ödemesi alınan online siparişler eksi dönemde parası iade edilenler. Ay sonunda alınıp ertesi ay iade edilen sipariş ilk ayda tahsilat, ikinci ayda iade olarak görünür. iyzico komisyonu dahil değildir, fark kırılımında açıklanmalıdır.
- **Fatura (053):** Pazar yeri modeli kullanılır, ayrıntısı `docs/FATURA.md` içinde:
  - Yemeğin faturasını restoran kendi e-fatura/e-arşiv sisteminden keser. Müşteri sepette veya Profil > Kurumsal fatura ekranından ister; restoran numarayı (ve isterse PDF'i) Gecikme ve fatura ekranına işler.
  - Platform her restorana aylık komisyon faturası keser (Yönetim > Komisyon faturaları).
  - 046'daki platform adına e-fatura modülü kapalı kalır, açılmaz.
- **Uygulama:** Bu makinedeki Supabase CLI başka hesaba bağlı olduğundan migration'ları SQL Editor'dan çalıştır: `045`, `046`, `047`, `048`, `049`, `050`, `051`, `052`, `053`, `054`. E-fatura açılacağı zaman Edge Function'ları Afiyetli projesine erişimi olan bir oturumla yükle:
  ```bash
  npx supabase functions deploy einvoice-submit --project-ref <SUPABASE_PROJECT_REF>
  npx supabase functions deploy einvoice-status --project-ref <SUPABASE_PROJECT_REF>
  ```
- Yönetici kokpitindeki operasyon kartları `admin_operations_overview` RPC'sini kullanır. Faturalar önce taslak oluşur, detay ekranında onaylandıktan sonra sağlayıcıya gönderilir; toplu işlem (`admin_create_invoices`) yalnızca kayıtlı kurumsal profillerden taslak üretir.

## 6. Tanıtım sayfası

`afiyetli_landing.html` web yayınıyla `/tanitim` adresine çıkar.

## 7. Yasal metinler ve telefon doğrulama

- `constants/business.ts` içindeki `PLATFORM_LEGAL` alanlarını (unvan, adres, vergi numarası) doldur. Boş alanlar sözleşmede görünmez.
- `app/(customer)/sales-terms.tsx` taslaktır: ön bilgilendirme, mesafeli satış sözleşmesi ve cayma hakkı metnini hukukçuya göster. Metin değişince `SALES_TERMS_VERSION` artır; her sipariş onaylanan sürümle kaydedilir.
- Google ve Apple girişi şu an kapalıdır, düğmeler görünmez. Açmak için Supabase'de sağlayıcıları tanımla, `afiyetli://auth/callback` adresini Redirect URLs listesine ekle, `constants/business.ts` içinde `SOCIAL_LOGIN_ENABLED` değerini `true` yap. Apple, hesap silinince Apple jetonunun geri alınmasını ister; bu henüz yazılmadı, Apple'ı açmadan önce eklenmeli.
- Telefon doğrulama kapalı gelir. Önce Supabase > Authentication > Providers > Phone bölümünde SMS sağlayıcısını kur, deneme numarasıyla kod geldiğini gör, sonra Yönetici > Ayarlar > Telefon doğrulama anahtarını aç.
