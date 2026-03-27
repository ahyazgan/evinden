/** Türkiye cep: 10 hane (5xx…), E.164: +90XXXXXXXXXX */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/** Kullanıcı girdisinden +90… üretir; geçersizse null */
export function toTurkeyE164(localDigits: string): string | null {
  let d = digitsOnly(localDigits);
  if (d.startsWith('90')) {
    d = d.slice(2);
  }
  if (d.startsWith('0')) {
    d = d.slice(1);
  }
  if (d.length !== 10 || !d.startsWith('5')) {
    return null;
  }
  return `+90${d}`;
}

export function formatLocalDisplay(localDigits: string): string {
  const d = digitsOnly(localDigits).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 8) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}
