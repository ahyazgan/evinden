export type NotificationRole = 'customer' | 'seller';

/**
 * Bildirime dokununca açılacak ekran. Hedef yoksa null döner.
 * Hem bildirim listeleri hem de push bildirimi aynı kuralı kullanır.
 */
export function notificationRoute(
  type: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  role: NotificationRole,
): string | null {
  const orderId = typeof data?.orderId === 'string' ? data.orderId : null;
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : null;
  const sellerId = typeof data?.sellerId === 'string' ? data.sellerId : null;

  if (conversationId) return `/chat/${conversationId}`;
  if (orderId) return role === 'seller' ? '/(seller)/orders' : `/(customer)/order/${orderId}`;
  if (type === 'order_status') return role === 'seller' ? '/(seller)/orders' : '/(customer)/orders';
  if (sellerId) return `/(customer)/seller/${sellerId}`;
  if (type === 'payout') return '/(seller)/earnings';
  if (type === 'message_report') return '/(admin)/reports';
  if (type === 'promo' || type === 'campaign') return role === 'customer' ? '/(customer)/campaign' : null;
  return null;
}
