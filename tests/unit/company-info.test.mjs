import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTckn, validateCompanyInfo } from '../../lib/company-info.ts';
import { normalizeTrPhone } from '../../lib/phone.ts';

const FORM = {
  company_type: 'LIMITED_OR_JOINT_STOCK_COMPANY',
  legal_company_title: 'Lokanta Gıda Ltd. Şti.',
  tax_office: 'Kadıköy',
  tax_number: '1234567890',
  identity_number: '10000000146',
  email: 'lokanta@ornek.com',
  gsm_number: '0555 111 22 33',
  address: 'Moda Cad. No:1 Kadıköy',
};
const check = (over = {}) => validateCompanyInfo({ ...FORM, ...over }, normalizeTrPhone);

describe('T.C. kimlik denetimi', () => {
  test('denetim haneleri tutan numara geçer', () => assert.equal(isValidTckn('10000000146'), true));
  test('geçersizler reddedilir', () => {
    for (const bad of ['', '1000000014', '100000001466', '00000000146', '10000000147', '10000000156', 'abcdefghijk']) {
      assert.equal(isValidTckn(bad), false, bad);
    }
  });
});

describe('Şirket bilgileri', () => {
  test('geçerli form temizlenmiş değer döndürür', () => {
    const r = check({ legal_company_title: '  Lokanta  ', tax_number: '123 456 7890', identity_number: '100 000 001 46' });
    assert.equal(r.ok, true);
    assert.equal(r.value.legal_company_title, 'Lokanta');
    assert.equal(r.value.tax_number, '1234567890');
    assert.equal(r.value.identity_number, '10000000146');
    assert.equal(r.value.gsm_number, '+905551112233');
  });

  test('limited ve A.Ş.de vergi numarası zorunlu ve 10 hane', () => {
    assert.ok(check({ tax_number: '' }).errors.tax_number);
    assert.ok(check({ tax_number: '12345' }).errors.tax_number);
    assert.ok(check({ tax_number: '12345678901' }).errors.tax_number);
  });

  test('şahıs şirketinde vergi numarası isteğe bağlı, boşsa null olur', () => {
    const r = check({ company_type: 'PRIVATE_COMPANY', tax_number: '' });
    assert.equal(r.ok, true);
    assert.equal(r.value.tax_number, null);
    assert.equal(check({ company_type: 'PRIVATE_COMPANY', tax_number: '10000000146' }).ok, true);
    assert.ok(check({ company_type: 'PRIVATE_COMPANY', tax_number: '123' }).errors.tax_number);
  });

  test('her zorunlu alan kendi hatasını verir', () => {
    for (const [field, value] of [
      ['company_type', null],
      ['legal_company_title', 'Ab'],
      ['tax_office', ''],
      ['identity_number', '11111111111'],
      ['email', 'gecersiz'],
      ['gsm_number', '123'],
      ['address', 'kısa'],
    ]) {
      const r = check({ [field]: value });
      assert.equal(r.ok, false, field);
      assert.ok(r.errors[field], field);
    }
  });

  test('alan sınırları iyzico ile aynı', () => {
    assert.ok(check({ legal_company_title: 'x'.repeat(256) }).errors.legal_company_title);
    assert.ok(check({ tax_office: 'x'.repeat(256) }).errors.tax_office);
    assert.ok(check({ address: 'x'.repeat(256) }).errors.address);
    assert.equal(check({ legal_company_title: 'x'.repeat(255) }).ok, true);
  });
});
