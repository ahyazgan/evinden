import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCustomerHome, mustLeaveSellerArea, sellerLanding } from '../../lib/role-landing.ts';
import { imageFileType, uniqueUploadPath } from '../../lib/upload-path.ts';

const seller = { id: 's', role: 'seller', is_approved: true };
const pending = { id: 'p', role: 'seller', is_approved: false };
const buyer = { id: 'b', role: 'buyer', is_approved: true };

describe('satıcının açılış sayfası', () => {
  test('onaylı satıcı ana sayfadan panele gider', () => {
    assert.deepEqual(sellerLanding(seller, ['(customer)'], false), { route: '/restoran/dashboard', settled: true });
    assert.deepEqual(sellerLanding(seller, ['(customer)', 'index'], false), { route: '/restoran/dashboard', settled: true });
  });
  test('müşteri moduna dönen satıcı itilmez', () => {
    assert.deepEqual(sellerLanding(seller, ['(customer)'], true), { route: null, settled: true });
  });
  test('derin bağlantı bozulmaz, karar da kapanır', () => {
    assert.deepEqual(sellerLanding(seller, ['(customer)', 'seller', '[id]'], false), { route: null, settled: true });
  });
  test('giriş ekranında karar verilmez', () => {
    assert.deepEqual(sellerLanding(seller, ['(auth)', 'login'], false), { route: null, settled: false });
  });
  test('müşteri ve onaysız satıcı panele gitmez', () => {
    assert.equal(sellerLanding(buyer, ['(customer)'], false).route, null);
    assert.equal(sellerLanding(pending, ['(customer)'], false).route, null);
    assert.equal(sellerLanding(null, ['(customer)'], false).route, null);
  });
  test('ana sayfa tanımı', () => {
    assert.equal(isCustomerHome(['(customer)']), true);
    assert.equal(isCustomerHome(['(customer)', 'orders']), false);
    assert.equal(isCustomerHome(['restoran', 'menu']), false);
  });
});

describe('restoran paneline giriş', () => {
  test('yalnızca onaylı satıcı kalır', () => {
    assert.equal(mustLeaveSellerArea(seller, ['restoran', 'menu']), false);
    assert.equal(mustLeaveSellerArea(buyer, ['restoran', 'menu']), true);
    assert.equal(mustLeaveSellerArea(pending, ['restoran', 'menu']), true);
    assert.equal(mustLeaveSellerArea(null, ['restoran', 'menu']), true);
  });
  test('başka alanlar etkilenmez', () => {
    assert.equal(mustLeaveSellerArea(null, ['(customer)']), false);
  });
});

describe('fotoğraf yükleme', () => {
  test('webdeki data adresinden tür okunur', () => {
    assert.deepEqual(imageFileType('data:image/png;base64,AAAA.BBB/CCC'), { ext: 'png', contentType: 'image/png' });
  });
  test('seçicinin bildirdiği tür önceliklidir', () => {
    assert.deepEqual(imageFileType('blob:http://localhost/abc', 'image/webp'), { ext: 'webp', contentType: 'image/webp' });
    assert.deepEqual(imageFileType('file:///a/b.png', 'image/jpeg'), { ext: 'jpg', contentType: 'image/jpeg' });
  });
  test('telefondaki dosya adından tür okunur', () => {
    assert.deepEqual(imageFileType('file:///a/b.JPEG?x=1'), { ext: 'jpg', contentType: 'image/jpeg' });
    assert.deepEqual(imageFileType('file:///a/b.webp'), { ext: 'webp', contentType: 'image/webp' });
  });
  test('bilinmeyen tür jpeg sayılır, depo adı bozulmaz', () => {
    assert.deepEqual(imageFileType('blob:http://localhost/abc'), { ext: 'jpg', contentType: 'image/jpeg' });
    assert.deepEqual(imageFileType('file:///a/b.heic'), { ext: 'jpg', contentType: 'image/jpeg' });
  });
  test('her yükleme ayrı dosyadır, klasör değişmez', () => {
    assert.equal(uniqueUploadPath('sellers/1/cover', 'jpg', 5), 'sellers/1/cover-5.jpg');
    assert.notEqual(uniqueUploadPath('a', 'jpg', 1), uniqueUploadPath('a', 'jpg', 2));
  });
  test('üstüne yazma kullanılmaz', () => {
    const src = readFileSync(new URL('../../lib/storage.ts', import.meta.url), 'utf8');
    assert.ok(!src.includes('upsert: true'));
  });
});

describe('satıcı ekranları', () => {
  const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  test('müşteri kimliği ekrana yazılmaz', () => {
    assert.ok(!read('app/restoran/reviews.tsx').includes('customer_id.slice'));
    assert.ok(!read('app/restoran/receipt.tsx').includes('customer_id.slice'));
  });
  test('menü kaydında hata yutulmaz', () => {
    assert.ok(!/catch \{\}/.test(read('app/restoran/menu.tsx')));
  });
});
