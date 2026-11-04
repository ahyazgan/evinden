export type NotificationRole = 'customer' | 'seller' | 'admin';

export function notificationRoleOf(profileRole: string | null | undefined): NotificationRole {
  if (profileRole === 'seller') return 'seller';
  if (profileRole === 'admin') return 'admin';
  return 'customer';
}

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
  if (orderId || type === 'order_status') {
    if (role === 'seller') return '/(seller)/orders';
    if (role === 'admin') return '/(admin)/orders';
    return orderId ? `/(customer)/order/${orderId}` : '/(customer)/orders';
  }
  if (sellerId) return `/(customer)/seller/${sellerId}`;
  if (type === 'support') return role === 'admin' ? '/(admin)/support' : '/(customer)/help';
  if (type === 'payout') return '/(seller)/earnings';
  if (type === 'message_report') return '/(admin)/reports';
  if (type === 'promo' || type === 'campaign') return role === 'customer' ? '/(customer)/campaign' : null;
  return null;
}
