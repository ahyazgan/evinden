import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  authHeaders, buildCheckoutRequest, centsToPrice, evaluateRetrieve, iyzicoPost, priceToCents, PATHS, toGsmNumber,
} from '../../supabase/functions/_shared/iyzico.ts';
import { normalizeTrPhone } from '../../lib/phone.ts';
import { handleCallback, handleInit, handleReconcile, handleRefund } from '../../supabase/functions/_shared/handlers.ts';

const config = { apiKey: 'sandbox-key', secretKey: 'sandbox-secret', baseUrl: 'https://sandbox-api.iyzipay.com' };
const ORDER = {
  id: '11111111-2222-4333-8444-555555555555', customer_id: 'u1', seller_id: 's1', status: 'awaiting_payment',
  payment_method: 'online', payment_status: 'pending', total_cents: 11050, delivery_address: 'Çekmeköy Mah. No:1',
};

describe('İmza (IYZWSv2)', () => {
  test('belgedeki formülle aynı: HMAC(randomKey + path + body) ve base64', async () => {
    const body = JSON.stringify({ locale: 'tr', ad: 'Şükrü' });
    const h = await authHeaders('/payment/bin/check', body, config, '123456789');
    const expected = createHmac('sha256', config.secretKey).update('123456789' + '/payment/bin/check' + body, 'utf8').digest('hex');
    assert.equal(h['x-iyzi-rnd'], '123456789');
    assert.ok(h.Authorization.startsWith('IYZWSv2 '));
    const decoded = Buffer.from(h.Authorization.slice(8), 'base64').toString();
    assert.equal(decoded, `apiKey:sandbox-key&randomKey:123456789&signature:${expected}`);
  });

  test('iyzico belgesindeki örnek başlıkla aynı biçim', () => {
    const doc = 'YXBpS2V5OnNhbmRib3gtbDlNZDFHajNJWWNtdTROZGFXeGFTVW9Db1g3REM1UkEmcmFuZG9tS2V5OjEyMzQ1Njc4OSZzaWduYXR1cmU6MDc5ZGY0YjI0MjZmYzdmNDIwOGQ4ZjIyZmJjMDM0OTc5NDAxOWY4Y2UyYjA3MTFkZTc4MDhiNDg3NGY0ZTc5Ng==';
    assert.match(Buffer.from(doc, 'base64').toString(), /^apiKey:[^&]+&randomKey:123456789&signature:[0-9a-f]{64}$/);
  });

  test('istek imzalanan gövdeyle aynı gövdeyi ve tam adresi kullanır', async () => {
    let seen;
    const fake = async (url, init) => { seen = { url, init }; return { json: async () => ({ status: 'success' }) }; };
    await iyzicoPost(PATHS.refund, { price: 1 }, config, fake);
    assert.equal(seen.url, 'https://sandbox-api.iyzipay.com/payment/refund');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.body, '{"price":1}');
    const sig = Buffer.from(seen.init.headers.Authorization.slice(8), 'base64').toString().split('signature:')[1];
    const rnd = seen.init.headers['x-iyzi-rnd'];
    assert.equal(sig, createHmac('sha256', config.secretKey).update(rnd + PATHS.refund + '{"price":1}').digest('hex'));
  });
});

describe('Tutar çevirimi', () => {
  test('kuruş hatası olmaz', () => {
    for (const c of [1, 10, 110, 11050, 1999, 2905, 1234567]) {
      assert.equal(priceToCents(centsToPrice(c)), c);
    }
    assert.equal(priceToCents('110.50'), 11050);
    assert.equal(priceToCents(19.99), 1999);
  });
});

