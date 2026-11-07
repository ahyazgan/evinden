/**
 * Çift sipariş koruması (050 place_order_idempotent): aynı sepet için tekrar gönderilen istek aynı anahtarı taşır,
 * sunucu ilk siparişi geri döndürür. Sepet, adres veya seçimler değişirse ya da anahtar eskidiyse yeni anahtar üretilir.
 * Konum her denemede birkaç metre farklı çözülebildiği için parmak izine girmez.
 */
export type RequestKeySlot = { fingerprint: string; key: string; createdAt: number } | null;

/** Bu süreden sonra aynı sepet yeni sipariş sayılır: saatler sonra verilen sipariş eskisine bağlanmaz. */
export const REQUEST_KEY_TTL_MS = 10 * 60 * 1000;

export function checkoutFingerprint(input: {
  sellerId: string;
  items: { menuItemId: string; quantity: number; variantId?: string | null; portionId?: string | null; extraIds?: string[]; optionIds?: string[] }[];
  deliveryAddress: string;
  notes?: string;
  paymentMethod: string;
  couponCode?: string | null;
  fulfillment?: string;
  scheduledFor?: string | null;
  tipCents?: number;
  corporateWorkspaceId?: string | null;
}): string {
  return JSON.stringify([
    input.sellerId,
    input.items.map(i => [
      i.menuItemId, i.quantity, i.variantId ?? null, i.portionId ?? null,
      [...(i.extraIds ?? [])].sort(), [...(i.optionIds ?? [])].sort(),
    ]),
    input.deliveryAddress, input.notes ?? '', input.paymentMethod, input.couponCode ?? null,
    input.fulfillment ?? 'delivery', input.scheduledFor ?? null, input.tipCents ?? 0,
    input.corporateWorkspaceId ?? null,
  ]);
}

/** Aynı parmak izinde ve süresi geçmemişse eski anahtarı (reused: true), değilse yenisini verir. */
export function requestKeyFor(
  slot: RequestKeySlot, fingerprint: string, makeKey: () => string, now: number = Date.now(),
): { slot: NonNullable<RequestKeySlot>; key: string; reused: boolean } {
  if (slot && slot.fingerprint === fingerprint && now - slot.createdAt < REQUEST_KEY_TTL_MS) {
    return { slot, key: slot.key, reused: true };
  }
  const next = { fingerprint, key: makeKey(), createdAt: now };
  return { slot: next, key: next.key, reused: false };
}

/** Tekrar gönderimde dönen sipariş ilerlemişse bu yeni sipariş değildir; müşteri ona yönlendirilir. */
export function isAlreadyPlacedOrder(reused: boolean, status: string): boolean {
  return reused && !['pending', 'awaiting_payment'].includes(status);
}
