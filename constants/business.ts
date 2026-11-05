/**
 * afiyetli — İş modeli sabitleri
 */

// ─── Komisyon Oranları ──────────────────────────────────────────────────────────

// Güncel oranlar app_config.order_pricing içindedir ve yönetici panelinden değişir.
// Bu değerler yalnızca ayar okunamazsa ekranda gösterilir.
export const DEFAULT_COMMISSION_RATES = { home: 8, restaurant: 1 } as const;

export const COMMISSION_DESCRIPTION =
  'Her siparişten komisyon oranın kadar platform hizmet bedeli kesilir. Kalan tutar hesabına aktarılır.';

// ─── Satıcı Türleri ─────────────────────────────────────────────────────────

// Ev aşçıları şimdilik askıda, uygulama yalnızca restoranlarla çalışır. true yapınca geri gelirler.
export const HOME_SELLERS_ENABLED = false;

export const SELLER_TYPE_LABELS = { home: 'Ev Aşçısı', restaurant: 'Restoran' } as const;

/** Yeni başvuruda ve satıcının türü henüz okunmamışken geçerli olan tür */
export const DEFAULT_SELLER_TYPE = HOME_SELLERS_ENABLED ? 'home' : 'restaurant';

/** Satıcı müşteri listelerinde görünür mü? Doğrudan satıcı sayfası bundan etkilenmez. */
export function isSellerListed(seller: { seller_type?: string | null } | null | undefined): boolean {
  return HOME_SELLERS_ENABLED || seller?.seller_type === 'restaurant';
}

// ─── Restoran Belgeleri ─────────────────────────────────────────────────────

export const SELLER_DOCUMENTS = [
  {
    id: 'tax_certificate',
    title: 'Vergi Levhası',
    description: 'Güncel vergi levhanızın okunaklı fotoğrafı.',
  },
  {
    id: 'business_license',
    title: 'İşletme Belgesi',
    description: 'İşyeri açma ve çalışma ruhsatı veya gıda işletme kayıt belgesi.',
  },
] as const;

// ─── Teslimat Modeli ────────────────────────────────────────────────────────────

export const DELIVERY_CONFIG = {
  model: 'seller_courier' as const, // satıcı kendi teslim eder
  label: 'Esnaf Kurye',
  description:
    'Siparişlerin teslimatı satıcı tarafından yapılır. Kendi kuryenle veya kendin teslim edebilirsin.',
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
İşbu sözleşme, afiyetli platformu üzerinden gıda ürünlerini satan Satıcı ile platform arasında düzenlenmiştir.

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
Online ödemelerde satıcının hakkı, komisyon kesildikten sonra belirtilen hesaba haftalık olarak aktarılır. Nakit, kapıda kart ve kapıda yemek kartı ödemelerinde tahsilatı satıcı yapar; birikmiş komisyon haftalık hesap kesiminde platforma ödenir. Hesap kesimi ve döküm satıcı panelindeki Kazancım ekranında görüntülenir.

Satıcının açtığı kampanyaların indirimi satıcıya aittir; komisyon indirimli tutar üzerinden hesaplanır. Platformun verdiği kuponların bedelini platform karşılar.

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

// ─── Yasal bilgiler ───────────────────────────────────────────
// Canlıdan önce doldurulmalı, metinler hukukçuya gösterilmeli (docs/CANLIYA-ALMA.md).
/** Müşterinin onayladığı metnin sürümü: metin değişince artır, siparişe kaydedilir. */
export const SALES_TERMS_VERSION = '2026-11';

export const PLATFORM_LEGAL = {
  name: 'Afiyetli',
  /** Şirket unvanı, adresi ve vergi numarası verilince ekranda görünür */
  title: '',
  address: '',
  taxNumber: '',
  email: 'destek@afiyetli.app',
};