describe('Ödeme isteği', () => {
  const build = (buyer = {}) => buildCheckoutRequest({
    order: ORDER,
    buyer: { id: 'u1', name: 'Ayşe Nur Yılmaz', phone: '+905551112233', email: 'a@b.co', ...buyer },
    city: 'İstanbul', callbackUrl: 'https://x/cb', ip: '1.2.3.4',
  });

  test('sepet toplamı fiyata eşittir; taksit kapalıdır', () => {
    const r = build();
    assert.equal(r.price, 110.5);
    assert.equal(r.paidPrice, 110.5);
    assert.equal(r.basketItems.reduce((s, i) => s + i.price, 0), r.price);
    assert.deepEqual(r.enabledInstallments, [1]);
    assert.equal(r.basketId, ORDER.id);
    assert.equal(r.conversationId, ORDER.id);
    assert.equal(r.buyer.name, 'Ayşe');
    assert.equal(r.buyer.surname, 'Nur Yılmaz');
    assert.equal(r.buyer.ip, '1.2.3.4');
  });

  test('zorunlu alanlar eksik müşteri bilgisinde de boş kalmaz', () => {
    const r = build({ name: null, phone: null, email: null });
    assert.ok(r.buyer.name && r.buyer.surname && r.buyer.email && r.buyer.identityNumber);
    assert.equal(r.buyer.gsmNumber, undefined);
    assert.ok(r.billingAddress.address && r.billingAddress.contactName && r.billingAddress.city && r.billingAddress.country);
  });

  test('cüzdan müşteriyi tanısın: gerçek e-posta ve E.164 telefon gönderilir', () => {
    const r = build({ phone: '0555 111 22 33', email: ' ayse@ornek.com ' });
    assert.equal(r.buyer.gsmNumber, '+905551112233');
    assert.equal(r.buyer.email, 'ayse@ornek.com');
  });

  test('geçersiz telefon gönderilmez; e-postası olmayan müşteride zorunlu alan dolu kalır', () => {
    const r = build({ phone: '123', email: '  ' });
    assert.equal(r.buyer.gsmNumber, undefined);
    assert.equal(r.buyer.email, 'musteri@evinden.app');
  });
});

describe('iyzico telefon biçimi (E.164)', () => {
  test('Türkiye cep numarasının her yazımı +90 olur', () => {
    for (const phone of ['05551112233', '5551112233', '905551112233', '+905551112233', '+90 555 111 22 33', '0 (555) 111-22-33', '00905551112233']) {
      assert.equal(toGsmNumber(phone), '+905551112233', phone);
    }
  });

  test('yurt dışı numara yalnızca + ile yazıldıysa korunur', () => {
    assert.equal(toGsmNumber('+49 151 2345 6789'), '+4915123456789');
    assert.equal(toGsmNumber('4915123456789'), undefined);
  });

  test('geçersizse gönderilmez', () => {
    for (const phone of [null, undefined, '', '   ', '123', '02161112233', '+902161112233', '+90555', '+1234567890123456']) {
      assert.equal(toGsmNumber(phone), undefined, String(phone));
    }
  });

  test('uygulamanın telefon kuralıyla aynı sonucu verir', () => {
    for (const phone of ['05551112233', '5551112233', '905551112233', '+905551112233', '02161112233', '123', '5']) {
      assert.equal(toGsmNumber(phone), normalizeTrPhone(phone) ?? undefined, phone);
    }
  });
});

describe('Ödeme sonucu değerlendirme', () => {
  const ok = {
    status: 'success', paymentStatus: 'SUCCESS', basketId: ORDER.id, fraudStatus: 1, paidPrice: 110.5, paymentId: '24478123',
    itemTransactions: [{ paymentTransactionId: '999', paidPrice: 110.5 }],
  };

  test('tam geçerli sonuç ödendi sayılır', () => {
    const r = evaluateRetrieve(ORDER, ok);
    assert.equal(r.paid, true);
    assert.equal(r.paymentId, '24478123');
    assert.equal(r.paidCents, 11050);
    assert.equal(r.transactions.length, 1);
  });

  const reject = {
    'istek başarısız': { status: 'failure' },
    'ödeme başarısız': { paymentStatus: 'FAILURE' },
    '3DS bekliyor': { paymentStatus: 'INIT_THREEDS' },
    'başka sipariş': { basketId: 'baska' },
    'dolandırıcılık incelemede': { fraudStatus: 0 },
    'dolandırıcılık bilgisi yok': { fraudStatus: undefined },
    'dolandırıcılık reddi': { fraudStatus: -1 },
    'eksik tutar': { paidPrice: 110.49 },
    'fazla tutar': { paidPrice: 110.51 },
    'ödeme numarası yok': { paymentId: undefined },
  };
  for (const [name, change] of Object.entries(reject)) {
    test(`reddedilir: ${name}`, () => {
      assert.equal(evaluateRetrieve(ORDER, { ...ok, ...change }).paid, false);
    });
  }
});

