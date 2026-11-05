// Ödeme akışının kararları. Veritabanı ve iyzico dışarıdan verilir, böylece Node'da test edilir.
import {
  buildPlannedCheckoutRequest, buildSubmerchantCreate, buildSubmerchantUpdate, ERROR_CODES, evaluateRetrieve, PATHS,
  planCheckout, redactSensitive, submerchantMissing, verifyMarketplaceTransactions,
  type CheckoutPlan, type MarketplaceAccount, type SubmerchantInput,
} from './iyzico.ts';

export type PaymentOrder = {
  id: string;
  customer_id: string | null;
  seller_id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total_cents: number;
  delivery_address: string | null;
  // Pazaryeri bölüşümü için; anahtar kapalıyken okunmaz.
  subtotal_cents: number;
  delivery_fee_cents: number;
  platform_delivery_cents: number;
  seller_discount_cents: number;
  commission_cents: number;
  tip_cents: number;
};

export type ApprovalRow = {
  order_id: string;
  attempts: number;
  transactions: { paymentTransactionId?: string | number; subMerchantKey?: unknown; subMerchantPrice?: unknown }[];
  submerchant_key: string | null;
  submerchant_price_cents: number | null;
};

export type PaymentDeps = {
  iyzico: (path: string, payload: unknown) => Promise<Record<string, any>>;
  getOrder: (id: string) => Promise<PaymentOrder | null>;
  getOrderIdByToken: (token: string) => Promise<string | null>;
  getBuyer: (userId: string) => Promise<{ id: string; name: string | null; phone: string | null; email: string | null }>;
  getSellerCity: (sellerId: string) => Promise<string | null>;
  getTransactions: (orderId: string) => Promise<{ paymentTransactionId?: string | number; paidPrice?: unknown }[]>;
  recordInit: (orderId: string, token: string, plan: CheckoutPlan) => Promise<void>;
  claimInit: (orderId: string) => Promise<boolean>;
  releaseInit: (orderId: string) => Promise<void>;
  claimRefund: (orderId: string) => Promise<boolean>;
  releaseRefund: (orderId: string) => Promise<void>;
  getMarketplaceAccount: (sellerId: string) => Promise<MarketplaceAccount>;
  getPaymentFlow: (orderId: string) => Promise<{ marketplace: boolean; paymentId: string | null }>;
  beginMarketplaceRefund: (orderId: string) => Promise<'none' | 'cancelled' | 'approved' | 'in_flight'>;
  markMarketplaceApproved: (orderId: string) => Promise<void>;
  markMarketplaceReversed: (orderId: string) => Promise<void>;
  claimApprovals: (limit: number) => Promise<ApprovalRow[]>;
  completeApproval: (orderId: string) => Promise<void>;
  failApproval: (orderId: string, error: string, final: boolean) => Promise<void>;
  iyzicoPut: (path: string, payload: unknown) => Promise<Record<string, any>>;
  getSubmerchantInput: (sellerId: string) => Promise<(SubmerchantInput & { subMerchantKey: string | null }) | null>;
  saveSubmerchant: (sellerId: string, result: { key: string | null; error: string | null }) => Promise<void>;
  markPaid: (orderId: string, paymentId: string, transactions: unknown[], paidCents: number) => Promise<string>;
  markRefunded: (orderId: string) => Promise<void>;
  recordError: (orderId: string, error: string) => Promise<void>;
  flagRefund: (orderId: string, paymentId: string | undefined, transactions: unknown[], reason: string) => Promise<void>;
  listOpenPayments: (limit: number) => Promise<{ order_id: string; token: string | null; created_at: string }[]>;
  cancelUnpaid: (orderId: string) => Promise<void>;
  closePayment: (orderId: string) => Promise<void>;
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

  const [buyer, city, account] = await Promise.all([
    deps.getBuyer(userId),
    deps.getSellerCity(order.seller_id),
    deps.getMarketplaceAccount(order.seller_id),
  ]);
  const plan = planCheckout(order, account);
  // Sipariş başına tek ödeme sayfası: ikinci sayfanın parası kayda geçmez, müşteri iki kez ödeyebilirdi.
  if (!(await deps.claimInit(order.id))) return fail(409, 'Bu sipariş için ödeme zaten başlatıldı');
  let result: Record<string, any>;
  try {
    result = await deps.iyzico(
      PATHS.initialize,
      buildPlannedCheckoutRequest({ order, buyer, city, callbackUrl: deps.callbackUrl, ip }, plan),
    );
  } catch (e) {
    // Sayfa adresi müşteriye ulaşmadı, çekim olamaz: yeniden denenebilir.
    await deps.releaseInit(order.id);
    throw e;
  }
  if (result.status !== 'success' || !result.token || !result.paymentPageUrl) {
    console.error('iyzico başlatma hatası', result.errorCode, result.errorMessage);
    await deps.releaseInit(order.id);
    return fail(502, 'Ödeme başlatılamadı');
  }
  await deps.recordInit(order.id, result.token, plan);
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
  // Sonuçlanmış ödeme yeniden işlenmez: aynı istek tekrarlanınca kayıtlar ve yönetici uyarısı değişmesin.
  if (order.payment_status !== 'pending') return order.payment_status === 'paid' ? 'success' : 'failed';

  const result = await deps.iyzico(PATHS.retrieve, { locale: 'tr', conversationId: order.id, token });
  const evaluated = evaluateRetrieve(order, result);
  if (!evaluated.paid) {
    if (evaluated.kind === 'mismatch') {
      await deps.flagRefund(order.id, evaluated.paymentId, evaluated.transactions ?? [], evaluated.reason);
    } else {
      await deps.recordError(order.id, evaluated.reason);
    }
    return 'failed';
  }
  const outcome = await deps.markPaid(order.id, evaluated.paymentId, evaluated.transactions, evaluated.paidCents);
  return outcome === 'refund_pending' ? 'failed' : 'success';
}

