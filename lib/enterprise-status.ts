import type { BadgeVariant } from '@/components/ui/Badge';

export const INVOICE_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Taslak', variant: 'muted' },
  queued: { label: 'Kuyrukta', variant: 'amber' },
  sending: { label: 'Gönderiliyor', variant: 'amber' },
  submitted: { label: 'Gönderildi', variant: 'info' },
  accepted: { label: 'Kabul edildi', variant: 'success' },
  rejected: { label: 'Reddedildi', variant: 'danger' },
  cancelled: { label: 'İptal', variant: 'muted' },
};

export const REFUND_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  requested: { label: 'Bekliyor', variant: 'amber' },
  approved: { label: 'Onaylandı', variant: 'info' },
  rejected: { label: 'Reddedildi', variant: 'danger' },
  paid: { label: 'İade edildi', variant: 'success' },
};

export const SLA_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  open: { label: 'Açık', variant: 'amber' },
  waived: { label: 'Affedildi', variant: 'muted' },
  collected: { label: 'Tahsil edildi', variant: 'success' },
};

export const RECONCILIATION_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  matched: { label: 'Eşleşti', variant: 'success' },
  difference: { label: 'Fark var', variant: 'danger' },
  closed: { label: 'Kapatıldı', variant: 'muted' },
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit',
  card_door: 'Kapıda kart',
  meal_card_door: 'Kapıda yemek kartı',
  online: 'Online',
};

export function enterpriseStatus(
  map: Record<string, { label: string; variant: BadgeVariant }>,
  value: string,
): { label: string; variant: BadgeVariant } {
  return map[value] ?? { label: value || 'Bilinmiyor', variant: 'muted' };
}
