// iyzico Checkout Form yardımcıları. Hem Deno'da (Edge Function) hem Node'da (test) çalışır:
// burada dış bağımlılık yoktur. Belge: https://docs.iyzico.com/en/payment-methods/checkoutform

export type IyzicoConfig = {
  apiKey: string;
  secretKey: string;
  /** Test: https://sandbox-api.iyzipay.com, canlı: https://api.iyzipay.com */
  baseUrl: string;
};

export const PATHS = {
  initialize: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
  retrieve: '/payment/iyzipos/checkoutform/auth/ecom/detail',
  refund: '/payment/refund',
  // Pazaryeri
  paymentDetail: '/payment/detail',
  approve: '/payment/iyzipos/item/approve',
  disapprove: '/payment/iyzipos/item/disapprove',
  submerchant: '/onboarding/submerchant',
  submerchantDetail: '/onboarding/submerchant/detail',
} as const;

/** iyzico hata kodları (docs.iyzico.com/ek-bilgiler/hata-kodlari). */
export const ERROR_CODES = {
  /** Bu kırılım önceden onaylanmış: onayın yeniden denenmesi başarı sayılır. */
  alreadyApproved: '5064',
  /** Aynı subMerchantExternalId ile alt üye var: önceki kaydın yanıtı kaybolmuş olabilir. */
  submerchantExists: '2002',
} as const;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** IYZWSv2: HMACSHA256(randomKey + uri.path + body, secretKey), sonra base64. */
export async function authHeaders(
  path: string,
  body: string,
  config: IyzicoConfig,
  randomKey: string = crypto.randomUUID(),
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(config.secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(randomKey + path + body)));
  const token = btoa(`apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`);
  return {
    Authorization: `IYZWSv2 ${token}`,
    'x-iyzi-rnd': randomKey,
    'Content-Type': 'application/json',
  };
}

async function iyzicoSend(
  method: 'POST' | 'PUT',
  path: string,
  payload: unknown,
  config: IyzicoConfig,
  fetchFn: typeof fetch,
): Promise<Record<string, any>> {
  const body = JSON.stringify(payload);
  const response = await fetchFn(config.baseUrl + path, {
    method,
    headers: await authHeaders(path, body, config),
    body,
  });
  return (await response.json()) as Record<string, any>;
}

