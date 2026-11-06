// Kurumsal operasyon istemcisi: SLA, karar raporları, fatura, iade ve mutabakat.
// Tüm yazma işlemleri sunucu RPC'si üzerinden yönetici yetkisiyle yapılır.
import { supabase } from './supabase';

export type OperationsOverview = {
  invoice_candidates: number;
  invoice_drafts: number;
  invoice_submitted: number;
  invoice_rejected: number;
  /** İadesi onaylanan siparişin gönderilmiş faturası: GİB iptali veya alıcının iade faturası kaydı bekliyor (052). */
  invoice_corrections: number;
  /** 24 saattir sağlayıcıdan sonuç gelmeyen fatura. */
  invoice_stale: number;
  sla_open: number;
  refunds_requested: number;
  refunds_approved: number;
  reconciliation_differences: number;
};

export async function fetchOperationsOverview(): Promise<OperationsOverview> {
  const { data, error } = await supabase.rpc('admin_operations_overview');
  if (error) throw error;
  return data as OperationsOverview;
}

export type DecisionReport = {
  days: number;
  summary: {
    orders: number;
    delivered: number;
    cancelled: number;
    revenue_cents: number;
    refunds: number;
    success_rate: number | null;
  };
  daily: Array<{
    day: string;
    orders: number;
    delivered: number;
    cancelled: number;
    revenue_cents: number;
    refunds: number;
    success_rate: number | null;
  }>;
  weekly: Array<{
    week_start: string;
    orders: number;
    delivered: number;
    revenue_cents: number;
    refunds: number;
    success_rate: number | null;
  }>;
  sellers: Array<{
    id: string;
    display_name: string;
    orders: number;
    delivered: number;
    revenue_cents: number;
    avg_delivery_minutes: number | null;
    cancel_rate: number;
    refund_rate: number;
  }>;
  customers: Array<{
    id: string;
    name: string;
    orders: number;
    spend_cents: number;
    last_order_at: string;
    avg_delivery_minutes: number | null;
    refunds: number;
    segment: 'new' | 'repeat' | 'at_risk';
  }>;
};

export async function fetchDecisionReport(days: number): Promise<DecisionReport> {
  const { data, error } = await supabase.rpc('admin_decision_report', { p_days: days });
  if (error) throw error;
  return data as DecisionReport;
}

export type DecisionPeriod = {
  orders: number;
  delivered: number;
  cancelled: number;
  revenue_cents: number;
  refunds: number;
  success_rate: number | null;
};

export type DecisionComparison = {
  days: number;
  current: DecisionPeriod;
  previous: DecisionPeriod;
};

export async function fetchDecisionComparison(days: number): Promise<DecisionComparison> {
  const { data, error } = await supabase.rpc('admin_decision_comparison', { p_days: days });
  if (error) throw error;
  return data as DecisionComparison;
}

export type SlaPolicy = {
  enabled: boolean;
  reminder_minutes: number;
  cancel_minutes: number;
  preparation_cancel_minutes: number;
  action: 'cancel' | 'penalty';
  penalty_cents: number;
};

export type SlaViolationRow = {
  id: string;
  order_id: string;
  seller_id: string;
  seller_name: string;
  violation_type: 'acceptance_timeout' | 'preparation_timeout';
  minutes_late: number;
  penalty_cents: number;
  status: 'open' | 'waived' | 'collected';
  note: string | null;
  occurred_at: string;
};

export async function fetchSlaPolicy(): Promise<SlaPolicy> {
  const { data, error } = await supabase.rpc('sla_policy');
  if (error) throw error;
  return data as SlaPolicy;
}

export async function updateSlaPolicy(policy: Partial<SlaPolicy>): Promise<void> {
  const { error } = await supabase.rpc('admin_update_sla_policy', { p_policy: policy });
  if (error) throw error;
}

export async function fetchSlaViolations(status: 'open' | 'waived' | 'collected' | null = 'open'): Promise<SlaViolationRow[]> {
  const { data, error } = await supabase.rpc('admin_list_sla_violations', { p_status: status });
  if (error) throw error;
  return (data ?? []) as SlaViolationRow[];
}

