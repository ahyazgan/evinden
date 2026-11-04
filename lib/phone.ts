/**
 * Türkiye cep numarasını doğrulama servisinin istediği +90 biçimine çevirir.
 * Geçersizse null döner: 05XX, 5XX, 905XX ve +905XX yazımlarını kabul eder.
 */
export function normalizeTrPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('90')) national = digits.slice(2);
  else return null;
  return national.startsWith('5') ? `+90${national}` : null;
}
