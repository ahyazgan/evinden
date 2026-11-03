// Ödeme akışının kararları. Veritabanı ve iyzico dışarıdan verilir, böylece Node'da test edilir.
import { buildCheckoutRequest, evaluateRetrieve, PATHS } from './iyzico.ts';

export type PaymentOrder = {
  id: string;
  customer_id: string | null;
  seller_id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total_cents: number;
  delivery_address: string | null;
};

export type PaymentDeps = {
  iyzico: (path: string, payload: unknown) => Promise<Record<string, any>>;
  getOrder: (id: string) => Promise<PaymentOrder | null>;
  getOrderIdByToken: (token: string) => Promise<string | null>;
  getBuyer: (userId: string) => Promise<{ id: string; name: string | null; phone: string | null; email: string | null }>;
  getSellerCity: (sellerId: string) => Promise<string | null>;
  getTransactions: (orderId: string) => Promise<{ paymentTransactionId?: string | number; paidPrice?: unknown }[]>;
  recordInit: (orderId: string, token: string) => Promise<void>;
  markPaid: (orderId: string, paymentId: string, transactions: unknown[], paidCents: number) => Promise<string>;
  markRefunded: (orderId: string) => Promise<void>;
  recordError: (orderId: string, error: string) => Promise<void>;
  callbackUrl: string;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

const fail = (status: number, error: string): HandlerResult => ({ status, body: { error } });

/** Müşteri için ödeme sayfası başlatır. Tutar her zaman veritabanından gelir, istemciden alınmaz. */
export async function handleInit(userId: string, orderId: unknown, ip: string, deps: PaymentDeps): Promise<HandlerResult> {
  if (typeof orderId !== 'string' || !orderId) return fail(400, 'Sipariş belirtilmedi');
  const order = await deps.getOrder(orderId);
  if (!order || order.customer_id !== userId) return fail(404, 'Sipariş bulunamadı');
  if (order.payment_method !== 'online' || order.status !== 'awaiting_payment' || order.payment_status !== 'pending') {
    return fail(409, 'Bu sipariş için ödeme başlatılamaz');
  }

  const [buyer, city] = await Promise.all([deps.getBuyer(userId), deps.getSellerCity(order.seller_id)]);
  const result = await deps.iyzico(
    PATHS.initialize,
    buildCheckoutRequest({ order, buyer, city, callbackUrl: deps.callbackUrl, ip }),
  );
  if (result.status !== 'success' || !result.token || !result.paymentPageUrl) {
    console.error('iyzico başlatma hatası', result.errorCode, result.errorMessage);
    return fail(502, 'Ödeme başlatılamadı');
  }
  await deps.recordInit(order.id, result.token);
  return { status: 200, body: { paymentPageUrl: result.paymentPageUrl } };
}

/**
 * iyzico'nun geri çağrısını işler. Gelen isteğe güvenilmez: yalnızca bizim başlattığımız token kabul
 * edilir ve sonuç iyzico'dan yeniden sorgulanır.
 */
export async function handleCallback(token: unknown, deps: PaymentDeps): Promise<'success' | 'failed'> {
  if (typeof token !== 'string' || !token) return 'failed';
  const orderId = await deps.getOrderIdByToken(token);
  if (!orderId) return 'failed';
  const order = await deps.getOrder(orderId);
  if (!order) return 'failed';

  const result = await deps.iyzico(PATHS.retrieve, { locale: 'tr', conversationId: order.id, token });
  const evaluated = evaluateRetrieve(order, result);
  if (!evaluated.paid) {
    await deps.recordError(order.id, evaluated.reason);
    return 'failed';
  }
  const outcome = await deps.markPaid(order.id, evaluated.paymentId, evaluated.transactions, evaluated.paidCents);
  return outcome === 'refund_pending' ? 'failed' : 'success';
}

/** Yönetici, iade bekleyen online ödemeyi iyzico üzerinden geri öder. */
export async function handleRefund(isAdmin: boolean, orderId: unknown, ip: string, deps: PaymentDeps): Promise<HandlerResult> {
  if (!isAdmin) return fail(403, 'Yetkiniz yok');
  if (typeof orderId !== 'string' || !orderId) return fail(400, 'Sipariş belirtilmedi');
  const order = await deps.getOrder(orderId);
  if (!order) return fail(404, 'Sipariş bulunamadı');
  if (order.payment_status !== 'refund_pending') return fail(409, 'Bu sipariş iade beklemiyor');

  const transactions = await deps.getTransactions(order.id);
  if (transactions.length === 0 || transactions.some(t => !t.paymentTransactionId)) {
    await deps.recordError(order.id, 'iade için işlem numarası yok');
    return fail(409, 'Ödeme işlem numarası bulunamadı');
  }

  for (const tx of transactions) {
    const result = await deps.iyzico(PATHS.refund, {
      locale: 'tr',
      conversationId: order.id,
      paymentTransactionId: String(tx.paymentTransactionId),
      price: tx.paidPrice,
      currency: 'TRY',
      ip,
    });
    if (result.status !== 'success') {
      await deps.recordError(order.id, `iade hatası: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`);
      return fail(502, 'İade yapılamadı');
    }
  }
  await deps.markRefunded(order.id);
  return { status: 200, body: { refunded: true } };
}