const MINUTE = 60_000;
/** Ödeme sayfasında bu kadar süre sonuç yoksa sipariş iptal edilir (stok ve kupon geri döner). */
const CANCEL_AFTER_MS = 30 * MINUTE;
/** Geç gelen ödemeler için kayıt bu süre boyunca sorgulanmaya devam eder. */
const CLOSE_AFTER_MS = 72 * 60 * MINUTE;

/**
 * Kapanmamış ödeme kayıtlarını iyzico'dan yeniden sorgular. Geri çağrı başarısız olduysa veya
 * müşteri ödeme sırasında bağlantıyı kaybettiyse parayı burası bulur. Bir kaydın hatası diğerlerini
 * durdurmaz; sorgu başarısızsa kayıt açık kalır ve sonraki çalışmada yeniden denenir.
 */
export async function handleReconcile(deps: PaymentDeps, now: number = Date.now()) {
  const summary = { checked: 0, paid: 0, cancelled: 0, flagged: 0, errors: 0 };
  for (const row of await deps.listOpenPayments(50)) {
    summary.checked += 1;
    try {
      const order = await deps.getOrder(row.order_id);
      const age = now - new Date(row.created_at).getTime();
      // Token'sız kayıt az önce başlatılmış olabilir: iyzico yanıtı beklenirken kapatılmaz.
      if (order?.payment_status === 'pending' && !row.token && age < CANCEL_AFTER_MS) continue;
      if (!order || order.payment_status !== 'pending' || !row.token) {
        // Sayfası hiç açılmamış sipariş stok ve kupon tutmasın.
        if (order?.status === 'awaiting_payment' && order.payment_status === 'pending') {
          await deps.cancelUnpaid(order.id);
          summary.cancelled += 1;
        }
        await deps.closePayment(row.order_id);
        continue;
      }
      const result = await deps.iyzico(PATHS.retrieve, { locale: 'tr', conversationId: order.id, token: row.token });
      const evaluated = evaluateRetrieve(order, result);

      if (evaluated.paid) {
        await deps.markPaid(order.id, evaluated.paymentId, evaluated.transactions, evaluated.paidCents);
        summary.paid += 1;
      } else if (evaluated.kind === 'mismatch') {
        await deps.flagRefund(order.id, evaluated.paymentId, evaluated.transactions ?? [], evaluated.reason);
        summary.flagged += 1;
      } else if (evaluated.kind === 'failed') {
        if (order.status === 'awaiting_payment' && age >= CANCEL_AFTER_MS) {
          await deps.cancelUnpaid(order.id);
          summary.cancelled += 1;
        }
        if (age >= CLOSE_AFTER_MS) await deps.closePayment(order.id);
      } else {
        // İnceleme sürüyor: karar çıkana kadar kayıt açık kalır, süre dolunca kapanır.
        await deps.recordError(order.id, evaluated.reason);
        if (age >= CLOSE_AFTER_MS) await deps.closePayment(order.id);
      }
    } catch (e) {
      summary.errors += 1;
      console.error('payment-reconcile', row.order_id, e);
    }
  }
  return summary;
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

  // İki yönetici aynı anda basarsa iade bir kez gönderilir. Sonucu belirsiz kalan iade süre dolunca yeniden denenebilir.
  if (!(await deps.claimRefund(order.id))) return fail(409, 'Bu iade şu anda işleniyor, biraz sonra tekrar dene');

  const flow = await deps.getPaymentFlow(order.id);
  if (flow.marketplace) {
    const blocked = await releaseMarketplaceApproval(order.id, transactions, flow.paymentId, deps);
    if (blocked) {
      await deps.releaseRefund(order.id);
      return blocked;
    }
  }

  for (const tx of transactions) {
    let result: Record<string, any>;
    try {
      result = await deps.iyzico(PATHS.refund, {
        locale: 'tr',
        conversationId: order.id,
        paymentTransactionId: String(tx.paymentTransactionId),
        price: tx.paidPrice,
        currency: 'TRY',
        ip,
      });
    } catch {
      // Yanıt kayboldu: iade yapılmış olabilir. Yönetici iyzico panelinden bakıp işaretler.
      await deps.recordError(order.id, 'iade yanıtı alınamadı, iyzico panelinden kontrol edin');
      return fail(502, 'İade sonucu alınamadı');
    }
    if (result.status !== 'success') {
      await deps.recordError(order.id, `iade hatası: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`);
      await deps.releaseRefund(order.id);
      return fail(502, 'İade yapılamadı');
    }
  }
  try {
    await deps.markRefunded(order.id);
  } catch {
    await deps.recordError(order.id, 'iade yapıldı ama kaydedilemedi, iade edildi olarak işaretleyin');
    return fail(502, 'İade yapıldı ama kaydedilemedi');
  }
  return { status: 200, body: { refunded: true } };
}

