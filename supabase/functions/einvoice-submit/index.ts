import { admin, authenticatedUserId, corsHeaders, json } from '../_shared/deps.ts';
import { buildInvoiceUbl, type InvoiceDocument, type InvoiceLine } from '../_shared/invoice.ts';

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  issued_at: string;
  tax_rate_bps: number;
  buyer_snapshot: InvoiceDocument['buyer'];
  seller_snapshot: InvoiceDocument['seller'];
  lines: InvoiceLine[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
};

const PROVIDER_URL = Deno.env.get('GIB_PROVIDER_URL') ?? '';
const PROVIDER_TOKEN = Deno.env.get('GIB_PROVIDER_TOKEN') ?? '';
const PROVIDER_TIMEOUT_MS = 20_000;
const UNCERTAIN = 'Gönderim sonucu belirsiz. Sağlayıcı panelinden kontrol et; ulaşmadıysa faturayı kuyruğa geri al.';

async function setStatus(invoiceId: string, status: string, providerId?: string | null, error?: string | null): Promise<boolean> {
  const { error: rpcError } = await admin.rpc('service_set_invoice_status', {
    p_invoice: invoiceId,
    p_status: status,
    p_provider_id: providerId ?? null,
    p_error: error ?? null,
  });
  if (rpcError) console.error('einvoice-submit status', invoiceId, rpcError.message);
  return !rpcError;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await authenticatedUserId(req);
    if (!userId) return json(401, { error: 'Giriş yapmalısın' });
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle();
    if (profile?.role !== 'admin') return json(403, { error: 'Yetkin yok' });

    const { invoiceId } = await req.json().catch(() => ({}));
    if (typeof invoiceId !== 'string' || !invoiceId) return json(400, { error: 'Fatura belirtilmedi' });

    const { data: enabled } = await admin.rpc('einvoice_enabled');
    if (enabled !== true) return json(409, { error: 'E-fatura henüz açık değil' });
    if (!PROVIDER_URL || !PROVIDER_TOKEN) return json(503, { error: 'GİB sağlayıcısı yapılandırılmamış' });

    // Fatura önce "sending" durumuna alınır. Aynı anda gelen ikinci istek veya yeniden deneme faturayı alamaz,
    // böylece sağlayıcıya iki kez gönderilmez.
    const { data: claimed, error: claimError } = await admin.rpc('service_claim_invoice', { p_invoice: invoiceId });
    if (claimError) throw claimError;
    const row = claimed as InvoiceRow | null;
    if (!row?.id) {
      const { data: current } = await admin.from('invoices').select('status').eq('id', invoiceId).maybeSingle();
      if (!current) return json(404, { error: 'Fatura bulunamadı' });
      if (current.status === 'accepted') return json(200, { status: 'accepted', invoiceId });
      return json(409, { error: current.status === 'sending' ? 'Fatura zaten gönderiliyor' : 'Fatura gönderim için kuyrukta değil' });
    }

    const document: InvoiceDocument = {
      uuid: row.id,
      invoiceNumber: row.invoice_number,
      issuedAt: row.issued_at,
      currency: row.currency,
      taxRateBps: row.tax_rate_bps,
      seller: row.seller_snapshot,
      buyer: row.buyer_snapshot,
      lines: row.lines,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
    };
    const xml = buildInvoiceUbl(document);

    let response: Response;
    try {
      response = await fetch(PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PROVIDER_TOKEN}`,
          // Sağlayıcı destekliyorsa aynı faturanın tekrarını kendisi de reddeder.
          'Idempotency-Key': row.id,
        },
        body: JSON.stringify({ invoiceId: row.id, invoiceNumber: row.invoice_number, xml }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (sendError) {
      // Zaman aşımı veya ağ hatası: istek sağlayıcıya ulaşmış olabilir. Fatura "sending" kalır, kendiliğinden
      // yeniden gönderilmez.
      console.error('einvoice-submit fetch', row.id, sendError);
      await setStatus(row.id, 'sending', null, UNCERTAIN);
      return json(504, { error: UNCERTAIN });
    }

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || body?.success === false) {
      const message = String(body?.error ?? body?.message ?? `Sağlayıcı ${response.status} döndürdü`).slice(0, 900);
      if (response.status >= 400 && response.status < 500) {
        // Sağlayıcı isteği açıkça geri çevirdi; fatura oluşmadı. Düzeltilip yeniden gönderilebilir.
        await setStatus(row.id, 'queued', null, message);
        return json(502, { error: message });
      }
      // 5xx: sağlayıcı faturayı oluşturmuş olabilir.
      await setStatus(row.id, 'sending', null, `${message}. ${UNCERTAIN}`);
      return json(502, { error: `${message}. ${UNCERTAIN}` });
    }

    const providerId = String(body.id ?? body.invoiceId ?? body.uuid ?? '');
    const providerStatus = String(body.status ?? 'submitted').toLowerCase();
    const finalStatus = providerStatus === 'accepted' ? 'accepted' : providerStatus === 'rejected' ? 'rejected' : 'submitted';
    const saved = await setStatus(row.id, finalStatus, providerId, finalStatus === 'rejected' ? String(body.error ?? 'Sağlayıcı reddetti') : null);
    if (!saved) {
      // Sağlayıcı aldı ama sonuç kaydedilemedi; fatura "sending" kalır ve yeniden gönderilmez.
      return json(500, { error: 'Fatura sağlayıcıya gönderildi ancak sonuç kaydedilemedi. Sağlayıcı panelinden kontrol et.', providerId });
    }
    return json(200, { status: finalStatus, providerId, invoiceId: row.id });
  } catch (e) {
    console.error('einvoice-submit', e);
    return json(500, { error: 'Fatura gönderilemedi' });
  }
});
