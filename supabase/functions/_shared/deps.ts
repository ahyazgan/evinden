// Edge Function ortamı: service role istemcisi ve iyzico ayarları.
import { createClient } from 'npm:@supabase/supabase-js@2.100.1';
import { iyzicoPost, iyzicoPut, type CompanyInfo, type IyzicoConfig } from './iyzico.ts';
import type { ApprovalRow, PaymentDeps, PaymentOrder } from './handlers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const config: IyzicoConfig = {
  apiKey: Deno.env.get('IYZICO_API_KEY') ?? '',
  secretKey: Deno.env.get('IYZICO_SECRET_KEY') ?? '',
  baseUrl: Deno.env.get('IYZICO_BASE_URL') ?? 'https://sandbox-api.iyzipay.com',
};

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

export const deps: PaymentDeps = {
  callbackUrl: `${SUPABASE_URL}/functions/v1/payment-callback`,
  iyzico: (path, payload) => iyzicoPost(path, payload, config),
  iyzicoPut: (path, payload) => iyzicoPut(path, payload, config),
  getOrder: async id => {
    const { data, error } = await admin
      .from('orders')
      .select('id, customer_id, seller_id, status, payment_method, payment_status, total_cents, delivery_address, subtotal_cents, delivery_fee_cents, platform_delivery_cents, seller_discount_cents, commission_cents, tip_cents')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as PaymentOrder | null;
  },
  getOrderIdByToken: async token => {
    const { data, error } = await admin.from('order_payments').select('order_id').eq('token', token).maybeSingle();
    if (error) throw error;
    return data?.order_id ?? null;
  },
  getBuyer: async userId => {
    const [{ data: profile }, { data: auth }] = await Promise.all([
      admin.from('users').select('name, phone').eq('id', userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    return { id: userId, name: profile?.name ?? null, phone: auth?.user?.phone || profile?.phone || null, email: auth?.user?.email ?? null };
  },
  getSellerCity: async sellerId => {
    const { data } = await admin.from('sellers').select('city').eq('id', sellerId).maybeSingle();
    return data?.city ?? null;
  },
  getTransactions: async orderId => {
    const { data, error } = await admin.from('order_payments').select('transactions').eq('order_id', orderId).maybeSingle();
    if (error) throw error;
    return (data?.transactions ?? []) as { paymentTransactionId?: string | number; paidPrice?: unknown }[];
  },
  recordInit: async (orderId, token, plan) => {
    await rpc('record_payment_init', {
      p_order: orderId,
      p_token: token,
      p_marketplace: plan.flow === 'marketplace',
      p_submerchant_key: plan.flow === 'marketplace' ? plan.subMerchantKey : null,
      p_submerchant_price_cents: plan.flow === 'marketplace' ? plan.subMerchantCents : null,
      p_fallback_reason: plan.flow === 'listing' ? plan.reason : null,
    });
  },
  claimInit: async orderId => (await rpc('claim_payment_init', { p_order: orderId })) === true,
  releaseInit: async orderId => { await rpc('release_payment_init', { p_order: orderId }); },
  claimRefund: async orderId => (await rpc('claim_payment_refund', { p_order: orderId })) === true,
  getMarketplaceAccount: async sellerId => {
    const { data: enabled, error } = await admin.rpc('marketplace_enabled');
    if (error) throw new Error(`marketplace_enabled: ${error.message}`);
    if (enabled !== true) return { enabled: false, subMerchantKey: null };
    const { data, error: keyError } = await admin
      .from('seller_submerchants')
      .select('submerchant_key, status')
      .eq('seller_id', sellerId)
      .maybeSingle();
    if (keyError) throw keyError;
    return { enabled: true, subMerchantKey: data?.status === 'active' ? data.submerchant_key : null };
  },
  getPaymentFlow: async orderId => {
    const { data, error } = await admin.from('order_payments').select('marketplace, payment_id').eq('order_id', orderId).maybeSingle();
    if (error) throw error;
    return { marketplace: data?.marketplace === true, paymentId: data?.payment_id ?? null };
  },
  beginMarketplaceRefund: async orderId =>
    (await rpc('begin_marketplace_refund', { p_order: orderId })) as 'none' | 'cancelled' | 'approved' | 'in_flight',
  markMarketplaceApproved: async orderId => {
    await rpc('mark_marketplace_approved', { p_order: orderId });
  },
  markMarketplaceReversed: async orderId => {
    await rpc('mark_marketplace_reversed', { p_order: orderId });
  },
  claimApprovals: async limit => ((await rpc('claim_payment_approvals', { p_limit: limit })) ?? []) as ApprovalRow[],
  completeApproval: async orderId => {
    await rpc('complete_payment_approval', { p_order: orderId });
  },
  failApproval: async (orderId, error, final) => {
    await rpc('fail_payment_approval', { p_order: orderId, p_error: error, p_final: final });
  },
  getSubmerchantInput: async sellerId => {
    const [seller, company, payout, sub] = await Promise.all([
      admin.from('sellers').select('id, display_name').eq('id', sellerId).maybeSingle(),
      admin.from('seller_company_info').select('*').eq('seller_id', sellerId).maybeSingle(),
      admin.from('seller_payout_accounts').select('iban').eq('seller_id', sellerId).maybeSingle(),
      admin.from('seller_submerchants').select('submerchant_key').eq('seller_id', sellerId).maybeSingle(),
    ]);
    // Hata nesnesi yazdırılmaz: içinde kimlik veya IBAN geçebilir.
    if (seller.error || company.error || payout.error || sub.error) throw new Error('Satıcı bilgileri okunamadı');
    if (!seller.data) return null;
    return {
      seller: seller.data,
      company: (company.data as CompanyInfo | null) ?? null,
      payout: payout.data ?? null,
      subMerchantKey: sub.data?.submerchant_key ?? null,
    };
  },
  saveSubmerchant: async (sellerId, { key, error }) => {
    const now = new Date().toISOString();
    // Güncelleme başarısızsa eski kayıt iyzico'da geçerlidir: anahtar ve durum korunur, yalnızca hata görünür.
    const { error: saveError } = await admin.from('seller_submerchants').upsert({
      seller_id: sellerId,
      submerchant_key: key,
      status: key ? 'active' : 'error',
      last_error: error,
      updated_at: now,
      ...(error ? {} : { synced_at: now }),
    });
    if (saveError) throw new Error('Alt üye kaydı saklanamadı');
  },
  markPaid: async (orderId, paymentId, transactions, paidCents) =>
    (await rpc('mark_order_paid', {
      p_order: orderId,
      p_payment_id: paymentId,
      p_transactions: transactions,
      p_paid_cents: paidCents,
    })) as string,
  markRefunded: async orderId => {
    await rpc('mark_order_refunded', { p_order: orderId });
  },
  recordError: async (orderId, error) => {
    await rpc('record_payment_error', { p_order: orderId, p_error: error });
  },
  flagRefund: async (orderId, paymentId, transactions, reason) => {
    await rpc('flag_payment_refund', {
      p_order: orderId,
      p_payment_id: paymentId ?? null,
      p_transactions: transactions,
      p_reason: reason,
    });
  },
  listOpenPayments: async limit => {
    const { data, error } = await admin
      .from('order_payments')
      .select('order_id, token, created_at')
      .is('paid_at', null)
      .is('closed_at', null)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw error;
    const rows = data ?? [];
    // Sıra dönsün: uzun süre açık kalan kayıtlar yeni ödemelerin önünü kesmesin.
    if (rows.length > 0) {
      const { error: touchError } = await admin
        .from('order_payments')
        .update({ last_checked_at: new Date().toISOString() })
        .in('order_id', rows.map(r => r.order_id));
      if (touchError) throw touchError;
    }
    return rows;
  },
  cancelUnpaid: async orderId => {
    const { error } = await admin
      .from('orders')
      .update({ status: 'cancelled', cancel_reason: 'Ödeme tamamlanmadı', updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', 'awaiting_payment')
      .eq('payment_status', 'pending');
    if (error) throw error;
  },
  closePayment: async orderId => {
    const { error } = await admin
      .from('order_payments')
      .update({ closed_at: new Date().toISOString() })
      .eq('order_id', orderId);
    if (error) throw error;
  },
};

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Zamanlanmış görevin gizli değerini sabit sürede karşılaştırır. Değer tanımlı değilse hiçbir istek geçmez. */
export async function validCronSecret(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  const given = req.headers.get('x-cron-secret');
  if (!secret || !given) return false;
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(secret), digest(given)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}

/** İsteği yapan kullanıcıyı JWT'den doğrular. */
export async function authenticatedUserId(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}
