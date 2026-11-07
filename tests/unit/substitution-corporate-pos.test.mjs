import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutFingerprint, isAlreadyPlacedOrder, requestKeyFor } from '../../lib/order-request.ts';
import { latestSubstitutionByItem, substitutionCandidates, substitutionLive } from '../../lib/substitution-rules.ts';
import { corporateBudgetLeft, corporateBudgetRatio, formatJoinCode, normalizeJoinCode } from '../../lib/corporate-format.ts';
import { notificationRoute } from '../../lib/notification-route.ts';

const base = {
  sellerId: 's1',
  items: [{ menuItemId: 'm1', quantity: 2, extraIds: ['b', 'a'] }],
  deliveryAddress: 'Adres', paymentMethod: 'cash', fulfillment: 'delivery', tipCents: 0,
};

describe('çift sipariş anahtarı', () => {
  test('aynı sepet aynı anahtarı, değişen sepet yeni anahtarı alır', () => {
    let n = 0;
    const make = () => `k${++n}`;
    const fp = checkoutFingerprint(base);
    const first = requestKeyFor(null, fp, make);
    const again = requestKeyFor(first.slot, checkoutFingerprint({ ...base, items: [{ menuItemId: 'm1', quantity: 2, extraIds: ['a', 'b'] }] }), make);
    assert.equal(again.key, first.key, 'ekstra sırası önemsiz');
    const changed = requestKeyFor(first.slot, checkoutFingerprint({ ...base, tipCents: 500 }), make);
    assert.notEqual(changed.key, first.key);
    const corp = requestKeyFor(changed.slot, checkoutFingerprint({ ...base, tipCents: 500, corporateWorkspaceId: 'w' }), make);
    assert.notEqual(corp.key, changed.key, 'şirket seçimi ayrı sipariştir');
  });

  test('anahtar 10 dakika sonra yenilenir; ilerlemiş siparişe dönüş yeni sipariş sayılmaz', () => {
    const fp = checkoutFingerprint(base);
    const first = requestKeyFor(null, fp, () => 'a', 0);
    assert.equal(first.reused, false);
    assert.equal(requestKeyFor(first.slot, fp, () => 'b', 9 * 60_000).reused, true);
    assert.equal(requestKeyFor(first.slot, fp, () => 'b', 11 * 60_000).key, 'b');
    assert.equal(isAlreadyPlacedOrder(true, 'accepted'), true);
    assert.equal(isAlreadyPlacedOrder(true, 'pending'), false);
    assert.equal(isAlreadyPlacedOrder(false, 'accepted'), false);
  });
});

describe('ürün değiştirme kuralları', () => {
  const menu = [
    { id: 'a', title: 'Ayran', price_cents: 5000, is_available: true },
    { id: 'k', title: 'Kola', price_cents: 5000, is_available: true },
    { id: 's', title: 'Şalgam', price_cents: 6000, is_available: true },
    { id: 'f', title: 'Fanta', price_cents: 5000, is_available: false },
    { id: 'l', title: 'Limonata', price_cents: 5000, is_available: true, daily_limit: 3, sold_today: 3, stock_reset_date: '2026-11-07' },
    { id: 'd', title: 'Dünkü limit', price_cents: 5000, is_available: true, daily_limit: 3, sold_today: 3, stock_reset_date: '2026-11-06' },
  ];
  test('aynı fiyatlı, satışta, adedi bitmemiş ve kalemin kendisi olmayan ürünler', () => {
    const r = substitutionCandidates(menu, { menuItemId: 'k', unitPriceCents: 5000 }, '2026-11-07');
    assert.deepEqual(r.map(m => m.id), ['a', 'd']);
  });
  test('süresi dolan bekleyen teklif canlı sayılmaz ve son teklif kalem başına seçilir', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    const rows = [
      { id: '1', order_item_id: 'i1', status: 'rejected', created_at: '2026-11-07T11:00:00Z', expires_at: '2026-11-07T11:15:00Z' },
      { id: '2', order_item_id: 'i1', status: 'pending', created_at: '2026-11-07T11:50:00Z', expires_at: '2026-11-07T11:55:00Z' },
      { id: '3', order_item_id: 'i2', status: 'pending', created_at: '2026-11-07T11:58:00Z', expires_at: '2026-11-07T12:10:00Z' },
    ];
    const m = latestSubstitutionByItem(rows, now);
    assert.equal(m.get('i1').id, '2');
    assert.equal(m.get('i1').status, 'expired');
    assert.equal(m.get('i2').status, 'pending');
    assert.equal(substitutionLive(rows[2], now), true);
    assert.equal(substitutionLive(rows[1], now), false);
  });
});

describe('kurumsal hesap biçimleri', () => {
  test('kalan bütçe ve oran', () => {
    assert.equal(corporateBudgetLeft({ monthly_budget_cents: null, month_spent_cents: 900 }), null);
    assert.equal(corporateBudgetLeft({ monthly_budget_cents: 1000, month_spent_cents: 1200 }), 0);
    assert.equal(corporateBudgetRatio({ monthly_budget_cents: 1000, month_spent_cents: 250 }), 0.25);
    assert.equal(corporateBudgetRatio({ monthly_budget_cents: 0, month_spent_cents: 250 }), null);
  });
  test('kod gruplanır, yazım arındırılır', () => {
    assert.equal(formatJoinCode('ABCDEFGH'), 'ABCD-EFGH');
    assert.equal(normalizeJoinCode(' abcd-efgh '), 'ABCDEFGH');
    assert.equal(formatJoinCode(null), '');
  });
  test('kurumsal bildirim doğru ekranı açar', () => {
    assert.equal(notificationRoute('system', { workspaceId: 'w' }, 'admin'), '/yonetim/corporate');
    assert.equal(notificationRoute('system', { workspaceId: 'w' }, 'customer'), '/(customer)/corporate');
    assert.equal(notificationRoute('order_status', { orderId: 'o', substitutionId: 's' }, 'customer'), '/(customer)/order/o');
  });
});