/**
 * Pazaryeri siparişinin iadesinden önce onay kaldırılır. iyzico'nun onay sayfası onaydan önce iadeyi ve onayın
 * geri çekilmesini anlatır, ama "önce geri çek" diye açıkça yazmaz; para satıcıya geçmesin diye önce geri çekilir.
 *
 * Bizim kaydımıza güvenilmez: onay yanıtı kaybolduysa kuyruk "bekliyor" derken iyzico'da onaylı olabilir.
 * Gerçek durum ödeme sorgusundan okunur (transactionStatus 1: onay bekliyor, 2: onaylandı). Durum
 * öğrenilemezse veya onay geri çekilemezse iade YAPILMAZ: para satıcıya geçmiş olabilir, yönetici bakar.
 * Yeniden denemek güvenlidir, durum her seferinde yeniden sorulur.
 *
 * Onaylı görülen sipariş geri çekmeden önce kayda onaylı yazılır. Geri çekme başarısız olur ve yönetici parayı
 * panelden iade ederse satıcının hakkı ancak bu kayıtla borç olarak görünür; yoksa payı platform üstlenirdi.
 */
async function releaseMarketplaceApproval(
  orderId: string,
  transactions: { paymentTransactionId?: string | number }[],
  paymentId: string | null,
  deps: PaymentDeps,
): Promise<HandlerResult | null> {
  const stop = async (status: number, record: string, message: string) => {
    await deps.recordError(orderId, record);
    return fail(status, message);
  };

  // Onay kuyruktan bu sırada gönderiliyor olabilir: sonucu belli olmadan iade başlamaz.
  if ((await deps.beginMarketplaceRefund(orderId)) === 'in_flight') {
    return stop(409, 'onay gönderiliyor, iade birazdan yeniden denenmeli', 'Onay işlemi sürüyor, birazdan tekrar dene');
  }
  if (!paymentId) return stop(409, 'iade için ödeme numarası yok', 'Ödeme numarası bulunamadı');

  let detail: Record<string, any>;
  try {
    detail = await deps.iyzico(PATHS.paymentDetail, { locale: 'tr', conversationId: orderId, paymentId });
  } catch {
    return stop(502, 'onay durumu sorgulanamadı, iade yapılmadı', 'Onay durumu öğrenilemedi');
  }
  const items: Record<string, any>[] = detail.status === 'success' && Array.isArray(detail.itemTransactions) ? detail.itemTransactions : [];
  const statusOf = (id: string) => Number(items.find(i => String(i.paymentTransactionId) === id)?.transactionStatus);

  if (transactions.some(tx => statusOf(String(tx.paymentTransactionId)) === 2)) {
    try {
      await deps.markMarketplaceApproved(orderId);
    } catch {
      return stop(502, 'onay durumu kaydedilemedi, iade yapılmadı', 'Onay durumu kaydedilemedi, tekrar dene');
    }
  }

  for (const tx of transactions) {
    const id = String(tx.paymentTransactionId);
    const status = statusOf(id);
    if (status === 1) continue;
    if (status !== 2) {
      return stop(409, `onay durumu anlaşılamadı (${id}), iade yapılmadı`, 'Onay durumu öğrenilemedi, iyzico panelinden kontrol et');
    }
    let result: Record<string, any>;
    try {
      result = await deps.iyzico(PATHS.disapprove, { locale: 'tr', conversationId: orderId, paymentTransactionId: id });
    } catch {
      return stop(502, 'onay geri çekme yanıtı alınamadı, iade yapılmadı', 'Onay geri çekilemedi');
    }
    if (result.status !== 'success') {
      return stop(
        502,
        `onay geri çekilemedi, para satıcıya geçmiş olabilir: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`,
        'Onay geri çekilemedi, para satıcıya geçmiş olabilir. iyzico panelinden kontrol et.',
      );
    }
  }
  await deps.markMarketplaceReversed(orderId);
  return null;
}

