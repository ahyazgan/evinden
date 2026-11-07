import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
export { SUBSTITUTION_REASONS, substitutionCandidates, substitutionLive, latestSubstitutionByItem, SUBSTITUTION_STATUS_TEXT } from './substitution-rules';
export type { SubstitutionRow, SubstitutionStatus } from './substitution-rules';
import type { SubstitutionRow } from './substitution-rules';

/**
 * Ürün değiştirme teklifi (050, 060): restoran kabul ettiği siparişte biten ürün yerine menüsündeki aynı fiyatlı
 * bir ürünü önerir, müşteri 15 dakika içinde onaylar ya da reddeder. Fiyat değişmez.
 */
export async function fetchSubstitutions(orderIds: string[]): Promise<SubstitutionRow[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabase
    .from('order_item_substitutions')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SubstitutionRow[];
}

export async function proposeSubstitution(orderItemId: string, replacementItemId: string, reason: string): Promise<SubstitutionRow> {
  const { data, error } = await supabase.rpc('propose_item_substitution', {
    p_order_item: orderItemId,
    p_replacement_item: replacementItemId,
    p_replacement_title: null,
    p_reason: reason,
  });
  if (error) throw error;
  return data as SubstitutionRow;
}

export async function respondSubstitution(id: string, accept: boolean, note?: string): Promise<SubstitutionRow> {
  const { data, error } = await supabase.rpc('respond_item_substitution', {
    p_substitution: id,
    p_accept: accept,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data as SubstitutionRow;
}

let nextChannel = 0;

/** Teklif değişikliklerini canlı dinler; satır güvenliği yalnızca kişinin görebildiği teklifleri gönderir. */
export function useSubstitutionUpdates(key: string | undefined, onChange: (row: SubstitutionRow) => void, orderId?: string) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!key) return;
    const channel = supabase
      .channel(`substitutions-${key}-${++nextChannel}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_item_substitutions',
          ...(orderId ? { filter: `order_id=eq.${orderId}` } : {}),
        },
        payload => { if (payload.new && (payload.new as any).id) cb.current(payload.new as SubstitutionRow); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [key, orderId]);
}

