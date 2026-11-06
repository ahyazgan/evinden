export function moneyTL(cents: number, compact = false): string {
  const value = cents / 100;
  return `₺${value.toLocaleString('tr-TR', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  })}`;
}

export function dateTR(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('tr-TR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function sourceLabel(source: string): string {
  if (source === 'iyzico') return 'iyzico';
  if (source === 'bank') return 'Banka';
  return source;
}