/**
 * Teslim edilmiş pazaryeri siparişlerine onay verir; iyzico parayı ancak bundan sonra gönderir. Aynı satır defalarca
 * işlenebilir: daha önce onaylanmış kırılım 5064 döner ve başarı sayılır, yanıtı kaybolan onay böyle düzelir.
 * Bir satırın hatası diğerlerini durdurmaz. Tutar uyuşmuyorsa onay verilmez, yönetici bakar.
 */
export async function handleApprovals(deps: PaymentDeps) {
  const summary = { claimed: 0, approved: 0, retry: 0, blocked: 0, errors: 0 };
  for (const row of await deps.claimApprovals(25)) {
    summary.claimed += 1;
    try {
      const problem = verifyMarketplaceTransactions(row.transactions, {
        subMerchantKey: row.submerchant_key,
        subMerchantCents: row.submerchant_price_cents,
      });
      if (problem) {
        await deps.failApproval(row.order_id, problem, true);
        summary.blocked += 1;
        continue;
      }

      let error: string | null = null;
      for (const tx of row.transactions) {
        const result = await deps.iyzico(PATHS.approve, {
          locale: 'tr',
          conversationId: row.order_id,
          paymentTransactionId: String(tx.paymentTransactionId),
        });
        if (result.status !== 'success' && String(result.errorCode) !== ERROR_CODES.alreadyApproved) {
          error = `onay hatası: ${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`.trim();
          break;
        }
      }
      if (error) {
        await deps.failApproval(row.order_id, error, false);
        summary.retry += 1;
      } else {
        await deps.completeApproval(row.order_id);
        summary.approved += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error('payment-approve', row.order_id, e instanceof Error ? e.message : 'bilinmeyen hata');
      // Yanıt kaybolduysa onay verilmiş olabilir: yeniden denemek güvenlidir.
      await deps.failApproval(row.order_id, 'onay yanıtı alınamadı', false).catch(() => undefined);
    }
  }
  return summary;
}

/**
 * Yönetici satıcıyı iyzico'ya kaydeder veya bilgilerini günceller. Anahtar kapalıyken çalışmaz.
 * IBAN, T.C. kimlik ve vergi numarası günlüğe yazılmaz; iyzico'nun hata metni de temizlenerek saklanır.
 */
export async function handleSubmerchantSync(isAdmin: boolean, sellerId: unknown, deps: PaymentDeps): Promise<HandlerResult> {
  if (!isAdmin) return fail(403, 'Yetkiniz yok');
  if (typeof sellerId !== 'string' || !sellerId) return fail(400, 'Satıcı belirtilmedi');
  if (!(await deps.getMarketplaceAccount(sellerId)).enabled) return fail(409, 'Otomatik satıcı ödemesi kapalı');

  const input = await deps.getSubmerchantInput(sellerId);
  if (!input) return fail(404, 'Satıcı bulunamadı');
  const missing = submerchantMissing(input);
  if (missing.length > 0) return fail(422, `Eksik bilgi: ${missing.join(', ')}`);

  let key = input.subMerchantKey;
  const failed = async (result: Record<string, any> | null) => {
    const reason = result
      ? redactSensitive(`${result.errorCode ?? '-'} ${result.errorMessage ?? ''}`.trim())
      : 'iyzico yanıt vermedi';
    console.error('submerchant-sync', sellerId, result?.errorCode ?? 'yanıt yok');
    await deps.saveSubmerchant(sellerId, { key, error: reason });
    return fail(502, `iyzico kaydı yapılamadı: ${reason}`);
  };

  let result: Record<string, any> | null = null;
  try {
    if (!key) {
      result = await deps.iyzico(PATHS.submerchant, buildSubmerchantCreate(input));
      if (result.status === 'success' && result.subMerchantKey) {
        await deps.saveSubmerchant(sellerId, { key: String(result.subMerchantKey), error: null });
        return { status: 200, body: { synced: true, created: true } };
      }
      if (String(result.errorCode) !== ERROR_CODES.submerchantExists) return await failed(result);
      // Satıcı iyzico'da var: önceki oluşturmanın yanıtı kaybolmuş. Anahtar alınır, bilgiler aşağıda güncellenir.
      result = await deps.iyzico(PATHS.submerchantDetail, {
        locale: 'tr', conversationId: sellerId, subMerchantExternalId: sellerId,
      });
      if (result.status !== 'success' || !result.subMerchantKey) return await failed(result);
      key = String(result.subMerchantKey);
    }
    result = await deps.iyzicoPut(PATHS.submerchant, buildSubmerchantUpdate(input, key));
  } catch {
    return await failed(null);
  }
  if (result.status !== 'success') return await failed(result);
  await deps.saveSubmerchant(sellerId, { key, error: null });
  return { status: 200, body: { synced: true, created: false } };
}
