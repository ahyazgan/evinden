// Pazar yeri fatura modeli (053):
//   - Yemeğin faturasını restoran kendi sisteminden keser; müşteri kurumsal fatura ister, restoran numarayı işler.
//   - Platform restorana aylık komisyon faturası keser.
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from './supabase';

export type BuyerSnapshot = { title: string; taxNumber: string; taxOffice: string; address: string; email: string };

export type OrderInvoiceStatus = 'requested' | 'issued' | 'correction_required' | 'corrected' | 'cancelled';

export type OrderInvoiceRequest = {
  order_id: string;
  seller_id: string;
  customer_id: string | null;
  buyer: BuyerSnapshot;
  status: OrderInvoiceStatus;
  invoice_number: string | null;
  document_path: string | null;
  issued_at: string | null;
  correction_note: string | null;
  corrected_at: string | null;
  created_at: string;
};

export const ORDER_INVOICE_STATUS: Record<OrderInvoiceStatus, { label: string; variant: 'amber' | 'success' | 'danger' | 'muted' | 'info' }> = {
  requested: { label: 'Kesilecek', variant: 'amber' },
  issued: { label: 'Kesildi', variant: 'success' },
  correction_required: { label: 'Düzeltilecek', variant: 'danger' },
  corrected: { label: 'Düzeltildi', variant: 'muted' },
  cancelled: { label: 'İptal', variant: 'muted' },
};

const REQUEST_COLUMNS = 'order_id, seller_id, customer_id, buyer, status, invoice_number, document_path, issued_at, correction_note, corrected_at, created_at';

/** Müşteri: kendi siparişleri için açtığı fatura talepleri. */
export async function fetchMyInvoiceRequests(customerId: string): Promise<OrderInvoiceRequest[]> {
  const { data, error } = await supabase.from('order_invoice_requests').select(REQUEST_COLUMNS)
    .eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as OrderInvoiceRequest[];
}

/** Restoran: kendisinden istenen faturalar. */
export async function fetchSellerInvoiceRequests(sellerId: string): Promise<OrderInvoiceRequest[]> {
  const { data, error } = await supabase.from('order_invoice_requests').select(REQUEST_COLUMNS)
    .eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as OrderInvoiceRequest[];
}

export async function requestOrderInvoice(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('request_order_invoice', { p_order: orderId });
  if (error) throw error;
}

export async function markOrderInvoiced(orderId: string, invoiceNumber: string, documentPath?: string | null): Promise<void> {
  const { error } = await supabase.rpc('seller_mark_order_invoiced', {
    p_order: orderId, p_number: invoiceNumber, p_document_path: documentPath ?? null,
  });
  if (error) throw error;
}

export async function markInvoiceCorrected(orderId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('seller_mark_invoice_corrected', { p_order: orderId, p_note: note });
  if (error) throw error;
}

/** Restoran fatura PDF'ini (veya fotoğrafını) seçip yükler; depolama yolunu döndürür. Vazgeçilirse null. */
export async function pickAndUploadOrderInvoice(userId: string, orderId: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > 5 * 1024 * 1024) throw new Error('Dosya 5 MB’tan büyük olamaz.');
  const contentType = asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const ext = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : 'jpg';
  const path = `${userId}/${orderId}/fatura-${Date.now()}.${ext}`;
  const blob = await (await fetch(asset.uri)).blob();
  const { error } = await supabase.storage.from('order-invoices').upload(path, blob, { contentType });
  if (error) throw new Error(error.message);
  return path;
}

/** Fatura belgesi için 10 dakikalık bağlantı. */
export async function orderInvoiceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('order-invoices').createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ── Komisyon faturası ──────────────────────────────────────────────────────

export type CommissionInvoice = {
  id: string;
  seller_id: string;
  seller_name?: string;
  legal_title?: string | null;
  tax_number?: string | null;
  period_month: string;
  order_count: number;
  commission_cents: number;
  tax_rate_bps: number;
  tax_cents: number;
  total_cents: number;
  status: 'draft' | 'issued' | 'cancelled';
  invoice_number: string | null;
  issued_at: string | null;
};

/** Restoran: platformun kendisine kestiği komisyon faturaları (yalnızca kesilenler görünür). */
export async function fetchMyCommissionInvoices(sellerId: string): Promise<CommissionInvoice[]> {
  const { data, error } = await supabase.from('commission_invoices')
    .select('id, seller_id, period_month, order_count, commission_cents, tax_rate_bps, tax_cents, total_cents, status, invoice_number, issued_at')
    .eq('seller_id', sellerId).order('period_month', { ascending: false }).limit(24);
  if (error) throw error;
  return (data ?? []) as CommissionInvoice[];
}

export async function generateCommissionInvoices(month: string): Promise<{ drafts: number; issued: number }> {
  const { data, error } = await supabase.rpc('admin_generate_commission_invoices', { p_month: month });
  if (error) throw error;
  return data as { drafts: number; issued: number };
}

export async function listCommissionInvoices(month: string): Promise<CommissionInvoice[]> {
  const { data, error } = await supabase.rpc('admin_list_commission_invoices', { p_month: month });
  if (error) throw error;
  return (data ?? []) as CommissionInvoice[];
}

export async function markCommissionInvoiced(id: string, invoiceNumber: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_commission_invoiced', {
    p_invoice: id, p_number: invoiceNumber, p_note: note ?? null,
  });
  if (error) throw error;
}

/** "2026-10-01" → "Ekim 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

/** Bugünden geriye kapanmış son n ay, "YYYY-MM-01" biçiminde. */
export function closedMonths(n: number, today = new Date()): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}
