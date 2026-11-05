import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  authHeaders, buildCheckoutRequest, buildPlannedCheckoutRequest, buildSubmerchantCreate, buildSubmerchantUpdate,
  centsToDecimalString, centsToPrice, computeMarketplaceSplit, evaluateRetrieve, iyzicoPost, iyzicoPut, planCheckout,
  priceToCents, PATHS, redactSensitive, toGsmNumber, verifyMarketplaceTransactions,
} from '../../supabase/functions/_shared/iyzico.ts';
import { orderNetCents } from '../../lib/earnings.ts';
import { normalizeTrPhone } from '../../lib/phone.ts';
import {
  handleApprovals, handleCallback, handleInit, handleReconcile, handleRefund, handleSubmerchantSync,
} from '../../supabase/functions/_shared/handlers.ts';

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
    assert.equal(r.buyer.email, 'musteri@afiyetli.app');
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

const SUBMERCHANT = {
  seller: { id: 's1', display_name: 'Lokanta' },
  company: {
    company_type: 'LIMITED_OR_JOINT_STOCK_COMPANY', legal_company_title: 'Lokanta Gıda Ltd. Şti.', tax_office: 'Kadıköy',
    tax_number: '1234567890', identity_number: '10000000146', email: 'lokanta@ornek.com', gsm_number: '+905551112233',
    address: 'Moda Cad. No:1 Kadıköy',
  },
  payout: { iban: 'TR330006100519786457841326' },
  subMerchantKey: null,
};

