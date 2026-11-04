import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

export type ChatRole = 'customer' | 'seller';

export type ConversationRow = {
  id: string;
  my_role: ChatRole;
  seller_id: string;
  other_name: string;
  other_image: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  blocked_by: ChatRole | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_role: ChatRole;
  body: string;
  created_at: string;
};

export type MessageReportRow = {
  id: string;
  message_id: string | null;
  reporter_id: string | null;
  reported_user: string | null;
  body_snapshot: string;
  reason: string;
  status: 'open' | 'closed';
  created_at: string;
};

const PAGE_SIZE = 50;

// Aynı adlı kanal paylaşılır ve kapatılınca herkes için kapanır; her dinleyici kendi kanalını açar.
let channelSeq = 0;

/** Sunucunun kullanıcıya gösterilebilir hatası (55000) dışında genel mesaj döner. */
export function chatErrorMessage(e: any): string {
  return e?.code === '55000' ? e.message : 'Tekrar dene.';
}

export async function fetchConversations(as: ChatRole): Promise<ConversationRow[]> {
  const { data, error } = await supabase.rpc('get_my_conversations', { p_as: as, p_id: null });
  if (error) throw error;
  return (data ?? []) as ConversationRow[];
}

export async function fetchConversation(id: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase.rpc('get_my_conversations', { p_as: null, p_id: id });
  if (error) throw error;
  return ((data ?? []) as ConversationRow[])[0] ?? null;
}

/** Hata sayaç gösterimini bozmasın: okunamazsa 0. */
export async function fetchUnreadCount(as: ChatRole): Promise<number> {
  try {
    const rows = await fetchConversations(as);
    return rows.reduce((sum, c) => sum + c.unread_count, 0);
  } catch {
    return 0;
  }
}

/** En yeniden eskiye. `before` verilirse o andan eski sayfayı getirir. */
export async function fetchMessages(conversationId: string, before?: string): Promise<MessageRow[]> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export const MESSAGE_PAGE_SIZE = PAGE_SIZE;

/** Müşterinin satıcıya mesajı; sohbet yoksa açılır. Sohbet kimliğini döndürür. */
export async function sendMessageToSeller(sellerId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_message_to_seller', { p_seller: sellerId, p_body: body });
  if (error) throw error;
  return data as string;
}

export async function sendMessage(conversationId: string, body: string): Promise<MessageRow> {
  const { data, error } = await supabase.rpc('send_message', { p_conversation: conversationId, p_body: body });
  if (error) throw error;
  return data as MessageRow;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
  if (error) throw error;
}

export async function setConversationBlocked(conversationId: string, blocked: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_blocked', { p_conversation: conversationId, p_blocked: blocked });
  if (error) throw error;
}

export async function reportMessage(messageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_message', { p_message: messageId, p_reason: reason });
  if (error) throw error;
}

export async function fetchMessageReports(): Promise<MessageReportRow[]> {
  const { data, error } = await supabase
    .from('message_reports')
    .select('*')
    .order('status', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as MessageReportRow[];
}

export async function closeMessageReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_close_report', { p_report: reportId });
  if (error) throw error;
}

/** Sohbete gelen yeni mesajları dinler. */
export function useRealtimeMessages(conversationId: string | undefined, onMessage: (m: MessageRow) => void) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => callbackRef.current(payload.new as MessageRow),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);
}

/** Sohbet listesi değişince haber verir; RLS yalnızca kullanıcının sohbetlerini iletir. */
export function useConversationChanges(enabled: boolean, onChange: () => void) {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`conversations-list-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => callbackRef.current())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
