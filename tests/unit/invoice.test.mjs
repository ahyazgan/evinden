import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceUbl, escapeXml, invoiceTotals } from '../../supabase/functions/_shared/invoice.ts';

const party = (title, taxNumber) => ({ title, taxNumber, taxOffice: 'Kadıköy', address: 'Moda Cad. No:1', email: 'f@firma.com' });

// 2 x 50 TL ürün + 15 TL teslimat − 20 TL indirim, %10 KDV. Satır net/KDV değerleri 046 _invoice_amounts ile aynı kuralla.
const net = gross => Math.round(gross * 10000 / 11000);
const lines = [
  { kind: 'item', name: 'Yemek & İçecek', quantity: 2, unitPriceCents: 5000, lineTotalCents: 10000 },
  { kind: 'delivery', name: 'Teslimat', quantity: 1, unitPriceCents: 1500, lineTotalCents: 1500 },
  { kind: 'discount', name: 'İndirim', quantity: 1, unitPriceCents: -2000, lineTotalCents: -2000 },
].map(l => ({ ...l, netCents: net(l.lineTotalCents), taxCents: l.lineTotalCents - net(l.lineTotalCents) }));
const subtotal = lines.reduce((s, l) => s + l.netCents, 0);
const tax = lines.reduce((s, l) => s + l.taxCents, 0);

const doc = {
  uuid: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  invoiceNumber: 'AFY2026000000001',
  issuedAt: '2026-11-05T12:00:00.000Z',
  currency: 'TRY',
  taxRateBps: 1000,
  seller: party('Satıcı A.Ş.', '1234567890'),
  buyer: party('Alıcı A.Ş.', '12345678901'),
  lines,
  subtotalCents: subtotal,
  taxCents: tax,
  totalCents: 9500,
};

describe('E-fatura UBL', () => {
  test('özel ve kontrol karakterleri güvenli hâle gelir', () => {
    assert.equal(escapeXml('A & B < C > "D" \'E\''), 'A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;');
    assert.equal(escapeXml('Unvan\u0001\u0008 Ltd'), 'Unvan Ltd');
  });

  test('tutarlar birbirini tutar: net − indirim = KDV hariç, KDV hariç + KDV = ödenecek', () => {
    const totals = invoiceTotals(doc);
    assert.equal(totals.taxExclusive, subtotal);
    assert.equal(subtotal + tax, doc.totalCents);
    assert.equal(totals.allowance, -lines[2].netCents);
  });

  test('UBL-TR temel alanlarını ve önekli öğeleri içerir', () => {
    const xml = buildInvoiceUbl(doc);
    for (const tag of ['<cbc:UBLVersionID>2.1</cbc:UBLVersionID>', '<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>',
      '<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>', `<cbc:UUID>${doc.uuid}</cbc:UUID>`,
      '<cbc:ID>AFY2026000000001</cbc:ID>', '<cbc:TaxTypeCode>0015</cbc:TaxTypeCode>', '<cbc:Percent>10.00</cbc:Percent>']) {
      assert.ok(xml.includes(tag), tag);
    }
    // Öneksiz UBL öğesi kalmamalı (Invoice kök öğesi hariç).
    assert.equal(xml.match(/<(?!\?|\/|cbc:|cac:|Invoice[ >])[A-Za-z]/g), null);
    assert.ok(xml.includes('<cbc:ID schemeID="VKN">1234567890</cbc:ID>'));
    assert.ok(xml.includes('<cbc:ID schemeID="TCKN">12345678901</cbc:ID>'));
    assert.ok(xml.includes('Yemek &amp; İçecek'));
  });

  test('indirim satır olarak değil, belge indirimi olarak yazılır', () => {
    const xml = buildInvoiceUbl(doc);
    assert.equal((xml.match(/<cac:InvoiceLine>/g) ?? []).length, 2);
    assert.ok(xml.includes('<cbc:ChargeIndicator>false</cbc:ChargeIndicator>'));
    assert.ok(xml.includes(`<cbc:AllowanceTotalAmount currencyID="TRY">${(-lines[2].netCents / 100).toFixed(2)}</cbc:AllowanceTotalAmount>`));
    assert.ok(xml.includes(`<cbc:TaxExclusiveAmount currencyID="TRY">${(subtotal / 100).toFixed(2)}</cbc:TaxExclusiveAmount>`));
    assert.ok(xml.includes('<cbc:PayableAmount currencyID="TRY">95.00</cbc:PayableAmount>'));
  });
});
