import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { remainingToday } from '../../lib/stock.ts';
import { notificationRoute } from '../../lib/notification-route.ts';

describe('remainingToday', () => {
  test('limit yoksa sınırsız', () => {
    assert.equal(remainingToday(0, 5, '2026-11-04', '2026-11-04'), null);
    assert.equal(remainingToday(null, null, null, '2026-11-04'), null);
  });
  test('bugünün sayacı düşülür', () => {
    assert.equal(remainingToday(10, 4, '2026-11-04', '2026-11-04'), 6);
  });
  test('dünkü satış sayılmaz', () => {
    assert.equal(remainingToday(10, 10, '2026-11-03', '2026-11-04'), 10);
  });
  test('eksiye düşmez', () => {
    assert.equal(remainingToday(3, 5, '2026-11-04', '2026-11-04'), 0);
  });
});

describe('notificationRoute', () => {
  test('sipariş bildirimi role göre açılır', () => {
    assert.equal(notificationRoute('order_status', { orderId: 'a1' }, 'customer'), '/(customer)/order/a1');
    assert.equal(notificationRoute('order_status', { orderId: 'a1' }, 'seller'), '/(seller)/orders');
  });
  test('mesaj bildirimi sohbeti açar', () => {
    assert.equal(notificationRoute('message', { conversationId: 'c1' }, 'seller'), '/chat/c1');
  });
  test('satıcı güncellemesi satıcı sayfasını açar', () => {
    assert.equal(notificationRoute('seller_update', { sellerId: 's1' }, 'customer'), '/(customer)/seller/s1');
  });
  test('duyuru müşteride kampanyaları açar, satıcıda hedef yok', () => {
    assert.equal(notificationRoute('promo', {}, 'customer'), '/(customer)/campaign');
    assert.equal(notificationRoute('promo', {}, 'seller'), null);
  });
  test('bilinmeyen tür hedefsiz', () => {
    assert.equal(notificationRoute('system', null, 'customer'), null);
  });
});
