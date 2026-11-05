import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { remainingToday } from '../../lib/stock.ts';
import { notificationRoute, notificationRoleOf } from '../../lib/notification-route.ts';
import { authCodeFromUrl, recoveryCodeFromUrl } from '../../lib/recovery-tokens.ts';

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
    assert.equal(notificationRoute('order_status', { orderId: 'a1' }, 'seller'), '/restoran/orders');
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

describe('notificationRoleOf ve yönetici', () => {
  test('profil rolünden gelir', () => {
    assert.equal(notificationRoleOf('seller'), 'seller');
    assert.equal(notificationRoleOf('admin'), 'admin');
    assert.equal(notificationRoleOf('buyer'), 'customer');
    assert.equal(notificationRoleOf(undefined), 'customer');
  });
  test('yönetici sipariş bildirimi yönetici ekranını açar', () => {
    assert.equal(notificationRoute('order_status', { orderId: 'a1' }, 'admin'), '/yonetim/orders');
  });
});

describe('şifre yenileme bağlantısı', () => {
  test('geçerli bağlantıdan kod okunur', () => {
    assert.equal(recoveryCodeFromUrl('afiyetli://reset-password?code=abc'), 'abc');
    assert.equal(recoveryCodeFromUrl('https://site.test/reset-password?code=abc'), 'abc');
    assert.equal(recoveryCodeFromUrl('exp://192.168.1.2:8081/--/reset-password?code=abc'), 'abc');
  });
  test('başka adresteki kod kabul edilmez', () => {
    assert.equal(recoveryCodeFromUrl('afiyetli://auth/callback?code=abc'), null);
    assert.equal(recoveryCodeFromUrl('afiyetli://not-reset-password?code=abc'), null);
  });
  test('adresteki oturum bilgisi artık geçerli değil', () => {
    assert.equal(recoveryCodeFromUrl('afiyetli://reset-password#access_token=a&refresh_token=r&type=recovery'), null);
  });
  test('süresi dolmuş bağlantı ve boş adres', () => {
    assert.equal(recoveryCodeFromUrl('afiyetli://reset-password?error=access_denied&error_code=otp_expired'), null);
    assert.equal(recoveryCodeFromUrl(null), null);
    assert.equal(recoveryCodeFromUrl('afiyetli://reset-password'), null);
  });
  test('kod sonrasındaki parça koda karışmaz', () => {
    assert.equal(authCodeFromUrl('afiyetli://auth/callback?code=abc#x=1'), 'abc');
  });
});
