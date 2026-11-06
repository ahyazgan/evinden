# Fatura modeli

Afiyetli, büyük yemek platformlarındaki pazar yeri modelini kullanır (053). İki ayrı fatura akışı vardır.

## 1. Yemeğin faturası: restoran keser

Satıcı restorandır; yemeğin faturasını kendi adına, kendi e-fatura veya e-arşiv sisteminden (muhasebe programı,
özel entegratör veya GİB portalı) keser. Bireysel müşterinin faturası/fişi restoranın kendi yükümlülüğüdür; uygulama
yalnızca **kurumsal fatura** isteyen müşterinin bilgisini restorana taşır.

1. Müşteri bilgilerini bir kez kaydeder: Profil > Kurumsal fatura (unvan, vergi dairesi, VKN/TCKN, adres, e-posta).
2. Faturayı ister:
   - Sepette "… adına fatura istiyorum" kutusunu işaretleyerek, veya
   - teslimden sonraki 30 gün içinde Profil > Kurumsal fatura ekranından.
   İptal veya iade edilen siparişe fatura istenemez.
3. Restorana bildirim gider. Restoran faturayı keser ve şunları yapar:
   - Restoran paneli > Gecikme ve fatura > Faturalar ekranında numarayı yazar.
   - İsterse PDF'i veya fotoğrafı ekler (en fazla 5 MB).
   - Sipariş detayında "Kurumsal fatura" satırı da bu ekrana götürür.
4. Müşteriye "Faturan kesildi" bildirimi gider. Müşteri numarayı görür, belgeyi açabilir.

**İptal ve iade:**
- Fatura kesilmeden sipariş iptal edilirse talep kendiliğinden kapanır.
- Fatura kesildikten sonra iadesi onaylanırsa (veya para iadesi başlarsa) restorana "Faturanı düzelt" bildirimi gider.
- Restoran faturayı kendi sisteminde düzeltir:
  - e-Arşiv faturayı iptal eder, veya
  - alıcı e-fatura kullanıcısıysa ondan iade faturası ister ya da GİB portalından iptal eder.
- Sonra "Düzeltmeyi yaptım" ile kısa bir not yazar.

Yönetici kokpitinde "Kesilmemiş müşteri faturası" kartı, teslimden 48 saat sonra hâlâ kesilmemiş talepleri sayar.

Belgeler özel `order-invoices` kovasında `<restoran kullanıcısı>/<sipariş>/<dosya>` yolunda durur. Restoran yükler;
restoran, siparişin müşterisi ve yönetici okuyabilir.

## 2. Komisyon faturası: platform keser

Platform her restorana ayda bir hizmet (komisyon) faturası keser.

1. Ay kapandıktan sonra Yönetim > Komisyon faturaları ekranında ayı seç ve "Dökümü oluştur"a bas.
2. Her restoran için taslak çıkar:
   - O ay (İstanbul saatiyle) teslim edilip iade edilmemiş siparişlerin komisyonu.
   - Komisyon KDV hariçtir; KDV üstüne eklenir. Oran `app_config.commission_invoice.tax_rate_bps`, varsayılan %20.
3. Faturayı muhasebe veya e-fatura sisteminden kes, numarasını "Kestim, numarayı gir" ile işle.
4. Restoran panelinde görür ve bildirim alır. Taslak restorana görünmez.

**Kesilmiş ayda sonradan iade edilen sipariş:**
- Komisyonu sonraki ayın dökümünde eksi satır olarak düşer, bir kez.
- Bir ayın toplamı sıfır veya eksi çıkarsa fatura kesilemez; o ay için iade faturası gerekir (mali müşavire danış).

Döküm yeniden hesaplanabilir; kesilmiş faturaya dokunulmaz.

## Mali müşavirle netleştirilecekler

- Komisyon faturasının KDV oranı (%20 varsayıldı) ve platform kuryesi kullanılan siparişlerde teslimat hizmetinin ayrı
  faturalanıp faturalanmayacağı.
- Aracı hizmet sağlayıcı olarak yükümlülükler (Elektronik Ticaret Kanunu, ETBİS bildirimi).
- Restoranlarla sözleşmeye "kurumsal fatura talebini 48 saat içinde kesme" yükümlülüğünün eklenmesi.

## Eski e-fatura modülü

`045`–`052` ile kurulan, faturayı restoran adına platformun entegratöründen gönderen modül
(`docs/GIB-EFATURA.md`) **kullanılmıyor ve kapalı kalır**. Tabloları veri kaybı olmasın diye silinmedi; yönetim
menüsünden kaldırıldı.