export async function resolveSlaViolation(id: string, status: 'waived' | 'collected', note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_sla_violation', {
    p_violation: id,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export type RefundCaseRow = {
  id: string;
  order_id: string;
  seller_id: string;
  seller_name: string;
  customer_id: string;
  customer_name: string;
  reason: string;
  payment_method: 'cash' | 'card_door' | 'meal_card_door' | 'online';
  requested_cents: number;
  approved_cents: number | null;
  status: 'requested' | 'approved' | 'rejected' | 'paid';
  decision_note: string | null;
  requested_at: string;
  decided_at: string | null;
  paid_at: string | null;
};

export async function fetchRefundCases(status: RefundCaseRow['status'] | null = null): Promise<RefundCaseRow[]> {
  const { data, error } = await supabase.rpc('admin_list_refund_cases', { p_status: status });
  if (error) throw error;
  return (data ?? []) as RefundCaseRow[];
}

export async function decideRefundCase(
  id: string,
  decision: 'approved' | 'rejected',
  approvedCents?: number,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_refund_case', {
    p_case: id,
    p_decision: decision,
    p_approved_cents: approvedCents ?? null,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function markRefundCasePaid(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_refund_case_paid', { p_case: id });
  if (error) throw error;
}

export type ReconciliationRow = {
  id: string;
  period_start: string;
  period_end: string;
  source: 'iyzico' | 'bank';
  reference: string | null;
  expected_cents: number;
  actual_cents: number;
  difference_cents: number;
  status: 'matched' | 'difference' | 'closed';
  note: string | null;
  created_at: string;
  closed_at: string | null;
};

export async function fetchReconciliations(): Promise<ReconciliationRow[]> {
  const { data, error } = await supabase.rpc('admin_list_reconciliations');
  if (error) throw error;
  return (data ?? []) as ReconciliationRow[];
}

export type ReconciliationBreakdown = {
  expected_cents: number;
  actual_cents: number;
  difference_cents: number;
  gross_sales_cents: number;
  refunds_cents: number;
  refund_pending_cents: number;
  online_orders: number;
  door_orders: number;
  net_cents: number;
  items: Array<{ name: string; quantity: number; line_total_cents: number }>;
};

export async function fetchReconciliationBreakdown(id: string): Promise<ReconciliationBreakdown> {
  const { data, error } = await supabase.rpc('admin_reconciliation_breakdown', { p_run: id });
  if (error) throw error;
  return data as ReconciliationBreakdown;
}

export async function createReconciliation(input: {
  periodStart: string;
  periodEnd: string;
  actualCents: number;
  source: 'iyzico' | 'bank';
  reference?: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_create_reconciliation', {
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_actual_cents: input.actualCents,
    p_source: input.source,
    p_reference: input.reference ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
}

export async function closeReconciliation(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_close_reconciliation', { p_run: id, p_note: note ?? null });
  if (error) throw error;
}

export type InvoiceLine = {
  kind?: 'item' | 'delivery' | 'discount';
  name: string;
  quantity: number;
  unitPriceCents: number;
  /** KDV dahil; indirim satırında negatif. */
  lineTotalCents: number;
  netCents?: number;
  taxCents?: number;
};

export type InvoiceDetail = {
  id: string;
  invoice_number: string;
  order_id: string;
  status: InvoiceRow['status'];
  buyer_snapshot: { title?: string; taxNumber?: string; taxOffice?: string; address?: string; email?: string };
  seller_snapshot: { title?: string; taxNumber?: string; taxOffice?: string; address?: string; email?: string };
  lines: InvoiceLine[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  provider: string;
  provider_id: string | null;
  error: string | null;
  issued_at: string;
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  correction_status: InvoiceCorrectionStatus;
  correction_outcome: 'cancelled' | 'credit_note' | null;
  correction_reference: string | null;
  correction_note: string | null;
  corrected_at: string | null;
};

export type InvoiceCorrectionStatus = 'required' | 'resolved' | null;

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  order_id: string;
  seller_id: string;
  seller_name: string;
  customer_id: string;
  customer_name: string;
  status: 'draft' | 'queued' | 'sending' | 'submitted' | 'accepted' | 'rejected' | 'cancelled';
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  provider: string;
  provider_id: string | null;
  error: string | null;
  issued_at: string;
  created_at: string;
  correction_status?: InvoiceCorrectionStatus;
};

export type InvoiceCandidateRow = {
  order_id: string;
  customer_id: string;
  customer_name: string;
  seller_id: string;
  seller_name: string;
  total_cents: number;
  created_at: string;
  billing_title: string | null;
  billing_tax_number: string | null;
  billing_tax_office: string | null;
  billing_address: string | null;
  billing_email: string | null;
};

export async function fetchInvoices(status: InvoiceRow['status'] | null = null): Promise<InvoiceRow[]> {
  const { data, error } = await supabase.rpc('admin_list_invoices', { p_status: status });
  if (error) throw error;
  return (data ?? []) as InvoiceRow[];
}

export async function fetchInvoiceCandidates(): Promise<InvoiceCandidateRow[]> {
  const { data, error } = await supabase.rpc('admin_list_invoice_candidates');
  if (error) throw error;
  return (data ?? []) as InvoiceCandidateRow[];
}

export async function createInvoice(orderId: string, buyer: {
  title: string;
  taxNumber: string;
  taxOffice: string;
  address: string;
  email: string;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_create_invoice', { p_order: orderId, p_buyer: buyer });
  if (error) throw error;
}

export async function fetchInvoiceDetail(invoiceId: string): Promise<InvoiceDetail> {
  const { data, error } = await supabase.rpc('admin_invoice_detail', { p_invoice: invoiceId });
  if (error) throw error;
  return data as InvoiceDetail;
}

export type BulkInvoiceResult = {
  created: number;
  skipped: number;
  errors: Array<{ order_id: string; message: string }>;
};

export async function createInvoices(orderIds: string[]): Promise<BulkInvoiceResult> {
  const { data, error } = await supabase.rpc('admin_create_invoices', { p_orders: orderIds });
  if (error) throw error;
  return data as BulkInvoiceResult;
}

export async function submitInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('einvoice-submit', { body: { invoiceId } });
  if (error) {
    const body = (error as { context?: Response }).context?.json?.().catch(() => null);
    const message = (await body as { error?: string } | null)?.error;
    throw new Error(message ?? 'Fatura gönderilemedi');
  }
}

export async function retryInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_retry_invoice', { p_invoice: invoiceId });
  if (error) throw error;
}

/** Sonucu belirsiz kalan gönderimi, sağlayıcıda olmadığı görüldükten sonra kuyruğa geri alır. */
export async function releaseInvoice(invoiceId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_release_invoice', { p_invoice: invoiceId, p_note: note });
  if (error) throw error;
}

/**
 * İadesi onaylanan siparişin gönderilmiş faturasını kapatır: GİB iptal portalından iptal edildi
 * veya alıcı iade faturası kesti (numarası zorunlu).
 */
export async function resolveInvoiceCorrection(
  invoiceId: string,
  outcome: 'cancelled' | 'credit_note',
  reference?: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_invoice_correction', {
    p_invoice: invoiceId,
    p_outcome: outcome,
    p_reference: reference ?? null,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export type InvoiceStatusRefresh = { checked: number; accepted: number; rejected: number; unchanged: number; failed: number };

/** Gönderilmiş faturaların GİB sonucunu sağlayıcıdan sorgular (einvoice-status). */
export async function refreshInvoiceStatuses(): Promise<InvoiceStatusRefresh> {
  const { data, error } = await supabase.functions.invoke('einvoice-status', { body: {} });
  if (error) {
    const body = (error as { context?: Response }).context?.json?.().catch(() => null);
    const message = (await body as { error?: string } | null)?.error;
    throw new Error(message ?? 'Fatura durumları sorgulanamadı');
  }
  return data as InvoiceStatusRefresh;
}

export type SellerSlaRow = {
  id: string;
  order_id: string;
  violation_type: 'acceptance_timeout' | 'preparation_timeout';
  minutes_late: number;
  penalty_cents: number;
  status: 'open' | 'waived' | 'collected';
  note: string | null;
  occurred_at: string;
  resolved_at: string | null;
};

export async function fetchSellerSlaViolations(): Promise<SellerSlaRow[]> {
  const { data, error } = await supabase.rpc('seller_list_sla_violations', { p_limit: 100 });
  if (error) throw error;
  return (data ?? []) as SellerSlaRow[];
}

export type SellerInvoiceRow = {
  id: string;
  invoice_number: string;
  order_id: string;
  status: InvoiceRow['status'];
  buyer_title: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  issued_at: string;
  accepted_at: string | null;
  correction_status: InvoiceCorrectionStatus;
};

export async function fetchSellerInvoices(): Promise<SellerInvoiceRow[]> {
  const { data, error } = await supabase.rpc('seller_list_invoices', { p_limit: 100 });
  if (error) throw error;
  return (data ?? []) as SellerInvoiceRow[];
}

export async function queueInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_queue_invoice', { p_invoice: invoiceId });
  if (error) throw error;
}

export async function requestInvoice(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('request_invoice', { p_order: orderId });
  if (error) throw error;
}

export async function fetchMyInvoices(): Promise<InvoiceRow[]> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, order_id, seller_id, customer_id, status, subtotal_cents, tax_cents, total_cents, provider, provider_id, error, issued_at, created_at')
    .eq('customer_id', uid)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as InvoiceRow[];
}

export type BillingProfile = {
  user_id: string;
  legal_title: string;
  tax_office: string;
  tax_number: string;
  address: string;
  email: string;
  phone: string | null;
  is_default: boolean;
};

export async function fetchBillingProfile(): Promise<BillingProfile | null> {
  const { data, error } = await supabase.from('corporate_billing_profiles').select('*').maybeSingle();
  if (error) throw error;
  return data as BillingProfile | null;
}

export async function saveBillingProfile(profile: Omit<BillingProfile, 'user_id' | 'created_at' | 'updated_at'>): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Giriş yapmalısınız');
  const { error } = await supabase.from('corporate_billing_profiles').upsert({
    ...profile,
    user_id: userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
