/**
 * evinden — İş modeli sabitleri
 */

// ─── Komisyon Oranları ──────────────────────────────────────────────────────────

export const COMMISSION_TIERS = [
  { id: 'new', label: 'Yeni Satıcı', description: 'İlk 3 ay', rate: 8, minOrders: 0 },
  { id: 'standard', label: 'Standart', description: '0-100 sipariş/ay', rate: 12, minOrders: 0 },
  { id: 'pro', label: 'Profesyonel', description: '100+ sipariş/ay', rate: 10, minOrders: 100 },
] as const;

export const COMMISSION_INFO = {
  currentTier: 'new' as 'new' | 'standard' | 'pro',
  promoMonths: 3, // ilk 3 ay yeni satıcı indirimi
  description:
    'Her siparişten komisyon oranınız kadar platform hizmet bedeli kesilir. Kalan tutar hesabınıza aktarılır.',
};

// ─── Teslimat Modeli ────────────────────────────────────────────────────────────

export const DELIVERY_CONFIG = {
  model: 'seller_courier' as const, // satıcı kendi teslim eder
  label: 'Esnaf Kurye',
  description:
    'Siparişlerin teslimatı satıcı tarafından yapılır. Kendi kuryenizi veya kendiniz teslim edebilirsiniz.',
  maxDeliveryRadiusKm: 10,
  defaultDeliveryFeeCents: 1500, // ₺15 varsayılan
};

// ─── Satıcı Kayıt Sözleşmeleri ─────────────────────────────────────────────────

export const SELLER_AGREEMENTS = [
  {
    id: 'food_license',
    title: 'Gıda İşletme Kaydı',
    required: true,
    checkboxLabel: 'Tarım ve Orman Bakanlığı gıda işletme kaydım bulunmaktadır.',
    description:
      'Gıda üreten ve satan tüm işletmelerin Tarım ve Orman Bakanlığı\'na kayıt yaptırması yasal zorunluluktur. Bu kayıt olmadan gıda satışı yapılması yasaktır.',
  },
  {
    id: 'tax_registration',
    title: 'Vergi Mükellefi Beyanı',
    required: true,
    checkboxLabel: 'Vergi mükellefi olduğumu veya esnaf muaflığı kapsamında olduğumu beyan ederim.',
    description:
      'Satıcıların vergi mükellefi olması veya esnaf muaflığı belgesi bulundurması zorunludur. Platform üzerinden elde edilen gelirler vergi beyannamesine dahil edilmelidir.',
  },
  {
    id: 'distance_selling',
    title: 'Mesafeli Satış Sözleşmesi',
    required: true,
    checkboxLabel: 'Mesafeli Satış Sözleşmesi\'ni okudum ve kabul ediyorum.',
    description: '6502 sayılı Tüketicinin Korunması Hakkında Kanun gereği, platform üzerinden yapılan tüm satışlar mesafeli satış kapsamındadır.',
    fullText: `MESAFELİ SATIŞ SÖZLEŞMESİ

1. TARAFLAR
İşbu sözleşme, evinden platformu üzerinden gıda ürünlerini satan Satıcı ile platform arasında düzenlenmiştir.

2. KONU
Bu sözleşme, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği çerçevesinde, platform aracılığıyla gerçekleştirilen satışlara ilişkin tarafların hak ve yükümlülüklerini düzenler.

3. SATICI YÜKÜMLÜLÜKLERİ
a) Satıcı, menüsünde listelenen ürünleri hijyen koşullarına uygun şekilde hazırlayacaktır.
b) Satıcı, sipariş onayından sonra belirtilen süre içinde teslimatı gerçekleştirecektir.
c) Satıcı, ürün fiyatlarını güncel ve doğru tutacaktır.
d) Satıcı, gıda güvenliği standartlarına uygun ambalajlama yapacaktır.

4. KOMİSYON
Platform, her başarılı sipariş üzerinden belirlenen oranda komisyon alır. Güncel komisyon oranları satıcı panelinde görüntülenebilir.

5. ÖDEME
Satıcıya ödemeler, komisyon kesildikten sonra belirtilen hesaba haftalık olarak aktarılır.

6. FESİH
Taraflardan her biri, 15 gün önceden yazılı bildirimde bulunarak sözleşmeyi feshedebilir.`,
  },
  {
    id: 'cancellation_policy',
    title: 'İptal ve İade Politikası',
    required: true,
    checkboxLabel: 'İptal ve İade Politikası\'nı okudum ve kabul ediyorum.',
    description: 'Müşterilerin iptal ve iade haklarını düzenleyen politikamıza uymanız zorunludur.',
    fullText: `İPTAL VE İADE POLİTİKASI

1. MÜŞTERİ İPTAL HAKKI
a) Müşteri, sipariş onaylanmadan önce ücretsiz iptal edebilir.
b) Sipariş hazırlanmaya başladıktan sonra iptal talebi satıcının onayına bağlıdır.
c) Hazırlanmış siparişlerin iptali durumunda ücret iadesi yapılmaz.

2. SATICI İPTAL HAKKI
a) Satıcı, stok yetersizliği veya mücbir sebep durumunda siparişi iptal edebilir.
b) Satıcı iptali durumunda müşteriye tam iade yapılır.
c) Sürekli iptal yapan satıcılar hakkında platform değerlendirme yapma hakkını saklı tutar.

3. İADE KOŞULLARI
a) Yanlış veya eksik teslimat durumunda tam iade yapılır.
b) Gıda kalitesine ilişkin şikayetler 2 saat içinde bildirilmelidir.
c) İade talepleri platform tarafından değerlendirilir.

4. ÜCRET İADESİ
İade onaylanan siparişlerde ödeme, orijinal ödeme yöntemine 3-5 iş günü içinde iade edilir.`,
  },
] as const;