function fakeDeps(over = {}) {
  const calls = { iyzico: [], init: [], paid: [], refunded: [], errors: [], flagged: [], cancelled: [], closed: [] };
  const deps = {
    callbackUrl: 'https://x/functions/v1/payment-callback',
    iyzico: async (path, payload) => {
      calls.iyzico.push({ path, payload });
      if (over.iyzicoThrows) throw new Error('ağ hatası');
      return over.iyzicoResult ?? {};
    },
    flagRefund: async (...a) => { calls.flagged.push(a); },
    listOpenPayments: async () => over.open ?? [],
    cancelUnpaid: async id => { calls.cancelled.push(id); },
    closePayment: async id => { calls.closed.push(id); },
    getOrder: async () => over.order ?? ORDER,
    getOrderIdByToken: async t => (t === 'good-token' ? ORDER.id : null),
    getBuyer: async id => ({ id, name: 'Ali Veli', phone: null, email: 'a@b.co' }),
    getSellerCity: async () => 'İstanbul',
    getTransactions: async () => over.transactions ?? [{ paymentTransactionId: '999', paidPrice: 110.5 }],
    recordInit: async (id, t) => { calls.init.push([id, t]); },
    markPaid: async (...a) => { calls.paid.push(a); return over.markPaidResult ?? 'paid'; },
    markRefunded: async id => { if (over.markRefundedThrows) throw new Error('db'); calls.refunded.push(id); },
    recordError: async (id, e) => { calls.errors.push([id, e]); },
  };
  return { deps, calls };
}

describe('Ödeme başlatma', () => {
  test('başarılı: tutar veritabanından gelir, token kaydedilir', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { status: 'success', token: 'T', paymentPageUrl: 'https://pay' } });
    const r = await handleInit('u1', ORDER.id, '1.1.1.1', deps);
    assert.equal(r.status, 200);
    assert.equal(r.body.paymentPageUrl, 'https://pay');
    assert.deepEqual(calls.init, [[ORDER.id, 'T']]);
    assert.equal(calls.iyzico[0].path, PATHS.initialize);
    assert.equal(calls.iyzico[0].payload.price, 110.5);
    assert.equal(calls.iyzico[0].payload.callbackUrl, deps.callbackUrl);
  });

  test('başkasının siparişi için başlatılamaz; iyzico çağrılmaz', async () => {
    const { deps, calls } = fakeDeps();
    assert.equal((await handleInit('baskasi', ORDER.id, 'x', deps)).status, 404);
    assert.equal(calls.iyzico.length, 0);
  });

  test('ödenmiş, iptal edilmiş veya nakit sipariş için başlatılamaz', async () => {
    for (const change of [{ status: 'pending' }, { status: 'cancelled' }, { payment_status: 'paid' }, { payment_method: 'cash' }]) {
      const { deps, calls } = fakeDeps({ order: { ...ORDER, ...change } });
      assert.equal((await handleInit('u1', ORDER.id, 'x', deps)).status, 409, JSON.stringify(change));
      assert.equal(calls.iyzico.length, 0);
    }
  });

  test('sipariş numarası yoksa 400; iyzico hatasında token kaydedilmez', async () => {
    assert.equal((await handleInit('u1', undefined, 'x', fakeDeps().deps)).status, 400);
    const { deps, calls } = fakeDeps({ iyzicoResult: { status: 'failure', errorCode: '11' } });
    assert.equal((await handleInit('u1', ORDER.id, 'x', deps)).status, 502);
    assert.equal(calls.init.length, 0);
  });
});

