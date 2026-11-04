// Sipariş seçeneklerinin ortak metinleri ve kuralları: yemek kartı, gelip alma, bahşiş (033).
// Sunucudaki kısıtlarla aynı listeler; test ikisini karşılaştırır.

export type Fulfillment = 'delivery' | 'pickup';
export type PaymentMethod = 'cash' | 'card_door' | 'meal_card_door' | 'online';

// ── Yemek kartı ──────────────────────────────────────────────────────────────

export const MEAL_CARDS = [
  { id: 'multinet', label: 'Multinet' },
  { id: 'pluxee', label: 'Pluxee' },
  { id: 'setcard', label: 'Setcard' },
  { id: 'metropol', label: 'Metropol' },
  { id: 'edenred', label: 'Ticket Restaurant' },
] as const;

export function mealCardLabels(ids: readonly string[] | null | undefined): string[] {
  return MEAL_CARDS.filter(card => ids?.includes(card.id)).map(card => card.label);
}

export function toggleMealCard(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// ── Ödeme ────────────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<Fulfillment, Record<PaymentMethod, string>> = {
  delivery: { cash: 'Nakit', card_door: 'Kapıda kart', meal_card_door: 'Kapıda yemek kartı', online: 'Online ödeme' },
  pickup: { cash: 'Kasada nakit', card_door: 'Kasada kart', meal_card_door: 'Kasada yemek kartı', online: 'Online ödeme' },
};

/** Sepette, fişte ve yönetici ekranında görünen ödeme adı. */
export function paymentLabel(method: string | null | undefined, fulfillment: string | null | undefined = 'delivery'): string {
  const labels = PAYMENT_LABELS[fulfillment === 'pickup' ? 'pickup' : 'delivery'];
  return labels[(method ?? 'cash') as PaymentMethod] ?? String(method);
}

// ── Bahşiş ───────────────────────────────────────────────────────────────────

export const MAX_TIP_CENTS = 50000;
export const TIP_PRESETS_CENTS = [1000, 2000, 3000];

// ── Gelip alma ───────────────────────────────────────────────────────────────

export function isPickup(order: { fulfillment?: string | null } | null | undefined): boolean {
  return order?.fulfillment === 'pickup';
}

type StatusOrder = { status: string; fulfillment?: string | null };

/** Satıcının sıradaki adımı. Gelip almada "yola çıktı" yoktur: hazır olan sipariş müşteriye verilir. */
export function nextOrderStatus(order: StatusOrder): string | null {
  switch (order.status) {
    case 'pending': return 'accepted';
    case 'accepted': return 'preparing';
    case 'preparing': return 'ready';
    case 'ready': return isPickup(order) ? 'delivered' : 'out_for_delivery';
    case 'out_for_delivery': return 'delivered';
    default: return null;
  }
}

export function nextOrderLabel(order: StatusOrder): string | null {
  switch (order.status) {
    case 'pending': return 'Kabul et';
    case 'accepted': return 'Hazırlanıyor';
    case 'preparing': return 'Hazır';
    case 'ready': return isPickup(order) ? 'Müşteri aldı' : 'Yola çıktı';
    case 'out_for_delivery': return 'Teslim edildi';
    default: return null;
  }
}

type AddressFields = {
  address_line?: string | null;
  district?: string | null;
  city?: string | null;
};

/** Restoranın adresi; gelip almada müşteriye gösterilir. */
export function sellerAddress(seller: AddressFields | null | undefined): string {
  return [seller?.address_line, seller?.district, seller?.city].filter(Boolean).join(', ');
}

/** Harita uygulamasında açılacak bağlantı. Konum kayıtlıysa o, yoksa adres aranır; ikisi de yoksa boş döner. */
export function mapsUrl(
  seller: (AddressFields & { latitude?: number | string | null; longitude?: number | string | null }) | null | undefined,
): string | null {
  const lat = seller?.latitude;
  const lng = seller?.longitude;
  const query = lat != null && lng != null ? `${lat},${lng}` : sellerAddress(seller);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

// ── Satıcı listesi ───────────────────────────────────────────────────────────

const ENDED = new Set(['delivered', 'cancelled']);
/** Planlı siparişin saati bu kadar yaklaştıysa listenin başına çıkar. */
const DUE_SOON_MS = 60 * 60_000;

type SortableOrder = { status: string; created_at: string; scheduled_for?: string | null };

function sortRank(order: SortableOrder, now: number): number {
  if (ENDED.has(order.status)) return 3;
  if (!order.scheduled_for) return 1;
  return new Date(order.scheduled_for).getTime() - now <= DUE_SOON_MS ? 0 : 2;
}

/**
 * Satıcı sırası: saati yaklaşan planlılar, sonra normal siparişler (yeniden eskiye), sonra ileri
 * tarihli planlılar (yakından uzağa), en sonda biten siparişler.
 */
export function compareSellerOrders(a: SortableOrder, b: SortableOrder, now: number = Date.now()): number {
  const rank = sortRank(a, now) - sortRank(b, now);
  if (rank !== 0) return rank;
  if (a.scheduled_for && b.scheduled_for && !ENDED.has(a.status)) {
    return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
  }
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}
