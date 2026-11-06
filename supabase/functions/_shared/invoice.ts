// E-fatura sağlayıcısına (özel entegratör) gönderilecek UBL-TR 2.1 belgesini üretir.
// Saf fonksiyonlar: ağ ve veritabanı bağımlılığı yok, Node testinde çalışır.
//
// Not: Belge temel UBL-TR alanlarını içerir. Canlıya almadan önce seçilen entegratörün test ortamında
// şema (XSD) ve şematron doğrulamasından geçirilmelidir; entegratör kendi JSON biçimini istiyorsa
// gönderim gövdesi o biçime çevrilmelidir.

export type InvoiceLine = {
  kind?: 'item' | 'delivery' | 'discount';
  name: string;
  quantity: number;
  unitPriceCents: number;
  /** KDV dahil satır tutarı. İndirim satırında negatiftir. */
  lineTotalCents: number;
  /** KDV hariç satır tutarı (046: _invoice_amounts). */
  netCents?: number;
  taxCents?: number;
};

export type InvoiceParty = { title: string; taxNumber: string; taxOffice: string; address: string; email: string };

export type InvoiceDocument = {
  uuid: string;
  invoiceNumber: string;
  issuedAt: string;
  currency: string;
  taxRateBps: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  /** KDV hariç toplam (indirim düşülmüş). */
  subtotalCents: number;
  taxCents: number;
  /** KDV dahil ödenecek tutar. */
  totalCents: number;
};

// XML 1.0'da geçersiz kontrol karakterleri belgeyi bozmasın diye atılır; sonra özel karakterler kaçırılır.
export function escapeXml(value: string): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function netOf(line: InvoiceLine, rateBps: number): number {
  return line.netCents ?? Math.round(line.lineTotalCents * 10000 / (10000 + rateBps));
}

/** VKN 10 hane, TCKN 11 hanedir. */
function schemeOf(taxNumber: string): 'VKN' | 'TCKN' {
  return taxNumber.replace(/\D/g, '').length === 11 ? 'TCKN' : 'VKN';
}

export function invoiceTotals(invoice: Pick<InvoiceDocument, 'lines' | 'taxRateBps'>) {
  const positive = invoice.lines.filter(l => l.lineTotalCents >= 0);
  const discounts = invoice.lines.filter(l => l.lineTotalCents < 0);
  const lineExtension = positive.reduce((sum, l) => sum + netOf(l, invoice.taxRateBps), 0);
  const allowance = -discounts.reduce((sum, l) => sum + netOf(l, invoice.taxRateBps), 0);
  return { lineExtension, allowance, taxExclusive: lineExtension - allowance };
}

export function buildInvoiceUbl(invoice: InvoiceDocument): string {
  const cur = escapeXml(invoice.currency);
  const percent = (invoice.taxRateBps / 100).toFixed(2);
  const issueDate = invoice.issuedAt.slice(0, 10);
  const totals = invoiceTotals(invoice);
  const itemLines = invoice.lines.filter(l => l.lineTotalCents >= 0);

  const taxCategory = `
        <cac:TaxCategory>
          <cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>`;

  const party = (p: InvoiceParty) => `
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${schemeOf(p.taxNumber)}">${escapeXml(p.taxNumber)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${escapeXml(p.title)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(p.address)}</cbc:StreetName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>${escapeXml(p.taxOffice)}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:Contact><cbc:ElectronicMail>${escapeXml(p.email)}</cbc:ElectronicMail></cac:Contact>
    </cac:Party>`;

  const allowanceXml = totals.allowance > 0 ? `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>İndirim</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="${cur}">${money(totals.allowance)}</cbc:Amount>
  </cac:AllowanceCharge>` : '';

  const lineXml = itemLines.map((line, index) => {
    const net = netOf(line, invoice.taxRateBps);
    const tax = line.taxCents ?? line.lineTotalCents - net;
    const unitNet = line.quantity > 0 ? net / line.quantity : net;
    return `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(net)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${cur}">${money(tax)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${cur}">${money(net)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${cur}">${money(tax)}</cbc:TaxAmount>
        <cbc:Percent>${percent}</cbc:Percent>${taxCategory}
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Name>${escapeXml(line.name)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${cur}">${(Math.round(unitNet) / 100).toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TEMELFATURA</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${escapeXml(invoice.uuid)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${itemLines.length}</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>${party(invoice.seller)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(invoice.buyer)}
  </cac:AccountingCustomerParty>${allowanceXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${money(invoice.taxCents)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${money(invoice.subtotalCents)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${money(invoice.taxCents)}</cbc:TaxAmount>
      <cbc:Percent>${percent}</cbc:Percent>${taxCategory}
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${money(totals.lineExtension)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${money(totals.taxExclusive)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${money(invoice.totalCents)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${cur}">${money(totals.allowance)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${cur}">${money(invoice.totalCents)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}