describe('Geri çağrı', () => {
  const success = { status: 'success', paymentStatus: 'SUCCESS', basketId: ORDER.id, fraudStatus: 1, paidPrice: 110.5, paymentId: 'P1', itemTransactions: [{ paymentTransactionId: '9', paidPrice: 110.5 }] };

  test('başarılı ödeme iyzico\'dan doğrulanıp işlenir', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: success });
    assert.equal(await handleCallback('good-token', deps), 'success');
    assert.equal(calls.iyzico[0].path, PATHS.retrieve);
    assert.equal(calls.iyzico[0].payload.token, 'good-token');
    assert.equal(calls.paid[0][0], ORDER.id);
    assert.equal(calls.paid[0][1], 'P1');
    assert.equal(calls.paid[0][3], 11050);
  });

  test('sahte veya tanımadığımız token iyzico\'ya bile gitmez', async () => {
    for (const token of ['sahte', '', undefined, null, 42]) {
      const { deps, calls } = fakeDeps({ iyzicoResult: success });
      assert.equal(await handleCallback(token, deps), 'failed');
      assert.equal(calls.iyzico.length, 0);
      assert.equal(calls.paid.length, 0);
    }
  });

  test('başarısız ödeme işlenmez, hata kaydedilir', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { ...success, paymentStatus: 'FAILURE' } });
    assert.equal(await handleCallback('good-token', deps), 'failed');
    assert.equal(calls.paid.length, 0);
    assert.equal(calls.errors.length, 1);
  });

  test('para çekilmiş ama tutar uyuşmuyorsa iade kuyruğuna girer', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { ...success, paidPrice: 1 } });
    assert.equal(await handleCallback('good-token', deps), 'failed');
    assert.equal(calls.paid.length, 0);
    assert.equal(calls.flagged[0][0], ORDER.id);
    assert.equal(calls.flagged[0][1], 'P1');
  });

  test('sipariş iptal olmuşken gelen ödeme müşteriye başarılı gösterilmez', async () => {
    const { deps } = fakeDeps({ iyzicoResult: success, markPaidResult: 'refund_pending' });
    assert.equal(await handleCallback('good-token', deps), 'failed');
  });
});

describe('Mutabakat: hiçbir ödeme kayda geçmeden kalmaz', () => {
  const success = { status: 'success', paymentStatus: 'SUCCESS', basketId: ORDER.id, fraudStatus: 1, paidPrice: 110.5, paymentId: 'P1', itemTransactions: [{ paymentTransactionId: '9', paidPrice: 110.5 }] };
  const NOW = Date.parse('2026-11-05T12:00:00Z');
  const row = (minutesAgo, token = 'T') => ({ order_id: ORDER.id, token, created_at: new Date(NOW - minutesAgo * 60_000).toISOString() });

  test('geri çağrısı kaybolmuş başarılı ödeme bulunur ve işlenir', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: success, open: [row(5)] });
    const s = await handleReconcile(deps, NOW);
    assert.equal(s.paid, 1);
    assert.equal(calls.iyzico[0].path, PATHS.retrieve);
    assert.equal(calls.paid[0][3], 11050);
    assert.equal(calls.cancelled.length, 0);
  });

  test('iptal edilmiş siparişin geç gelen ödemesi de bulunur', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: success, open: [row(600)], order: { ...ORDER, status: 'cancelled' }, markPaidResult: 'refund_pending' });
    await handleReconcile(deps, NOW);
    assert.equal(calls.paid.length, 1, 'mark_order_paid iade kuyruğuna alır');
  });

  test('tamamlanmamış ödeme hemen iptal edilmez, 30 dakikada iptal edilir, kayıt açık kalır', async () => {
    const fail = { status: 'success', paymentStatus: 'FAILURE' };
    const erken = fakeDeps({ iyzicoResult: fail, open: [row(10)] });
    await handleReconcile(erken.deps, NOW);
    assert.equal(erken.calls.cancelled.length, 0);

    const gec = fakeDeps({ iyzicoResult: fail, open: [row(31)] });
    await handleReconcile(gec.deps, NOW);
    assert.deepEqual(gec.calls.cancelled, [ORDER.id]);
    assert.equal(gec.calls.closed.length, 0, 'geç gelen ödeme için sorgu sürer');
  });

  test('72 saat sonra ödenmemiş kayıt kapanır', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { status: 'failure' }, open: [row(73 * 60)], order: { ...ORDER, status: 'cancelled' } });
    await handleReconcile(deps, NOW);
    assert.deepEqual(calls.closed, [ORDER.id]);
    assert.equal(calls.cancelled.length, 0, 'zaten iptal');
  });

  test('dolandırıcılık incelemesindeki ödeme iptal edilmez, beklenir', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { ...success, fraudStatus: 0 }, open: [row(120)] });
    await handleReconcile(deps, NOW);
    assert.equal(calls.paid.length, 0);
    assert.equal(calls.cancelled.length, 0);
    assert.equal(calls.errors.length, 1);
  });

  test('tutar uyuşmazlığı iade kuyruğuna girer', async () => {
    const { deps, calls } = fakeDeps({ iyzicoResult: { ...success, paidPrice: 5 }, open: [row(5)] });
    assert.equal((await handleReconcile(deps, NOW)).flagged, 1);
    assert.equal(calls.flagged.length, 1);
  });

  test('iyzico erişilemezse kayıt açık kalır; bir hata diğerlerini durdurmaz', async () => {
    const { deps, calls } = fakeDeps({ iyzicoThrows: true, open: [row(5), row(6)] });
    const s = await handleReconcile(deps, NOW);
    assert.equal(s.errors, 2);
    assert.equal(s.checked, 2);
    assert.equal(calls.closed.length, 0);
    assert.equal(calls.cancelled.length, 0);
  });

  test('zaten sonuçlanmış sipariş sorgulanmadan kapanır', async () => {
    const { deps, calls } = fakeDeps({ open: [row(5)], order: { ...ORDER, payment_status: 'paid' } });
    await handleReconcile(deps, NOW);
    assert.equal(calls.iyzico.length, 0);
    assert.deepEqual(calls.closed, [ORDER.id]);
  });
});

