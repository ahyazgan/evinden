# Canlıda uçtan uca deneme

Yerel testler `pglite` ile koşar; gerçek Supabase'de (Auth, depolama, bildirim, zamanlanmış görevler) hiç
denenmedi. İlk gerçek restoranı almadan önce bunu kendi hesaplarınla bir kez yürüt. Yalnızca **kapıda
ödeme** denenir; online ödeme kapalı kalır.

Hesapları sen aç: iki ayrı e-posta (müşteri ve restoran) ve bir yönetici hesabı. Test restoranının adına
"TEST" yaz, işin sonunda yönetici panelinden pasif yap veya sil.

## Hazırlık

- [ ] Yönetici hesabıyla giriş yapılıyor, yönetici paneli açılıyor.
- [ ] Test restoranı başvurusu yapıldı, belgeler yüklendi, yönetici panelinden onaylandı (`is_approved`).
- [ ] Restoranın menüsüne 2–3 ürün, çalışma saatleri, konum ve teslimat alanı girildi.
- [ ] Yönetici panelinde Ayarlar > restoran komisyonu %7 görünüyor (lansman).
- [ ] Kuryesi olmayan bir işletmeyi denemek için ikinci bir test restoranına %8 verildi (`docs/KOMISYON.md`).

## Sipariş akışı (müşteri + restoran, iki cihaz veya iki tarayıcı)

- [ ] Müşteri adres ekliyor; konum izni reddedilince elle adres girişi çalışıyor.
- [ ] Sepete ürün ekleyip kapıda ödemeyle sipariş veriliyor; tutar ekrandaki ile aynı.
- [ ] Restoran tarafına **anında** bildirim ve sesli uyarı geliyor (telefonda push).
- [ ] Restoran onaylıyor; müşteriye "onaylandı" bildirimi geliyor.
- [ ] Durumlar sırayla ilerliyor: hazırlanıyor, hazır, yolda, teslim edildi. Müşteri her adımda görüyor.
- [ ] Teslimden sonra restoran siparişte müşterinin telefonunu artık göremiyor.
- [ ] Sipariş detayında komisyon: %7 restoranda 100 TL'lik yemek için 7 TL; %8 verilen restoranda 8 TL.
- [ ] Restoran kazançlar ekranında net tutar komisyon düşülmüş görünüyor.

## İptal ve zaman aşımı

- [ ] Müşteri onaylanmamış siparişi iptal ediyor; stok ve kupon geri geliyor.
- [ ] Restoran siparişi reddediyor; müşteriye bildirim gidiyor.
- [ ] Cevapsız sipariş: 10. dakikada restorana hatırlatma, 30. dakikada otomatik iptal.
- [ ] Yönetici > SLA Yönetimi ekranından eşikler değiştiriliyor; geçen sipariş ihlal olarak görünüyor.
- [ ] Varsayılan kuralda onaylanıp 90 dakika hazırlanmaya başlanmayan sipariş iptal edilmiyor, yalnızca ihlal kaydı açılıyor.
- [ ] Planlı sipariş, saati geldiğinde hemen iptal edilmiyor.
- [ ] "Tahsil edildi" onay soruyor ve hakedişten para düşmüyor.

## Kurumsal fatura ve mutabakat

- [ ] E-fatura kapalıyken müşteri profilinde "Kurumsal fatura" görünmüyor.
- [ ] (E-fatura açıldıktan sonra) Müşteri Profil > Kurumsal fatura ekranından vergi profili kaydediliyor.
- [ ] Teslim siparişi için fatura talebi oluşturuluyor; yönetici E-faturalar ekranında taslağı görüyor.
- [ ] Birden fazla sipariş seçilip toplu taslak oluşturuluyor; hiçbiri doğrudan sağlayıcıya gönderilmiyor.
- [ ] Fatura detayında alıcı/veren, satırlar, vergi ve tutarlar kontrol ediliyor; onaydan sonra gönderiliyor.
- [ ] GİB sağlayıcısı tanımlıysa fatura gönderiliyor ve kabul/ret durumu kaydediliyor.
- [ ] Sağlayıcı tanımlı değilse fatura "gönderildi" görünmüyor, kuyrukta hata mesajı gösteriliyor.
- [ ] Yönetici İade Karar Merkezi'nde talebi onaylıyor/reddediyor; kapıda ödenen siparişin iadesi iki aşamalı onayla "İade edildi" olarak kapanıyor. Yemek kartıyla ödenen siparişte de iade talebi açılabiliyor.
- [ ] Faturası olan müşteri hesabını silebiliyor; fatura kaydı yönetimde kalıyor.
- [ ] Gönderimi zaman aşımına uğrayan fatura "Gönderiliyor" durumunda kalıyor, ikinci kez gönderilmiyor; yönetici notla kuyruğa geri alabiliyor.
- [ ] Yönetici Mutabakat ekranında beklenen, gerçek ve fark tutarları görünüyor; fark kırılımı açıklanıyor ve açıklamayla kapatılıyor.
- [ ] Karar raporları ekranında satış trendi, önceki dönem karşılaştırması, segment filtresi ve CSV dışa aktarma görünüyor.
- [ ] Yönetici kokpitindeki fatura/SLA/iade/mutabakat kartları ilgili ekranı doğru filtreyle açıyor.

## Hesap ve izinler

- [ ] Şifre sıfırlama: e-postadaki bağlantı telefonda uygulamayı açıyor, yeni şifre çalışıyor.
- [ ] Başka bir kullanıcı restoran belgelerini (`seller-documents`) açamıyor, yönetici açabiliyor.
- [ ] Test müşterisi hesabını siliyor; giriş artık reddediliyor.

## Bittiğinde

- [ ] Test restoranlarını pasif yap, test siparişlerini yönetici panelinden iptal et veya raporlardan ayır.
- [ ] Bulduğun her sorunu yaz; ilk gerçek restoranı bunlar kapanınca al.
