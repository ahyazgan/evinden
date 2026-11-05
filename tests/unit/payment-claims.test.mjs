import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleCallback, handleInit, handleReconcile, handleRefund } from '../../supabase/functions/_shared/handlers.ts';

const ORDER = {
  id: 'o1', customer_id: 'u1', seller_id: 's1', status: 'awaiting_payment', payment_method: 'online',
  payment_status: 'pending', total_cents: 11050, delivery_address: 'Moda Cad. No:1', subtotal_cents: 10000,
  delivery_fee_cents: 1050, platform_delivery_cents: 0, seller_discount_cents: 0, commission_cents: 1000, tip_cents: 0,
};

function fake(over = {}) {
  const calls = { iyzico: 0, released: 0, recorded: 0, closed: 0, refunded: 0, paid: 0 };
  const deps = {
    callbackUrl: 'https://x/cb',
    getOrder: async () => ({ ...ORDER, ...over.order }),
    getOrderIdByToken: async () => ORDER.id,
    getBuyer: async () => ({ id: 'u1', name: 'Ali Veli', phone: '+905551112233', email: 'a@b.co' }),
    getSellerCity: async () => 'İstanbul',
    getMarketplaceAccount: async () => ({ enabled: false, subMerchantKey: null }),
    getTransactions: async () => [{ paymentTransactionId: '9', paidPrice: 110.5 }],
    getPaymentFlow: async () => ({ marketplace: false, paymentId: 'P1' }),
    iyzico: async () => {
      calls.iyzico += 1;
      if (over.iyzicoThrows) throw new Error('ağ');
      return over.iyzico ?? { status: 'success', token: 't', paymentPageUrl: 'https://p' };
    },
    claimInit: async () => over.claimInit ?? true,
    releaseInit: async () => { calls.released += 1; },
    claimRefund: async () => over.claimRefund ?? true,
    releaseRefund: async () => { calls.refundReleased = (calls.refundReleased ?? 0) + 1; },
    recordInit: async () => { calls.recorded += 1; },
    recordError: async () => undefined,
    flagRefund: async () => undefined,
    markPaid: async () => { calls.paid += 1; return 'paid'; },
    markRefunded: async () => { calls.refunded += 1; },
    listOpenPayments: async () => over.open ?? [],
    closePayment: async () => { calls.closed += 1; },
    cancelUnpaid: async () => { calls.cancelled = (calls.cancelled ?? 0) + 1; },
  };
  return { deps, calls };
}

describe('Sipariş başına tek ödeme sayfası', () => {
  test('ikinci başlatma iyzico\'ya gitmez', async () => {
    const { deps, calls } = fake({ claimInit: false });
    assert.equal((await handleInit('u1', ORDER.id, 'x', deps)).status, 409);
    assert.equal(calls.iyzico, 0);
    assert.equal(calls.released, 0);
  });
  test('iyzico reddederse yeniden denenebilir', async () => {
    const { deps, calls } = fake({ iyzico: { status: 'failure', errorCode: '11' } });
    assert.equal((await handleInit('u1', ORDER.id, 'x', deps)).status, 502);
    assert.equal(calls.released, 1);
  });
  test('ağ hatasında da yeniden denenebilir', async () => {
    const { deps, calls } = fake({ iyzicoThrows: true });
    await assert.rejects(handleInit('u1', ORDER.id, 'x', deps));
    assert.equal(calls.released, 1);
  });
  test('başarılı başlatma kaydedilir, serbest bırakılmaz', async () => {
    const { deps, calls } = fake();
    assert.equal((await handleInit('u1', ORDER.id, 'x', deps)).status, 200);
    assert.equal(calls.recorded, 1);
    assert.equal(calls.released, 0);
  });
});

describe('Tekrarlanan geri çağrı', () => {
  test('ödenmiş sipariş yeniden işlenmez', async () => {
    const { deps, calls } = fake({ order: { payment_status: 'paid' } });
    assert.equal(await handleCallback('t', deps), 'success');
    assert.equal(calls.iyzico, 0);
    assert.equal(calls.paid, 0);
  });
  test('iade bekleyen sipariş başarılı sayılmaz', async () => {
    const { deps, calls } = fake({ order: { payment_status: 'refund_pending' } });
    assert.equal(await handleCallback('t', deps), 'failed');
    assert.equal(calls.iyzico, 0);
  });
});

describe('Mutabakat ve başlatılan kayıt', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const row = (minutes, token = null) => ({ order_id: ORDER.id, token, created_at: new Date(now - minutes * 60_000).toISOString() });
  test('yanıt beklenen yeni kayıt kapatılmaz', async () => {
    const { deps, calls } = fake({ open: [row(1)] });
    await handleReconcile(deps, now);
    assert.equal(calls.closed, 0);
  });
  test('yarım kalan eski kayıt kapatılır', async () => {
    const { deps, calls } = fake({ open: [row(45)] });
    await handleReconcile(deps, now);
    assert.equal(calls.closed, 1);
    assert.equal(calls.cancelled, 1);
  });
});

describe('İade', () => {
  test('reddedilen iade hemen yeniden denenebilir, sonucu belirsiz olan beklemede kalır', async () => {
    const refused = fake({ order: { payment_status: 'refund_pending' }, iyzico: { status: 'failure', errorCode: '1' } });
    assert.equal((await handleRefund(true, ORDER.id, 'x', refused.deps)).status, 502);
    assert.equal(refused.calls.refundReleased, 1);
    const lost = fake({ order: { payment_status: 'refund_pending' }, iyzicoThrows: true });
    assert.equal((await handleRefund(true, ORDER.id, 'x', lost.deps)).status, 502);
    assert.equal(lost.calls.refundReleased, undefined);
  });
  test('işlenmekte olan iade ikinci kez gönderilmez', async () => {
    const { deps, calls } = fake({ order: { payment_status: 'refund_pending' }, claimRefund: false });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 409);
    assert.equal(calls.iyzico, 0);
    assert.equal(calls.refunded, 0);
  });
});