describe('İade', () => {
  const pending = { ...ORDER, status: 'cancelled', payment_status: 'refund_pending' };

  test('yönetici iade eder: işlem numarası ve tutar iyzico\'ya gider', async () => {
    const { deps, calls } = fakeDeps({ order: pending, iyzicoResult: { status: 'success' } });
    const r = await handleRefund(true, ORDER.id, '1.1.1.1', deps);
    assert.equal(r.status, 200);
    assert.equal(calls.iyzico[0].path, PATHS.refund);
    assert.equal(calls.iyzico[0].payload.paymentTransactionId, '999');
    assert.equal(calls.iyzico[0].payload.price, 110.5);
    assert.deepEqual(calls.refunded, [ORDER.id]);
  });

  test('yönetici değilse hiçbir şey yapılmaz', async () => {
    const { deps, calls } = fakeDeps({ order: pending });
    assert.equal((await handleRefund(false, ORDER.id, 'x', deps)).status, 403);
    assert.equal(calls.iyzico.length, 0);
  });

  test('iade beklemeyen sipariş iki kez iade edilemez', async () => {
    const { deps, calls } = fakeDeps({ order: { ...ORDER, payment_status: 'refunded' } });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 409);
    assert.equal(calls.iyzico.length, 0);
  });

  test('iyzico reddederse iade tamamlandı sayılmaz', async () => {
    const { deps, calls } = fakeDeps({ order: pending, iyzicoResult: { status: 'failure', errorCode: '5' } });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 502);
    assert.equal(calls.refunded.length, 0);
    assert.equal(calls.errors.length, 1);
  });

  test('iyzico yanıtı kaybolursa iade tamamlandı sayılmaz, panelden kontrol istenir', async () => {
    const { deps, calls } = fakeDeps({ order: pending, iyzicoThrows: true });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 502);
    assert.equal(calls.refunded.length, 0);
    assert.match(calls.errors[0][1], /panelinden/);
  });

  test('iade yapıldı ama kaydedilemediyse yöneticiye söylenir', async () => {
    const { deps, calls } = fakeDeps({ order: pending, iyzicoResult: { status: 'success' }, markRefundedThrows: true });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 502);
    assert.match(calls.errors[0][1], /işaretleyin/);
  });

  test('işlem numarası yoksa iyzico çağrılmaz', async () => {
    const { deps, calls } = fakeDeps({ order: pending, transactions: [] });
    assert.equal((await handleRefund(true, ORDER.id, 'x', deps)).status, 409);
    assert.equal(calls.iyzico.length, 0);
  });
});
