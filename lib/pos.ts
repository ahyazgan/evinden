import { supabase } from './supabase';

/**
 * POS bağlantısı (060). Yeni sipariş ve durum değişiklikleri restoranın HTTPS adresine imzalı gönderilir;
 * POS, API anahtarıyla menüyü okuyup ürünleri "bitti" yapabilir. Ayrıntı: docs/POS-ENTEGRASYON.md.
 */
export type PosIntegration = {
  id: string;
  status: 'pending' | 'active' | 'error' | 'disabled';
  config: { webhook_url?: string | null };
  last_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type PosCredentials = { signing_secret: string; api_key: string };

export type PosDelivery = {
  id: number;
  event: string;
  order_id: string | null;
  created_at: string;
  status_code: number | null;
  error: string | null;
};

export async function fetchPosIntegration(sellerId: string): Promise<PosIntegration | null> {
  const { data, error } = await supabase
    .from('seller_integrations')
    .select('id, status, config, last_sync_at, last_error, updated_at')
    .eq('seller_id', sellerId)
    .eq('provider', 'pos')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PosIntegration | null;
}

/** İlk kayıtta anahtarlar döner ve yalnızca bir kez gösterilir; sonraki kayıtlarda null gelir. */
export async function savePosIntegration(webhookUrl: string, enabled: boolean): Promise<{ integration: PosIntegration; credentials: PosCredentials | null }> {
  const { data, error } = await supabase.rpc('save_pos_integration', { p_webhook_url: webhookUrl.trim() || null, p_enabled: enabled });
  if (error) throw error;
  const r = data as { integration: PosIntegration; signing_secret: string | null; api_key: string | null };
  return {
    integration: r.integration,
    credentials: r.api_key && r.signing_secret ? { api_key: r.api_key, signing_secret: r.signing_secret } : null,
  };
}

export async function rotatePosCredentials(): Promise<PosCredentials> {
  const { data, error } = await supabase.rpc('rotate_pos_credentials');
  if (error) throw error;
  return data as PosCredentials;
}

export async function deletePosIntegration(): Promise<void> {
  const { error } = await supabase.rpc('delete_pos_integration');
  if (error) throw error;
}

export async function sendPosTest(): Promise<void> {
  const { error } = await supabase.rpc('test_pos_webhook');
  if (error) throw error;
}

export async function fetchPosDeliveries(): Promise<PosDelivery[]> {
  const { data, error } = await supabase.rpc('pos_delivery_log');
  if (error) throw error;
  return (data ?? []) as PosDelivery[];
}

/** POS'un çağıracağı adres; anahtar istek gövdesinde gider. */
export function posApiBase(): string {
  return `${(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/rest/v1/rpc`;
}

export const POS_EVENT_TEXT: Record<string, string> = {
  'order.created': 'Yeni sipariş',
  'order.status_changed': 'Durum değişti',
  ping: 'Deneme',
};

/** Gönderim sonucu: 2xx başarılı; yanıt yoksa birkaç saat sonra pg_net kaydı silinmiş olabilir. */
export function posDeliveryResult(d: Pick<PosDelivery, 'status_code' | 'error'>): { label: string; ok: boolean | null } {
  if (d.error) return { label: d.error, ok: false };
  if (d.status_code == null) return { label: 'Sonuç bilinmiyor', ok: null };
  return d.status_code >= 200 && d.status_code < 300
    ? { label: `Ulaştı (${d.status_code})`, ok: true }
    : { label: `Hata (${d.status_code})`, ok: false };
}
