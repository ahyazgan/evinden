import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { conversionPercent, sourceLabel, trafficSource } from '../../lib/traffic-source.ts';
import { cleanProps } from '../../lib/analytics-core.ts';

const SITE = 'https://afiyetli.ahyazgab.workers.dev/';
const RULE = /^[A-Za-z0-9_-]{1,64}$/; // 062 analytics_props_valid

describe('Ziyaretçi kaynağı', () => {
  test('arama motorları ve sosyal ağlar etiketlenir', () => {
    assert.equal(trafficSource(SITE, 'https://www.google.com.tr/'), 'google');
    assert.equal(trafficSource(SITE, 'https://l.instagram.com/?u=x'), 'instagram');
    assert.equal(trafficSource(SITE, 'https://wa.me/'), 'whatsapp');
    assert.equal(trafficSource(SITE, 'https://t.co/abc'), 'x');
    assert.equal(trafficSource(SITE, 'https://m.facebook.com/'), 'facebook');
  });
  test('kampanya etiketi önce gelir ve kurala sığdırılır', () => {
    assert.equal(trafficSource(`${SITE}?utm_source=Afiş Kadıköy`, 'https://www.google.com/'), 'utm_afis-kadikoy');
    assert.equal(trafficSource(`${SITE}?utm_source=${'a'.repeat(100)}`, ''), `utm_${'a'.repeat(40)}`);
    assert.equal(trafficSource(`${SITE}?utm_source=%20%20`, ''), 'dogrudan');
  });
  test('adres tutulmaz: bilinmeyen site "diger", kendi sitemiz ve boş "dogrudan"', () => {
    assert.equal(trafficSource(SITE, 'https://kisisel-blog.example/yazi?ad=Ayse'), 'diger');
    assert.equal(trafficSource(`${SITE}explore`, `${SITE}seller/1`), 'dogrudan');
    assert.equal(trafficSource(SITE, ''), 'dogrudan');
    assert.equal(trafficSource('bozuk', 'de bozuk'), 'dogrudan');
  });
  test('her değer veritabanı kuralına uyar ve ölçüm kuyruğundan geçer', () => {
    const samples = [
      trafficSource(`${SITE}?utm_source=çğıöşü!!`, ''),
      trafficSource(SITE, 'https://yandex.com.tr/'),
      trafficSource(SITE, 'https://x.com/'),
    ];
    for (const value of samples) {
      assert.match(value, RULE, value);
      assert.deepEqual(cleanProps({ source: value }), { source: value });
    }
  });
  test('yönetim ekranı adları ve dönüşüm oranı', () => {
    assert.equal(sourceLabel('utm_afis'), 'Kampanya: afis');
    assert.equal(sourceLabel('google'), 'Google');
    assert.equal(sourceLabel('yeni-bir-sey'), 'yeni-bir-sey');
    assert.equal(conversionPercent(0, 0), null);
    assert.equal(conversionPercent(8, 1), 13);
  });
});
