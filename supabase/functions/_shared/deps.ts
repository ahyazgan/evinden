// Edge Function ortamı: service role istemcisi ve iyzico ayarları.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { iyzicoPost, type IyzicoConfig } from './iyzico.ts';
import type { PaymentDeps, PaymentOrder } from './handlers.ts';

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
  getOrder: async id => {
    const { data, error } = await admin
      .from('orders')
      .select('id, customer_id, seller_id, status, payment_method, payment_status, total_cents, delivery_address')
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
    return { id: userId, name: profile?.name ?? null, phone: profile?.phone ?? auth?.user?.phone ?? null, email: auth?.user?.email ?? null };
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
  recordInit: async (orderId, token) => {
    await rpc('record_payment_init', { p_order: orderId, p_token: token });
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
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
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
