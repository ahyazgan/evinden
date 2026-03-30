import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

type OrderChangeCallback = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any>;
  old: Record<string, any>;
}) => void;

/**
 * Subscribe to real-time order changes for a specific user (customer or seller).
 * @param userId - The user ID to filter by
 * @param role - 'customer' filters by customer_id, 'seller' filters by seller_id
 * @param onOrderChange - Callback when an order changes
 */
export function useRealtimeOrders(
  userId: string | undefined,
  role: 'customer' | 'seller',
  onOrderChange: OrderChangeCallback,
) {
  const callbackRef = useRef(onOrderChange);
  callbackRef.current = onOrderChange;

  useEffect(() => {
    if (!userId) return;

    const filterColumn = role === 'customer' ? 'customer_id' : 'seller_id';

    const channel = supabase
      .channel(`orders-${role}-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `${filterColumn}=eq.${userId}`,
        },
        (payload) => {
          callbackRef.current({
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            new: (payload.new ?? {}) as Record<string, any>,
            old: (payload.old ?? {}) as Record<string, any>,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
