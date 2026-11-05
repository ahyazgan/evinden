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

## Hesap ve izinler

- [ ] Şifre sıfırlama: e-postadaki bağlantı telefonda uygulamayı açıyor, yeni şifre çalışıyor.
- [ ] Başka bir kullanıcı restoran belgelerini (`seller-documents`) açamıyor, yönetici açabiliyor.
- [ ] Test müşterisi hesabını siliyor; giriş artık reddediliyor.

## Bittiğinde

- [ ] Test restoranlarını pasif yap, test siparişlerini yönetici panelinden iptal et veya raporlardan ayır.
- [ ] Bulduğun her sorunu yaz; ilk gerçek restoranı bunlar kapanınca al.