function fakeDeps(over = {}) {
  const calls = {
    iyzico: [], init: [], paid: [], refunded: [], errors: [], flagged: [], cancelled: [], closed: [],
    plans: [], put: [], reversed: [], marketApproved: [], approved: [], approvalFailed: [], saved: [],
  };
  const deps = {
    callbackUrl: 'https://x/functions/v1/payment-callback',
    iyzico: async (path, payload) => {
      calls.iyzico.push({ path, payload });
      if (over.iyzicoThrows) throw new Error('ağ hatası');
      if (over.iyzicoRoute) return over.iyzicoRoute(path, payload);
      return over.iyzicoResult ?? {};
    },
    iyzicoPut: async (path, payload) => {
      calls.put.push({ path, payload });
      if (over.putThrows) throw new Error('ağ hatası');
      return over.putResult ?? { status: 'success' };
    },
    getMarketplaceAccount: async () => over.account ?? { enabled: false, subMerchantKey: null },
    getPaymentFlow: async () => over.flow ?? { marketplace: false, paymentId: null },
    beginMarketplaceRefund: async () => over.refundState ?? 'none',
    markMarketplaceApproved: async id => {
      if (over.markApprovedThrows) throw new Error('db');
      calls.marketApproved.push(id);
    },
    markMarketplaceReversed: async id => { calls.reversed.push(id); },
    claimApprovals: async () => over.approvals ?? [],
    completeApproval: async id => { calls.approved.push(id); },
    failApproval: async (id, error, final) => { calls.approvalFailed.push({ id, error, final }); },
    getSubmerchantInput: async () => (over.submerchantInput === undefined ? SUBMERCHANT : over.submerchantInput),
    saveSubmerchant: async (id, result) => { calls.saved.push({ id, ...result }); },
    flagRefund: async (...a) => { calls.flagged.push(a); },
    listOpenPayments: async () => over.open ?? [],
    cancelUnpaid: async id => { calls.cancelled.push(id); },
    closePayment: async id => { calls.closed.push(id); },
    getOrder: async () => over.order ?? ORDER,
    getOrderIdByToken: async t => (t === 'good-token' ? ORDER.id : null),
    getBuyer: async id => ({ id, name: 'Ali Veli', phone: null, email: 'a@b.co' }),
    getSellerCity: async () => 'İstanbul',
    getTransactions: async () => over.transactions ?? [{ paymentTransactionId: '999', paidPrice: 110.5 }],
    recordInit: async (id, t, plan) => { calls.init.push([id, t]); calls.plans.push(plan); },
    claimInit: async id => { calls.claims = (calls.claims ?? []).concat([id]); return over.claimInit ?? true; },
    releaseInit: async id => { calls.released = (calls.released ?? []).concat([id]); },
    claimRefund: async () => over.claimRefund ?? true,
    releaseRefund: async () => undefined,
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

// ── Pazaryeri (036) ────────────────────────────────────────────────────────

// Bugünkü kodun (036'dan önceki iyzico.ts) ürettiği istek, kaynaktan çalıştırılarak alındı. Elle güncellenmez:
// bu dize değişiyorsa anahtar kapalıyken iyzico'ya giden istek değişmiş demektir.
const GOLDEN_CHECKOUT = '{"locale":"tr","conversationId":"11111111-2222-4333-8444-555555555555","price":110.5,"paidPrice":110.5,"currency":"TRY","basketId":"11111111-2222-4333-8444-555555555555","paymentGroup":"PRODUCT","callbackUrl":"https://x/functions/v1/payment-callback","enabledInstallments":[1],"buyer":{"id":"u1","name":"Ali","surname":"Veli","identityNumber":"11111111111","email":"a@b.co","registrationAddress":"Çekmeköy Mah. No:1","city":"İstanbul","country":"Turkey","ip":"1.1.1.1"},"shippingAddress":{"address":"Çekmeköy Mah. No:1","contactName":"Ali Veli","city":"İstanbul","country":"Turkey"},"billingAddress":{"address":"Çekmeköy Mah. No:1","contactName":"Ali Veli","city":"İstanbul","country":"Turkey"},"basketItems":[{"id":"11111111-2222-4333-8444-555555555555","name":"Afiyetli siparişi #11111111","category1":"Yemek","itemType":"PHYSICAL","price":110.5}]}';

// ₺100 satış + ₺15 teslimat - %8 komisyon: toplam ₺110,50 olsun diye ₺4,50 platform indirimi.
const MONEY = { subtotal_cents: 10000, delivery_fee_cents: 1500, platform_delivery_cents: 0, seller_discount_cents: 0, commission_cents: 800, tip_cents: 0 };
const PRICED = { ...ORDER, ...MONEY, total_cents: 11500 };
const INIT_OK = { iyzicoResult: { status: 'success', token: 'T', paymentPageUrl: 'https://pay' } };

describe('Pazaryeri bölüşümü', () => {
  test('komisyon platformda kalır, satıcı payı order_net_cents ile aynıdır', () => {
    assert.deepEqual(computeMarketplaceSplit(PRICED), { ok: true, priceCents: 11500, subMerchantCents: 10700, platformCents: 800 });
  });

  test('bahşişin tamamı restoranın: platform payı değişmez', () => {
    const split = computeMarketplaceSplit({ ...PRICED, tip_cents: 2500, total_cents: 14000 });
    assert.equal(split.subMerchantCents, 13200);
    assert.equal(split.platformCents, 800);
  });

  test('satıcının kendi indirimi kendi payından düşer', () => {
    // Komisyon indirimli satıştan alınır: (10000 - 2000) x %8 = 640.
    const split = computeMarketplaceSplit({ ...PRICED, seller_discount_cents: 2000, commission_cents: 640, total_cents: 9500 });
    assert.equal(split.subMerchantCents, 8860);
    assert.equal(split.platformCents, 640);
  });

  test('platformun karşıladığı teslimat satıcıya gider, platform payından çıkar', () => {
    const split = computeMarketplaceSplit({ ...PRICED, delivery_fee_cents: 0, platform_delivery_cents: 500, total_cents: 10000 });
    assert.equal(split.subMerchantCents, 9700);
    assert.equal(split.platformCents, 300);
  });

  test('satıcı payı sepeti aşıyorsa pazaryeri kurulmaz: para sepette yok', () => {
    // Platform kuponu ₺20: müşteri ₺95 öder, satıcının hakkı ₺107.
    const split = computeMarketplaceSplit({ ...PRICED, total_cents: 9500 });
    assert.deepEqual(split, { ok: false, reason: 'platform_share_not_positive' });
  });

  test('platform payı sıfırsa da kurulmaz: iyzico ücreti düşülecek para kalmaz', () => {
    const split = computeMarketplaceSplit({ ...PRICED, commission_cents: 0, total_cents: 11500 });
    assert.deepEqual(split, { ok: false, reason: 'platform_share_not_positive' });
  });

  test('satıcı payı sıfır veya eksiyse kurulmaz', () => {
    const split = computeMarketplaceSplit({ ...PRICED, subtotal_cents: 100, delivery_fee_cents: 0, commission_cents: 100, total_cents: 100 });
    assert.deepEqual(split, { ok: false, reason: 'seller_share_not_positive' });
  });

  test('kuruş olmayan tutar reddedilir', () => {
    for (const bad of [{ total_cents: 110.5 }, { commission_cents: NaN }, { subtotal_cents: undefined }, { total_cents: 0 }]) {
      assert.deepEqual(computeMarketplaceSplit({ ...PRICED, ...bad }), { ok: false, reason: 'invalid_amounts' }, JSON.stringify(bad));
    }
  });

  test('yuvarlama: her tutar ve oranda paylar toplamı tam tutar, satıcı payı uygulamadaki hesapla aynı', () => {
    let checked = 0;
    for (const rate of [5, 7.5, 8, 12.5, 15, 33.33]) {
      for (let subtotal = 101; subtotal < 60000; subtotal += 997) {
        for (const [delivery, tip] of [[0, 0], [1999, 0], [1505, 333], [0, 7]]) {
          const commission = Math.round(subtotal * rate / 100);
          const order = { ...MONEY, subtotal_cents: subtotal, delivery_fee_cents: delivery, tip_cents: tip, commission_cents: commission, total_cents: subtotal + delivery + tip };
          const split = computeMarketplaceSplit(order);
          assert.equal(split.ok, true);
          assert.equal(split.subMerchantCents + split.platformCents, order.total_cents);
          assert.equal(split.subMerchantCents, orderNetCents(order));
          checked += 1;
        }
      }
    }
    assert.ok(checked > 1000);
  });

  test('ondalık metin kayan nokta hatası yapmaz: her kuruş geri aynı döner', () => {
    assert.equal(centsToDecimalString(9420), '94.20');
    assert.equal(centsToDecimalString(5), '0.05');
    assert.equal(centsToDecimalString(100), '1.00');
    assert.equal(centsToDecimalString(11050), '110.50');
    for (let c = 1; c <= 30000; c += 1) assert.equal(priceToCents(centsToDecimalString(c)), c);
    assert.throws(() => centsToDecimalString(1.5));
    assert.throws(() => centsToDecimalString(-1));
  });

  test('istekte sepet toplamı price ve paidPrice ile tam eşit, satıcı payı kırılımda', () => {
    for (const total of [11500, 1999, 2905, 10001, 123456]) {
      const order = { ...PRICED, subtotal_cents: total, delivery_fee_cents: 0, commission_cents: Math.round(total * 0.08), total_cents: total };
      const plan = planCheckout(order, { enabled: true, subMerchantKey: 'KEY' });
      const r = buildPlannedCheckoutRequest({ order, buyer: { id: 'u1', name: 'Ali', phone: null, email: null }, city: null, callbackUrl: 'x', ip: 'y' }, plan);
      assert.equal(r.price, r.paidPrice);
      assert.equal(r.basketItems.reduce((s, i) => s + i.price, 0), r.price);
      assert.equal(priceToCents(r.price), total);
      assert.equal(r.basketItems.length, 1);
      assert.equal(r.basketItems[0].subMerchantKey, 'KEY');
      assert.equal(priceToCents(r.basketItems[0].subMerchantPrice), total - Math.round(total * 0.08));
    }
  });
});

describe('Pazaryeri anahtarı ve ödeme başlatma', () => {
  test('kapalıyken istek bugünkü istekle bayt bayt aynı', async () => {
    const { deps, calls } = fakeDeps({ ...INIT_OK, order: PRICED, account: { enabled: false, subMerchantKey: null } });
    const r = await handleInit('u1', ORDER.id, '1.1.1.1', { ...deps, getOrder: async () => ({ ...PRICED, total_cents: 11050 }) });
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(calls.iyzico[0].payload), GOLDEN_CHECKOUT);
    assert.deepEqual(calls.plans, [{ flow: 'standard' }]);
  });

  test('anahtar okunamazsa ödeme başlamaz: yanlış akışla para alınmaz', async () => {
    const { deps, calls } = fakeDeps(INIT_OK);
    await assert.rejects(handleInit('u1', ORDER.id, 'x', { ...deps, getMarketplaceAccount: async () => { throw new Error('db'); } }));
    assert.equal(calls.iyzico.length, 0);
  });

  test('kapalıyken satıcının anahtarı olsa da kullanılmaz', () => {
    assert.deepEqual(planCheckout(PRICED, { enabled: false, subMerchantKey: 'KEY' }), { flow: 'standard' });
  });

  test('kapalı akış buildCheckoutRequest ile aynıdır', () => {
    const input = { order: PRICED, buyer: { id: 'u1', name: 'Ali', phone: null, email: null }, city: 'İstanbul', callbackUrl: 'x', ip: 'y' };
    assert.equal(JSON.stringify(buildPlannedCheckoutRequest(input, { flow: 'standard' })), JSON.stringify(buildCheckoutRequest(input)));
  });

  test('açık ve anahtar varsa: yalnızca kırılıma iki alan eklenir', async () => {
    const { deps, calls } = fakeDeps({ ...INIT_OK, order: { ...PRICED, total_cents: 11050, commission_cents: 800, seller_discount_cents: 450 }, account: { enabled: true, subMerchantKey: 'KEY' } });
    await handleInit('u1', ORDER.id, '1.1.1.1', deps);
    const expected = JSON.parse(GOLDEN_CHECKOUT);
    expected.basketItems[0] = { ...expected.basketItems[0], subMerchantKey: 'KEY', subMerchantPrice: '102.50' };
    assert.equal(JSON.stringify(calls.iyzico[0].payload), JSON.stringify(expected));
    assert.deepEqual(calls.plans, [{ flow: 'marketplace', subMerchantKey: 'KEY', subMerchantCents: 10250 }]);
  });

  test('açık ama anahtar yoksa: LISTING, alt üye alanı yok, sebep kayda geçer', async () => {
    const { deps, calls } = fakeDeps({ ...INIT_OK, order: PRICED, account: { enabled: true, subMerchantKey: null } });
    await handleInit('u1', ORDER.id, '1.1.1.1', deps);
    const sent = calls.iyzico[0].payload;
    assert.equal(sent.paymentGroup, 'LISTING');
    assert.equal(sent.basketItems[0].subMerchantKey, undefined);
    assert.equal(sent.basketItems[0].subMerchantPrice, undefined);
    assert.deepEqual(calls.plans, [{ flow: 'listing', reason: 'no_submerchant_key' }]);
  });

  test('açık, anahtar var ama platform kuponu payı aşıyor: LISTING', async () => {
    const { deps, calls } = fakeDeps({ ...INIT_OK, order: { ...PRICED, total_cents: 9500 }, account: { enabled: true, subMerchantKey: 'KEY' } });
    await handleInit('u1', ORDER.id, '1.1.1.1', deps);
    assert.equal(calls.iyzico[0].payload.paymentGroup, 'LISTING');
    assert.deepEqual(calls.plans, [{ flow: 'listing', reason: 'platform_share_not_positive' }]);
  });
});

describe('Dönen kırılımın denetimi', () => {
  const expected = { subMerchantKey: 'KEY', subMerchantCents: 10700 };
  test('eşleşen kırılım ve alanları dönmeyen kırılım geçer', () => {
    assert.equal(verifyMarketplaceTransactions([{ paymentTransactionId: '1', subMerchantKey: 'KEY', subMerchantPrice: 107 }], expected), null);
    assert.equal(verifyMarketplaceTransactions([{ paymentTransactionId: '1' }], expected), null);
  });
  for (const [name, tx, exp] of [
    ['kırılım yok', [], expected],
    ['işlem numarası yok', [{ subMerchantKey: 'KEY' }], expected],
    ['başka alt üye', [{ paymentTransactionId: '1', subMerchantKey: 'BASKA' }], expected],
    ['başka tutar', [{ paymentTransactionId: '1', subMerchantPrice: 107.01 }], expected],
    ['bizde kayıt yok', [{ paymentTransactionId: '1' }], { subMerchantKey: null, subMerchantCents: null }],
  ]) {
    test(`reddedilir: ${name}`, () => assert.ok(verifyMarketplaceTransactions(tx, exp)));
  }
});

describe('Alt üye kaydı', () => {
  const quietly = async (fn) => {
    const seen = [];
    const original = console.error;
    console.error = (...a) => seen.push(a.join(' '));
    try { return { result: await fn(), logged: seen.join(' ') }; } finally { console.error = original; }
  };
  const on = { account: { enabled: true, subMerchantKey: null } };

  test('yönetici değilse veya anahtar kapalıysa iyzico çağrılmaz', async () => {
    let f = fakeDeps(on);
    assert.equal((await handleSubmerchantSync(false, 's1', f.deps)).status, 403);
    assert.equal(f.calls.iyzico.length, 0);
    f = fakeDeps();
    assert.equal((await handleSubmerchantSync(true, 's1', f.deps)).status, 409);
    assert.equal(f.calls.iyzico.length, 0);
  });

  test('satıcı numarası yoksa 400, satıcı yoksa 404', async () => {
    assert.equal((await handleSubmerchantSync(true, undefined, fakeDeps(on).deps)).status, 400);
    assert.equal((await handleSubmerchantSync(true, 's1', fakeDeps({ ...on, submerchantInput: null }).deps)).status, 404);
  });

  test('eksik bilgide iyzico çağrılmaz, yanıtta değer değil alan adı vardır', async () => {
    const f = fakeDeps({ ...on, submerchantInput: { ...SUBMERCHANT, payout: null } });
    const r = await handleSubmerchantSync(true, 's1', f.deps);
    assert.equal(r.status, 422);
    assert.match(r.body.error, /IBAN/);
    assert.equal(f.calls.iyzico.length, 0);
    const g = fakeDeps({ ...on, submerchantInput: { ...SUBMERCHANT, company: null } });
    assert.match((await handleSubmerchantSync(true, 's1', g.deps)).body.error, /şirket/);
  });

  test('oluşturma: belgedeki adrese gider, anahtar saklanır', async () => {
    const f = fakeDeps({ ...on, iyzicoResult: { status: 'success', subMerchantKey: 'YENI' } });
    const r = await handleSubmerchantSync(true, 's1', f.deps);
    assert.equal(r.status, 200);
    assert.equal(f.calls.iyzico[0].path, '/onboarding/submerchant');
    const body = f.calls.iyzico[0].payload;
    assert.equal(body.subMerchantType, 'LIMITED_OR_JOINT_STOCK_COMPANY');
    assert.equal(body.subMerchantExternalId, 's1');
    assert.equal(body.taxNumber, '1234567890');
    assert.equal(body.legalCompanyTitle, 'Lokanta Gıda Ltd. Şti.');
    assert.equal(body.identityNumber, '10000000146');
    assert.equal(body.iban, SUBMERCHANT.payout.iban);
    assert.equal(body.currency, 'TRY');
    assert.deepEqual(f.calls.saved, [{ id: 's1', key: 'YENI', error: null }]);
    assert.equal(f.calls.put.length, 0);
  });

  test('şahıs şirketinde vergi numarası boşsa hiç gönderilmez', () => {
    const input = { ...SUBMERCHANT, company: { ...SUBMERCHANT.company, company_type: 'PRIVATE_COMPANY', tax_number: null } };
    const body = buildSubmerchantCreate(input);
    assert.equal(body.subMerchantType, 'PRIVATE_COMPANY');
    assert.equal('taxNumber' in body, false);
  });

  test('güncelleme: PUT, anahtarla, subMerchantType olmadan', async () => {
    const f = fakeDeps({ ...on, submerchantInput: { ...SUBMERCHANT, subMerchantKey: 'ESKI' } });
    const r = await handleSubmerchantSync(true, 's1', f.deps);
    assert.equal(r.status, 200);
    assert.equal(f.calls.iyzico.length, 0);
    assert.equal(f.calls.put[0].path, '/onboarding/submerchant');
    assert.equal(f.calls.put[0].payload.subMerchantKey, 'ESKI');
    assert.equal('subMerchantType' in f.calls.put[0].payload, false);
    assert.equal('subMerchantExternalId' in f.calls.put[0].payload, false);
    assert.deepEqual(f.calls.saved, [{ id: 's1', key: 'ESKI', error: null }]);
    assert.equal('subMerchantType' in buildSubmerchantUpdate(SUBMERCHANT, 'K'), false);
  });

  test('yanıtı kaybolmuş kayıt (2002): anahtar sorgulanır, ikinci alt üye açılmaz', async () => {
    const f = fakeDeps({
      ...on,
      iyzicoRoute: path => (path === PATHS.submerchant
        ? { status: 'failure', errorCode: '2002', errorMessage: 'Alt üye işyeri bulunmaktadır' }
        : { status: 'success', subMerchantKey: 'VARDI' }),
    });
    const r = await handleSubmerchantSync(true, 's1', f.deps);
    assert.equal(r.status, 200);
    assert.equal(f.calls.iyzico[1].path, '/onboarding/submerchant/detail');
    assert.equal(f.calls.iyzico[1].payload.subMerchantExternalId, 's1');
    assert.equal(f.calls.put[0].payload.subMerchantKey, 'VARDI');
    assert.deepEqual(f.calls.saved, [{ id: 's1', key: 'VARDI', error: null }]);
  });

  test('iyzico reddederse hata saklanır; IBAN ve kimlik ne günlüğe ne kayda ne yanıta geçer', async () => {
    const f = fakeDeps({
      ...on,
      iyzicoResult: { status: 'failure', errorCode: '2030', errorMessage: `IBAN hatalı: ${SUBMERCHANT.payout.iban}, kimlik 10000000146` },
    });
    const { result: r, logged } = await quietly(() => handleSubmerchantSync(true, 's1', f.deps));
    assert.equal(r.status, 502);
    assert.equal(f.calls.saved[0].key, null);
    for (const text of [logged, f.calls.saved[0].error, r.body.error]) {
      assert.doesNotMatch(text, /TR33|10000000146|1234567890/);
    }
    assert.match(f.calls.saved[0].error, /2030/);
  });

  test('güncelleme başarısızsa mevcut anahtar korunur: ödemeler durmaz', async () => {
    const f = fakeDeps({ ...on, submerchantInput: { ...SUBMERCHANT, subMerchantKey: 'ESKI' }, putResult: { status: 'failure', errorCode: '2005' } });
    const { result: r } = await quietly(() => handleSubmerchantSync(true, 's1', f.deps));
    assert.equal(r.status, 502);
    assert.equal(f.calls.saved[0].key, 'ESKI');
    assert.ok(f.calls.saved[0].error);
  });

  test('ağ hatasında tamamlandı sayılmaz', async () => {
    const f = fakeDeps({ ...on, iyzicoThrows: true });
    const { result: r } = await quietly(() => handleSubmerchantSync(true, 's1', f.deps));
    assert.equal(r.status, 502);
    assert.equal(f.calls.saved[0].key, null);
  });

  test('metin temizleme', () => {
    assert.equal(redactSensitive('a TR33 0006 1005 1978 6457 8413 26 b'), 'a *** b');
    assert.equal(redactSensitive('no 10000000146 ve 1234567890 kod 2030'), 'no *** ve *** kod 2030');
  });

  test('PUT da aynı imzayla ve tam adrese gider', async () => {
    let seen;
    const fake = async (url, init) => { seen = { url, init }; return { json: async () => ({ status: 'success' }) }; };
    await iyzicoPut(PATHS.submerchant, { a: 1 }, config, fake);
    assert.equal(seen.url, 'https://sandbox-api.iyzipay.com/onboarding/submerchant');
    assert.equal(seen.init.method, 'PUT');
    const rnd = seen.init.headers['x-iyzi-rnd'];
    const sig = Buffer.from(seen.init.headers.Authorization.slice(8), 'base64').toString().split('signature:')[1];
    assert.equal(sig, createHmac('sha256', config.secretKey).update(rnd + PATHS.submerchant + '{"a":1}').digest('hex'));
  });
});

describe('Onay kuyruğu', () => {
  const row = (over = {}) => ({
    order_id: 'o1', attempts: 1, submerchant_key: 'KEY', submerchant_price_cents: 10700,
    transactions: [{ paymentTransactionId: 27206433, subMerchantKey: 'KEY', subMerchantPrice: 107 }], ...over,
  });

  test('belgedeki adrese işlem numarasıyla gider, tamamlanır', async () => {
    const f = fakeDeps({ approvals: [row()], iyzicoResult: { status: 'success' } });
    const s = await handleApprovals(f.deps);
    assert.equal(f.calls.iyzico[0].path, '/payment/iyzipos/item/approve');
    assert.deepEqual(f.calls.iyzico[0].payload, { locale: 'tr', conversationId: 'o1', paymentTransactionId: '27206433' });
    assert.deepEqual(f.calls.approved, ['o1']);
    assert.equal(s.approved, 1);
    assert.equal(f.calls.approvalFailed.length, 0);
  });

  test('kuyruk boşsa iyzico çağrılmaz', async () => {
    const f = fakeDeps();
    assert.equal((await handleApprovals(f.deps)).claimed, 0);
    assert.equal(f.calls.iyzico.length, 0);
  });

  test('idempotent: daha önce onaylanmış kırılım (5064) başarı sayılır', async () => {
    const f = fakeDeps({ approvals: [row()], iyzicoResult: { status: 'failure', errorCode: 5064, errorMessage: 'Bu ödeme kırılımı önceden onaylanmıştır' } });
    await handleApprovals(f.deps);
    assert.deepEqual(f.calls.approved, ['o1']);
    assert.equal(f.calls.approvalFailed.length, 0);
  });

  test('iyzico reddederse tamamlanmaz, yeniden denenir', async () => {
    const f = fakeDeps({ approvals: [row()], iyzicoResult: { status: 'failure', errorCode: '5024', errorMessage: 'kimlik eksik' } });
    const s = await handleApprovals(f.deps);
    assert.equal(f.calls.approved.length, 0);
    assert.equal(f.calls.approvalFailed[0].final, false);
    assert.match(f.calls.approvalFailed[0].error, /5024/);
    assert.equal(s.retry, 1);
  });

  test('yanıt kaybolursa tamamlanmaz, yeniden denenir; ikinci deneme 5064 ile biter', async () => {
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const first = fakeDeps({ approvals: [row()], iyzicoThrows: true });
      assert.equal((await handleApprovals(first.deps)).errors, 1);
      assert.equal(first.calls.approved.length, 0);
      assert.equal(first.calls.approvalFailed[0].final, false);
    } finally {
      console.error = quiet;
    }
    const second = fakeDeps({ approvals: [row({ attempts: 2 })], iyzicoResult: { status: 'failure', errorCode: '5064' } });
    await handleApprovals(second.deps);
    assert.deepEqual(second.calls.approved, ['o1']);
  });

  test('iki kırılımdan biri hata verirse satır tamamlanmaz, yeniden deneme zarar vermez', async () => {
    const transactions = [{ paymentTransactionId: 1 }, { paymentTransactionId: 2 }];
    const first = fakeDeps({ approvals: [row({ transactions })], iyzicoRoute: (_, p) => (p.paymentTransactionId === '1' ? { status: 'success' } : { status: 'failure', errorCode: '11' }) });
    await handleApprovals(first.deps);
    assert.equal(first.calls.approved.length, 0);
    assert.equal(first.calls.approvalFailed.length, 1);
    const again = fakeDeps({ approvals: [row({ transactions })], iyzicoRoute: (_, p) => (p.paymentTransactionId === '1' ? { status: 'failure', errorCode: '5064' } : { status: 'success' }) });
    await handleApprovals(again.deps);
    assert.deepEqual(again.calls.approved, ['o1']);
  });

  test('tutar veya alt üye uyuşmuyorsa onay gönderilmez, yöneticiye kalır', async () => {
    for (const bad of [
      { submerchant_price_cents: 10699 },
      { submerchant_key: 'BASKA' },
      { transactions: [] },
      { transactions: [{ subMerchantKey: 'KEY' }] },
      { submerchant_key: null, submerchant_price_cents: null },
    ]) {
      const f = fakeDeps({ approvals: [row(bad)], iyzicoResult: { status: 'success' } });
      const s = await handleApprovals(f.deps);
      assert.equal(f.calls.iyzico.length, 0, JSON.stringify(bad));
      assert.equal(f.calls.approved.length, 0);
      assert.equal(f.calls.approvalFailed[0].final, true);
      assert.equal(s.blocked, 1);
    }
  });

  test('bir satırın hatası diğerini durdurmaz', async () => {
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const f = fakeDeps({
        approvals: [row({ order_id: 'o1' }), row({ order_id: 'o2' })],
        iyzicoRoute: (_, p) => { if (p.conversationId === 'o1') throw new Error('ağ'); return { status: 'success' }; },
      });
      await handleApprovals(f.deps);
      assert.deepEqual(f.calls.approved, ['o2']);
      assert.equal(f.calls.approvalFailed[0].id, 'o1');
    } finally {
      console.error = quiet;
    }
  });
});

