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

export async function iyzicoPost(
  path: string,
  payload: unknown,
  config: IyzicoConfig,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, any>> {
  const body = JSON.stringify(payload);
  const response = await fetchFn(config.baseUrl + path, {
    method: 'POST',
    headers: await authHeaders(path, body, config),
    body,
  });
  return (await response.json()) as Record<string, any>;
}

export function centsToPrice(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function priceToCents(price: unknown): number {
  return Math.round(Number(price) * 100);
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
      email: buyer.email || 'musteri@evinden.app',
      gsmNumber: buyer.phone || undefined,
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
  | { paid: false; reason: string };

/**
 * iyzico'nun yanıtını sipariş ile karşılaştırır. Ödeme ancak istek başarılı, ödeme başarılı,
 * sepet aynı sipariş, tutar aynı ve dolandırıcılık filtresi onaylı (fraudStatus=1) ise geçerlidir.
 */
export function evaluateRetrieve(order: { id: string; total_cents: number }, result: Record<string, any>): RetrieveResult {
  if (result.status !== 'success') return { paid: false, reason: `istek başarısız: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`.trim() };
  if (result.paymentStatus !== 'SUCCESS') return { paid: false, reason: `ödeme durumu: ${result.paymentStatus ?? '-'}` };
  if (result.basketId !== order.id) return { paid: false, reason: 'sepet siparişle uyuşmuyor' };
  if (Number(result.fraudStatus) !== 1) return { paid: false, reason: `dolandırıcılık denetimi: ${result.fraudStatus ?? '-'}` };
  const paidCents = priceToCents(result.paidPrice);
  if (paidCents !== order.total_cents) return { paid: false, reason: `tutar uyuşmuyor: ${paidCents} / ${order.total_cents}` };
  if (!result.paymentId) return { paid: false, reason: 'ödeme numarası yok' };
  return {
    paid: true,
    paymentId: String(result.paymentId),
    transactions: Array.isArray(result.itemTransactions) ? result.itemTransactions : [],
    paidCents,
  };
}