export function iyzicoPost(
  path: string,
  payload: unknown,
  config: IyzicoConfig,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, any>> {
  return iyzicoSend('POST', path, payload, config, fetchFn);
}

/** Yalnızca alt üye güncelleme PUT'tur. Belge imzayı PUT için ayrıca anlatmıyor, POST ile aynı yazıldı. */
export function iyzicoPut(
  path: string,
  payload: unknown,
  config: IyzicoConfig,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, any>> {
  return iyzicoSend('PUT', path, payload, config, fetchFn);
}

export function centsToPrice(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function priceToCents(price: unknown): number {
  return Math.round(Number(price) * 100);
}

/**
 * iyzico buyer.gsmNumber: E.164 (+905551112233). Kayıtlı kartlar iyzico cüzdanında olduğu için iyzico
 * müşteriyi bu numarayla tanır. Geçersizse gönderilmez: alan zorunlu değildir, yanlış numara ise isteği bozar.
 * lib/phone.ts ile aynı kural; Edge Function dış dosyaya bağlanmasın diye burada ayrıca yazılı, test ikisini karşılaştırır.
 */
export function toGsmNumber(phone: string | null | undefined): string | undefined {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('90')) national = digits.slice(2);
  if (national?.startsWith('5')) return `+90${national}`;
  // Yurt dışı numara: başında + varsa ülke kodu bellidir.
  if (raw.startsWith('+') && !digits.startsWith('90') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return undefined;
}

export type CheckoutInput = {
  order: { id: string; total_cents: number; delivery_address: string | null };
  buyer: { id: string; name: string | null; phone: string | null; email: string | null };
  city: string | null;
  callbackUrl: string;
  ip: string;
};

export function buildCheckoutRequest({ order, buyer, city, callbackUrl, ip }: CheckoutInput) {
  const price = centsToPrice(order.total_cents);
  const fullName = (buyer.name ?? '').trim() || 'Evinden Müşterisi';
  const [firstName, ...rest] = fullName.split(/\s+/);
  const address = (order.delivery_address ?? '').trim() || 'Belirtilmedi';
  const billing = { address, contactName: fullName, city: city || 'Istanbul', country: 'Turkey' };

  return {
    locale: 'tr',
    conversationId: order.id,
    price,
    paidPrice: price,
    currency: 'TRY',
    basketId: order.id,
    paymentGroup: 'PRODUCT',
    callbackUrl,
    // Taksit kapalı: taksit farkı paidPrice'ı sipariş tutarından farklı yapar.
    enabledInstallments: [1],
    buyer: {
      id: buyer.id,
      name: firstName,
      surname: rest.join(' ') || firstName,
      // T.C. kimlik numarası toplanmıyor; iyzico örneğindeki yer tutucu kullanılır.
      identityNumber: '11111111111',
      // iyzico e-postayı zorunlu ister; yalnızca telefonla giren müşterinin e-postası yoktur.
      email: buyer.email?.trim() || 'musteri@evinden.app',
      gsmNumber: toGsmNumber(buyer.phone),
      registrationAddress: address,
      city: billing.city,
      country: billing.country,
      ip,
    },
    shippingAddress: billing,
    billingAddress: billing,
    basketItems: [
      {
        id: order.id,
        name: `Evinden siparişi #${order.id.slice(0, 8)}`,
        category1: 'Yemek',
        itemType: 'PHYSICAL',
        price,
      },
    ],
  };
}

export type RetrieveResult =
  | { paid: true; paymentId: string; transactions: unknown[]; paidCents: number }
  | {
      paid: false;
      reason: string;
      /**
       * failed: para çekilmedi. review: iyzico inceliyor, sonuç bekleniyor.
       * mismatch: para çekildi ama sipariş kabul edilemez, iade edilmeli.
       */
      kind: 'failed' | 'review' | 'mismatch';
      paymentId?: string;
      transactions?: unknown[];
    };

/**
 * iyzico'nun yanıtını sipariş ile karşılaştırır. Ödeme ancak istek başarılı, ödeme başarılı,
 * sepet aynı sipariş, tutar aynı ve dolandırıcılık filtresi onaylı (fraudStatus=1) ise geçerlidir.
 */
export function evaluateRetrieve(order: { id: string; total_cents: number }, result: Record<string, any>): RetrieveResult {
  if (result.status !== 'success') return { paid: false, kind: 'failed', reason: `istek başarısız: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`.trim() };
  if (result.paymentStatus !== 'SUCCESS') return { paid: false, kind: 'failed', reason: `ödeme durumu: ${result.paymentStatus ?? '-'}` };
  if (result.basketId !== order.id) return { paid: false, kind: 'failed', reason: 'sepet siparişle uyuşmuyor' };
  const fraudStatus = Number(result.fraudStatus);
  if (fraudStatus === 0) return { paid: false, kind: 'review', reason: 'dolandırıcılık denetimi inceleniyor' };
  if (fraudStatus !== 1) return { paid: false, kind: 'failed', reason: `dolandırıcılık denetimi: ${result.fraudStatus ?? '-'}` };

  const paymentId = result.paymentId ? String(result.paymentId) : undefined;
  const transactions = Array.isArray(result.itemTransactions) ? result.itemTransactions : [];
  const paidCents = priceToCents(result.paidPrice);
  if (paidCents !== order.total_cents) {
    return { paid: false, kind: 'mismatch', reason: `tutar uyuşmuyor: ${paidCents} / ${order.total_cents}`, paymentId, transactions };
  }
  if (!paymentId) return { paid: false, kind: 'review', reason: 'ödeme numarası yok' };
  return { paid: true, paymentId, transactions, paidCents };
}

// ── Pazaryeri ──────────────────────────────────────────────────────────────

export type SplitOrder = {
  total_cents: number;
  subtotal_cents: number;
  delivery_fee_cents: number;
  platform_delivery_cents?: number | null;
  seller_discount_cents?: number | null;
  commission_cents?: number | null;
  tip_cents?: number | null;
};

export type MarketplaceSplit =
  | { ok: true; priceCents: number; subMerchantCents: number; platformCents: number }
  | { ok: false; reason: 'invalid_amounts' | 'seller_share_not_positive' | 'platform_share_not_positive' };

/**
 * Müşterinin ödediği tutarın bölüşümü, tam sayı kuruşla. Satıcının payı order_net_cents (033) ve
 * lib/earnings.ts orderNetCents ile aynıdır: satış + teslimat + platformun karşıladığı teslimat + bahşiş
 * - kendi indirimi - komisyon. Kalan platformundur ve iyzico işlem ücreti de oradan düşülür (belge).
 *
 * Satıcının payı ödenen tutarı aşabilir: platform kuponunda indirimi ve ücretsiz teslimatı platform karşılar.
 * Bu para sepette yoktur, iyzico'dan gönderilemez; böyle sipariş elle hesap kesimine kalır.
 *
 * STOPAJ: subMerchantPrice stopaj düşülmeden hesaplanır. iyzico'nun stopaj sayfasına göre 6563 sayılı Kanun
 * kapsamındaki pazaryeri, KDV hariç net satış tutarının %1'ini alt üyenin hakedişinden düşmekle yükümlüdür ve
 * withholdingTax alanı yalnızca rapor içindir, iyzico hesap yapmaz. Kapsamda olup olmadığı mali müşavire
 * sorulmadan anahtar açılmamalı (docs/CANLIYA-ALMA.md).
 */
export function computeMarketplaceSplit(order: SplitOrder): MarketplaceSplit {
  const parts = [
    order.total_cents, order.subtotal_cents, order.delivery_fee_cents, order.platform_delivery_cents ?? 0,
    order.seller_discount_cents ?? 0, order.commission_cents ?? 0, order.tip_cents ?? 0,
  ];
  if (!parts.every(Number.isSafeInteger) || order.total_cents <= 0) return { ok: false, reason: 'invalid_amounts' };

  const subMerchantCents = order.subtotal_cents + order.delivery_fee_cents + (order.platform_delivery_cents ?? 0)
    + (order.tip_cents ?? 0) - (order.seller_discount_cents ?? 0) - (order.commission_cents ?? 0);
  const platformCents = order.total_cents - subMerchantCents;
  // iyzico sıfır tutarı kabul etmez (5005 açıklaması).
  if (subMerchantCents <= 0) return { ok: false, reason: 'seller_share_not_positive' };
  // Platform payı sıfırsa iyzico ücretinin düşüleceği para kalmaz.
  if (platformCents <= 0) return { ok: false, reason: 'platform_share_not_positive' };
  return { ok: true, priceCents: order.total_cents, subMerchantCents, platformCents };
}

/** Kuruştan ondalık metin, kayan nokta kullanmadan: 9420 -> "94.20". Belgede subMerchantPrice metindir. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Geçersiz kuruş');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Veritabanından okunan, anahtar ve satıcının kaydı. */
export type MarketplaceAccount = { enabled: boolean; subMerchantKey: string | null };

export type CheckoutPlan =
  | { flow: 'standard' }
  | { flow: 'marketplace'; subMerchantKey: string; subMerchantCents: number }
  | { flow: 'listing'; reason: string };

/** Anahtar kapalıyken her zaman bugünkü akış. Açıkken ancak bölüşüm kuruluyorsa pazaryeri. */
export function planCheckout(order: SplitOrder, account: MarketplaceAccount): CheckoutPlan {
  if (!account.enabled) return { flow: 'standard' };
  if (!account.subMerchantKey) return { flow: 'listing', reason: 'no_submerchant_key' };
  const split = computeMarketplaceSplit(order);
  if (!split.ok) return { flow: 'listing', reason: split.reason };
  return { flow: 'marketplace', subMerchantKey: account.subMerchantKey, subMerchantCents: split.subMerchantCents };
}

/**
 * Pazaryeri hesabında anahtarsız PRODUCT ödemesi 5077 hatası verir ("bütün sepet kırılımlarında subMerchantKey
 * gönderilmelidir"). Anahtarı olmayan satıcının siparişi bu yüzden LISTING ile alınır: belgeye göre alt üye
 * olmadan satış böyle yapılır ve onay süreci yoktur. Para platformda kalır, satıcıya elle ödenir.
 */
export function buildPlannedCheckoutRequest(input: CheckoutInput, plan: CheckoutPlan) {
  const base = buildCheckoutRequest(input);
  if (plan.flow === 'standard') return base;
  if (plan.flow === 'listing') return { ...base, paymentGroup: 'LISTING' };
  return {
    ...base,
    basketItems: base.basketItems.map(item => ({
      ...item,
      subMerchantKey: plan.subMerchantKey,
      subMerchantPrice: centsToDecimalString(plan.subMerchantCents),
    })),
  };
}

/**
 * iyzico'nun döndürdüğü kırılımlar gönderdiğimizle aynı mı? Sorun varsa açıklaması, yoksa null.
 * subMerchantKey ve subMerchantPrice ödeme sorgusu belgesinin alan listesinde yok, pazaryeri örneğinde var:
 * dönmüşse denetlenir, dönmemişse engel sayılmaz. İşlem numarası ise onay için şarttır.
 */
export function verifyMarketplaceTransactions(
  transactions: { paymentTransactionId?: unknown; subMerchantKey?: unknown; subMerchantPrice?: unknown }[] | null | undefined,
  expected: { subMerchantKey: string | null; subMerchantCents: number | null },
): string | null {
  if (!Array.isArray(transactions) || transactions.length === 0) return 'ödeme kırılımı yok';
  if (transactions.some(t => !t.paymentTransactionId)) return 'ödeme kırılımında işlem numarası yok';
  if (!expected.subMerchantKey || expected.subMerchantCents === null) return 'gönderilen alt üye kaydı yok';
  if (transactions.some(t => t.subMerchantKey !== undefined && t.subMerchantKey !== expected.subMerchantKey)) {
    return 'iyzico farklı bir alt üye döndürdü';
  }
  if (transactions.every(t => t.subMerchantPrice !== undefined)) {
    const total = transactions.reduce((sum, t) => sum + priceToCents(t.subMerchantPrice), 0);
    if (total !== expected.subMerchantCents) return `satıcı payı uyuşmuyor: ${total} / ${expected.subMerchantCents}`;
  }
  return null;
}

export type CompanyInfo = {
  company_type: 'PRIVATE_COMPANY' | 'LIMITED_OR_JOINT_STOCK_COMPANY';
  legal_company_title: string;
  tax_office: string;
  tax_number: string | null;
  identity_number: string;
  email: string;
  gsm_number: string;
  address: string;
};

export type SubmerchantInput = {
  seller: { id: string; display_name: string };
  company: CompanyInfo | null;
  payout: { iban: string } | null;
};

/** Eksik alanların adı; yalnızca yöneticiye gösterilir, değer içermez. */
export function submerchantMissing({ company, payout }: SubmerchantInput): string[] {
  const missing: string[] = [];
  if (!company) missing.push('şirket bilgileri');
  if (!payout?.iban) missing.push('IBAN');
  if (company?.company_type === 'LIMITED_OR_JOINT_STOCK_COMPANY' && !company.tax_number) missing.push('vergi numarası');
  return missing;
}

function submerchantFields(input: SubmerchantInput) {
  const company = input.company!;
  return {
    locale: 'tr',
    conversationId: input.seller.id,
    name: input.seller.display_name,
    email: company.email,
    gsmNumber: company.gsm_number,
    address: company.address,
    iban: input.payout!.iban,
    taxOffice: company.tax_office,
    // Şahıs şirketinde belgeye göre isteğe bağlı: boşsa hiç gönderilmez.
    ...(company.tax_number ? { taxNumber: company.tax_number } : {}),
    legalCompanyTitle: company.legal_company_title,
    identityNumber: company.identity_number,
    currency: 'TRY',
  };
}

/** Alt üye oluşturma. subMerchantExternalId satıcının numarasıdır: aynı satıcı iki kez kaydolamaz. */
export function buildSubmerchantCreate(input: SubmerchantInput) {
  return {
    ...submerchantFields(input),
    subMerchantExternalId: input.seller.id,
    subMerchantType: input.company!.company_type,
  };
}

/** Alt üye güncelleme: belgeye göre subMerchantType gönderilmez, tür sonradan değişmez. */
export function buildSubmerchantUpdate(input: SubmerchantInput, subMerchantKey: string) {
  return { ...submerchantFields(input), subMerchantKey };
}

/** Kayda veya güvenlik günlüğüne yazılacak metinden IBAN ve uzun sayıları (kimlik, vergi no) siler. */
export function redactSensitive(text: string): string {
  return text.replace(/TR[0-9][0-9 ]{8,}[0-9]/gi, '***').replace(/[0-9]{10,}/g, '***');
}
