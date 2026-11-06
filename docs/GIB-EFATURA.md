# GİB e-fatura entegrasyonu

Afiyetli faturayı GİB'e doğrudan değil, **yetkili bir e-fatura sağlayıcısı (özel entegratör) üzerinden UBL-TR 2.1 XML**
göndererek keser. Sağlayıcı seçimi, sözleşmesi ve anahtarı üretim ortamında verilir.

**Durum:** E-fatura varsayılan olarak **kapalıdır** (`einvoice_policy.enabled = false`). Kapalıyken müşteri menüsünde
"Kurumsal fatura" görünmez; müşteri talep açamaz, yönetici fatura kesemez veya gönderemez.

## Açmadan önce yapılacaklar

1. Bir özel entegratör seç ve test (sandbox) hesabı al.
2. Mali müşavirle şunları doğrula:
   - Faturayı kim keser: restoran mı, platform mu? Şu an belge **restoran adına** (satıcı = restoran) hazırlanıyor ve
     platformun sağlayıcı hesabından gönderiliyor. Bu yapının (aracı hizmet / adına fatura) uygun olup olmadığı netleşmeli.
   - KDV oranı: tüm satırlara tek oran uygulanır (`tax_rate_bps`, varsayılan `1000` = %10). Teslimat bedeli için farklı oran
     gerekiyorsa satır bazında oran eklenmeli.
   - Bahşiş faturaya girmez (satış bedeli sayılmadı). İndirim belge indirimi olarak düşülür.
   - Fatura talebi için süre sınırı (ör. teslimden sonra 7 gün) gerekip gerekmediği.
   - İade edilen sipariş için iade faturası akışı (şu an yok; iadesi istenen veya yapılan siparişe fatura kesilmez).
3. Entegratörün test ortamında şema (XSD) ve şematron doğrulamasını yap; ret mesajlarına göre `supabase/functions/_shared/invoice.ts`
   düzelt. Entegratör ham UBL yerine kendi JSON biçimini istiyorsa gönderim gövdesi o biçime çevrilmeli.
4. Test ortamında gönderim, kabul, ret ve zaman aşımı senaryolarını dene.

## Akış

1. Müşteri, Profil > Kurumsal fatura ekranında unvan, vergi dairesi/numarası, adres ve e-posta kaydeder.
2. Teslim edilmiş ve iadesi istenmemiş sipariş için fatura talebi oluşturur; fatura **taslak** olarak açılır.
3. Yönetici, Yönetim > E-faturalar ekranında taslağı inceler, onaylar ve gönderir.
4. `einvoice-submit` faturayı önce **Gönderiliyor** (`sending`) durumuna alır. Bu adım atomiktir: aynı faturayı ikinci bir
   istek alamaz, böylece sağlayıcıya iki kez gitmez.
5. Sağlayıcı yanıtı `submitted`, `accepted` veya `rejected` olarak kaydedilir.
6. Sonuç belirsizse (zaman aşımı, ağ hatası, sağlayıcı 5xx) fatura **Gönderiliyor** durumunda kalır ve kendiliğinden yeniden
   gönderilmez. Yönetici sağlayıcı panelinde faturayı arar; fatura orada yoksa detay ekranındaki "Sağlayıcıda yok, kuyruğa geri al"
   ile not yazarak kuyruğa alır ve yeniden gönderir. Sağlayıcı isteği 4xx ile açıkça reddederse fatura kuyruğa döner.

## Fatura numarası ve tutarlar

- Numara GİB biçimindedir: 3 karakter ön ek + yıl + 9 haneli sıra, ör. `AFY2026000000001`. Sıra her ön ek ve yıl için ayrı
  ve boşluksuz artar (`invoice_number_counters`). Ön ek `einvoice_policy.invoice_prefix` ile değişir; 3 harf/rakam olmalıdır.
- Satırlar: ürünler, teslimat ve (varsa) negatif tutarlı indirim satırı. Her satırın KDV'si kendi brüt tutarından ayrılır;
  başlıktaki KDV hariç toplam, KDV ve genel toplam satırların toplamıdır, kuruş farkı oluşmaz.
- Şahıs şirketi restoranlarda vergi numarası yerine T.C. kimlik numarası kullanılır.

## Sağlayıcı sözleşmesi

Edge Function sağlayıcıya şu gövdeyi gönderir:

```json
{
  "invoiceId": "uuid",
  "invoiceNumber": "AFY2026000000001",
  "xml": "<?xml version=\"1.0\" ...>"
}
```

Başlıklar:

- `Authorization: Bearer <GIB_PROVIDER_TOKEN>`
- `Content-Type: application/json`
- `Idempotency-Key: <invoiceId>` (sağlayıcı destekliyorsa tekrarı kendisi de reddeder)

İstek 20 saniyede zaman aşımına uğrar. Başarılı yanıt örneği:

```json
{ "status": "accepted", "id": "provider-invoice-id" }
```

`status` değeri `accepted`, `submitted` veya `rejected` olabilir. `rejected` ise `error` metni gönderilmelidir.
`submitted` durumundaki faturanın sonradan kabul/ret bilgisini çekecek bir sorgu veya webhook henüz yoktur;
entegratör seçildikten sonra eklenmelidir.

## Supabase kurulumu

1. `045`–`050` migration'larını sırayla çalıştır (bkz. `docs/CANLIYA-ALMA.md` bölüm 5.1).
2. Edge Function'ı yükle:
   ```bash
   npx supabase functions deploy einvoice-submit --project-ref <SUPABASE_PROJECT_REF>
   ```
3. Sağlayıcı secret'larını tanımla:
   ```bash
   npx supabase secrets set --project-ref <SUPABASE_PROJECT_REF> GIB_PROVIDER_URL=https://<entegratör>/api/invoices GIB_PROVIDER_TOKEN=<gizli-anahtar>
   ```
4. Kontroller bitince e-faturayı aç:
   ```sql
   UPDATE public.app_config
      SET value = '{"enabled":true,"provider":"generic","invoice_prefix":"AFY","tax_rate_bps":1000}'
    WHERE key = 'einvoice_policy';
   ```

## Zorunlu kontroller

- Satıcının `seller_company_info` kaydında unvan ve vergi numarası (şahıs şirketinde T.C. kimlik) eksiksizdir.
- Alıcının kurumsal fatura profili eksiksizdir.
- Aynı sipariş için yalnızca bir fatura oluşturulabilir.
- Sağlayıcı olmadan fatura "gönderildi" görünmez.