describe('Pazaryeri iadesi', () => {
  const pending = { ...ORDER, status: 'delivered', payment_status: 'refund_pending' };
  const market = { marketplace: true, paymentId: 'P1' };
  const route = (status, disapprove = { status: 'success' }) => path => {
    if (path === PATHS.paymentDetail) return { status: 'success', itemTransactions: [{ paymentTransactionId: 999, transactionStatus: status }] };
    if (path === PATHS.disapprove) {
      if (disapprove === 'throw') throw new Error('ağ');
      return disapprove;
    }
    return { status: 'success' };
  };
  const paths = calls => calls.iyzico.map(c => c.path);

  test('pazaryeri olmayan siparişte iade bugünkü gibi: yalnızca iade isteği', async () => {
    const f = fakeDeps({ order: pending, iyzicoResult: { status: 'success' } });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.deepEqual(paths(f.calls), [PATHS.refund]);
    assert.equal(f.calls.reversed.length, 0);
  });

  test('onay verilmemişse geri çekme yok, doğrudan iade', async () => {
    const f = fakeDeps({ order: pending, flow: market, iyzicoRoute: route(1) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.deepEqual(paths(f.calls), [PATHS.paymentDetail, PATHS.refund]);
    assert.deepEqual(f.calls.reversed, [ORDER.id]);
    assert.deepEqual(f.calls.refunded, [ORDER.id]);
  });

  test('onay verilmişse önce geri çekilir, sonra iade edilir', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'approved', iyzicoRoute: route(2) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.deepEqual(paths(f.calls), [PATHS.paymentDetail, PATHS.disapprove, PATHS.refund]);
    assert.equal(f.calls.iyzico[1].payload.paymentTransactionId, '999');
    assert.deepEqual(f.calls.reversed, [ORDER.id]);
  });

  test('kayıtta bekliyor görünse de iyzico onaylı diyorsa geri çekilir (yanıtı kaybolmuş onay)', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'cancelled', iyzicoRoute: route(2) });
    await handleRefund(true, ORDER.id, 'ip', f.deps);
    assert.deepEqual(paths(f.calls), [PATHS.paymentDetail, PATHS.disapprove, PATHS.refund]);
  });

  test('onay geri çekilemezse iade YAPILMAZ, sipariş iade bekler kalır, yöneticiye söylenir', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'approved', iyzicoRoute: route(2, { status: 'failure', errorCode: '10' }) });
    const r = await handleRefund(true, ORDER.id, 'ip', f.deps);
    assert.equal(r.status, 502);
    assert.equal(paths(f.calls).includes(PATHS.refund), false);
    assert.equal(f.calls.refunded.length, 0);
    assert.equal(f.calls.reversed.length, 0);
    assert.match(f.calls.errors[0][1], /satıcıya geçmiş olabilir/);
  });

  test('iyzico onaylı diyorsa geri çekmeden ÖNCE onay kaydedilir: başarısız olursa borç doğabilsin', async () => {
    let recordedBeforeDisapprove = null;
    const f = fakeDeps({
      order: pending,
      flow: market,
      refundState: 'cancelled',
      iyzicoRoute: path => {
        if (path === PATHS.paymentDetail) return { status: 'success', itemTransactions: [{ paymentTransactionId: 999, transactionStatus: 2 }] };
        if (path === PATHS.disapprove) {
          recordedBeforeDisapprove = f.calls.marketApproved.length === 1;
          return { status: 'failure', errorCode: '10' };
        }
        return { status: 'success' };
      },
    });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 502);
    assert.equal(recordedBeforeDisapprove, true);
    assert.deepEqual(f.calls.marketApproved, [ORDER.id]);
    assert.equal(f.calls.reversed.length, 0);
    assert.equal(f.calls.refunded.length, 0);
  });

  test('geri çekme başarılıysa kayıt yine önce onaylı, sonra geri alındı olur', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'cancelled', iyzicoRoute: route(2) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.deepEqual(f.calls.marketApproved, [ORDER.id]);
    assert.deepEqual(f.calls.reversed, [ORDER.id]);
    assert.deepEqual(f.calls.refunded, [ORDER.id]);
  });

  test('iyzico onay bekliyor diyorsa onaylı kaydı yazılmaz', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'cancelled', iyzicoRoute: route(1) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.equal(f.calls.marketApproved.length, 0);
  });

  test('kırılımlardan biri onaylıysa diğerinin durumu anlaşılmasa da onaylı kaydedilir', async () => {
    const f = fakeDeps({
      order: pending,
      flow: market,
      transactions: [{ paymentTransactionId: '1', paidPrice: 50 }, { paymentTransactionId: '2', paidPrice: 60 }],
      iyzicoRoute: path => (path === PATHS.paymentDetail
        ? { status: 'success', itemTransactions: [{ paymentTransactionId: 1, transactionStatus: 0 }, { paymentTransactionId: 2, transactionStatus: 2 }] }
        : { status: 'success' }),
    });
    assert.notEqual((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 200);
    assert.deepEqual(f.calls.marketApproved, [ORDER.id]);
    assert.equal(paths(f.calls).includes(PATHS.refund), false);
  });

  test('onay kaydı yazılamazsa geri çekme ve iade denenmez, yeniden denenir', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'cancelled', iyzicoRoute: route(2), markApprovedThrows: true });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 502);
    assert.deepEqual(paths(f.calls), [PATHS.paymentDetail]);
    assert.equal(f.calls.refunded.length, 0);
    assert.match(f.calls.errors[0][1], /kaydedilemedi/);
  });

  test('geri çekme yanıtı kaybolursa iade yapılmaz', async () => {
    const f = fakeDeps({ order: pending, flow: market, iyzicoRoute: route(2, 'throw') });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 502);
    assert.equal(paths(f.calls).includes(PATHS.refund), false);
    assert.equal(f.calls.refunded.length, 0);
  });

  test('onay o anda gönderiliyorsa iyzico çağrılmaz, yeniden denenir', async () => {
    const f = fakeDeps({ order: pending, flow: market, refundState: 'in_flight', iyzicoRoute: route(1) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 409);
    assert.equal(f.calls.iyzico.length, 0);
    assert.equal(f.calls.refunded.length, 0);
  });

  test('onay durumu öğrenilemezse iade yapılmaz', async () => {
    for (const iyzicoRoute of [
      () => { throw new Error('ağ'); },
      () => ({ status: 'failure', errorCode: '1' }),
      () => ({ status: 'success', itemTransactions: [] }),
      () => ({ status: 'success', itemTransactions: [{ paymentTransactionId: 999 }] }),
      () => ({ status: 'success', itemTransactions: [{ paymentTransactionId: 999, transactionStatus: 0 }] }),
      () => ({ status: 'success', itemTransactions: [{ paymentTransactionId: 1, transactionStatus: 1 }] }),
    ]) {
      const f = fakeDeps({ order: pending, flow: market, iyzicoRoute });
      const r = await handleRefund(true, ORDER.id, 'ip', f.deps);
      assert.notEqual(r.status, 200);
      assert.equal(paths(f.calls).includes(PATHS.refund), false);
      assert.equal(f.calls.reversed.length, 0);
      assert.equal(f.calls.refunded.length, 0);
    }
  });

  test('ödeme numarası yoksa iyzico çağrılmaz', async () => {
    const f = fakeDeps({ order: pending, flow: { marketplace: true, paymentId: null }, iyzicoRoute: route(1) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 409);
    assert.equal(f.calls.iyzico.length, 0);
  });

  test('geri çekildi, iade reddedildi: sipariş iade bekler, yeniden denemede durum yeniden sorulur', async () => {
    const f = fakeDeps({
      order: pending, flow: market,
      iyzicoRoute: path => (path === PATHS.refund ? { status: 'failure', errorCode: '10' } : route(2)(path)),
    });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', f.deps)).status, 502);
    assert.equal(f.calls.refunded.length, 0);
    const again = fakeDeps({ order: pending, flow: market, iyzicoRoute: route(1) });
    assert.equal((await handleRefund(true, ORDER.id, 'ip', again.deps)).status, 200);
    assert.deepEqual(paths(again.calls), [PATHS.paymentDetail, PATHS.refund]);
  });
});
