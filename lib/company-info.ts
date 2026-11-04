// Satıcının iyzico alt üye kaydı için girdiği şirket bilgileri. Kurallar seller_company_info (036) ile aynıdır.
// Bireysel tip yok: restoranlar şirkettir.

export type CompanyType = 'PRIVATE_COMPANY' | 'LIMITED_OR_JOINT_STOCK_COMPANY';

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  LIMITED_OR_JOINT_STOCK_COMPANY: 'Limited / A.Ş.',
  PRIVATE_COMPANY: 'Şahıs şirketi',
};

export type CompanyForm = {
  company_type: CompanyType | null;
  legal_company_title: string;
  tax_office: string;
  tax_number: string;
  identity_number: string;
  email: string;
  gsm_number: string;
  address: string;
};

export type CompanyInfoValue = {
  company_type: CompanyType;
  legal_company_title: string;
  tax_office: string;
  tax_number: string | null;
  identity_number: string;
  email: string;
  gsm_number: string;
  address: string;
};

export type CompanyValidation =
  | { ok: true; value: CompanyInfoValue }
  | { ok: false; errors: Partial<Record<keyof CompanyForm, string>> };

/** T.C. kimlik numarası: 11 hane, ilk hane sıfır değil, son iki hane denetim hanesi. */
export function isValidTckn(input: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(input)) return false;
  const d = [...input].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

const digitsOnly = (input: string) => input.replace(/\s+/g, '');

/** Telefon kuralı dışarıdan verilir (lib/phone.ts normalizeTrPhone): bu dosya bağımlılıksız kalsın diye. */
export function validateCompanyInfo(form: CompanyForm, normalizePhone: (input: string) => string | null): CompanyValidation {
  const errors: Partial<Record<keyof CompanyForm, string>> = {};
  const title = form.legal_company_title.trim();
  const office = form.tax_office.trim();
  const taxNumber = digitsOnly(form.tax_number);
  const identity = digitsOnly(form.identity_number);
  const email = form.email.trim();
  const address = form.address.trim();
  const phone = normalizePhone(form.gsm_number);

  if (!form.company_type) errors.company_type = 'Şirket türünü seç.';
  if (title.length < 3 || title.length > 255) errors.legal_company_title = 'Yasal unvanı vergi levhasındaki gibi yaz.';
  if (office.length < 3 || office.length > 255) errors.tax_office = 'Vergi dairesini yaz.';

  if (form.company_type === 'LIMITED_OR_JOINT_STOCK_COMPANY') {
    if (!/^[0-9]{10}$/.test(taxNumber)) errors.tax_number = 'Vergi numarası 10 haneli olmalı.';
  } else if (taxNumber && !/^[0-9]{10,11}$/.test(taxNumber)) {
    errors.tax_number = 'Vergi numarası 10 veya 11 haneli olmalı.';
  }

  if (!isValidTckn(identity)) errors.identity_number = 'Geçerli bir T.C. kimlik numarası yaz.';
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Geçerli bir e-posta yaz.';
  if (!phone) errors.gsm_number = 'Cep telefonunu 05XX XXX XX XX biçiminde yaz.';
  if (address.length < 5 || address.length > 255) errors.address = 'Şirket adresini yaz.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      company_type: form.company_type!,
      legal_company_title: title,
      tax_office: office,
      tax_number: taxNumber || null,
      identity_number: identity,
      email,
      gsm_number: phone!,
      address,
    },
  };
}
