// Sepet önizlemesi; asıl hesabı place_order yapar ve kurallar aynıdır (020).

export type OrderPricing = {
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  minOrderCents: number;
};

export const DEFAULT_ORDER_PRICING: OrderPricing = {
  deliveryFeeCents: 1500,
  freeDeliveryThresholdCents: 15000,
  minOrderCents: 0,
};

type SellerPricingFields = {
  delivery_fee_cents?: number | null;
  free_delivery_threshold_cents?: number | null;
  min_order_cents?: number | null;
};

/** Satıcının ayarı varsa platform varsayılanının yerine geçer; minimum siparişte büyük olan geçerlidir. */
export function sellerPricing(seller: SellerPricingFields | null | undefined, platform: OrderPricing): OrderPricing {
  return {
    deliveryFeeCents: seller?.delivery_fee_cents ?? platform.deliveryFeeCents,
    freeDeliveryThresholdCents: seller?.free_delivery_threshold_cents ?? platform.freeDeliveryThresholdCents,
    minOrderCents: Math.max(seller?.min_order_cents ?? 0, platform.minOrderCents),
  };
}

export function deliveryFeeFor(subtotalCents: number, pricing: OrderPricing, couponFreeDelivery: boolean): number {
  if (couponFreeDelivery || subtotalCents >= pricing.freeDeliveryThresholdCents) return 0;
  return pricing.deliveryFeeCents;
}

/** Müşterinin ödeyeceği tutar: place_order ile aynı. Bahşiş indirime girmez. */
export function orderTotalCents(input: { subtotalCents: number; deliveryFeeCents: number; discountCents: number; tipCents: number }): number {
  return Math.max(input.subtotalCents + input.deliveryFeeCents - input.discountCents, 0) + input.tipCents;
}

/** "15", "15,5", "15.50" -> kuruş. Boş metin null, geçersiz metin undefined döner. */
export function parseTLToCents(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}

export function centsToTLInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',');
}
