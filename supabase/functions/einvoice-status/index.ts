import { admin, authenticatedUserId, corsHeaders, json } from '../_shared/deps.ts';

// Sağlayıcıya gönderilmiş ("submitted") faturaların GİB sonucunu sorgular ve kabul / ret sonucunu kaydeder.
// Yönetici "Durumları sorgula" ile çalıştırır. Adres entegratöre göre ayarlanır:
//   GIB_PROVIDER_STATUS_URL = https://entegrator.example/api/invoices/{id}/status   ({id} = sağlayıcı referansı)
// Yanıtta "status" alanı beklenir: accepted / rejected / diğerleri (henüz sonuç yok). Entegratör farklı
// alan adları kullanıyorsa aşağıdaki eşleme değiştirilir.

const STATUS_URL = Deno.env.get('GIB_PROVIDER_STATUS_URL') ?? '';
const PROVIDER_TOKEN = Deno.env.get('GIB_PROVIDER_TOKEN') ?? '';
const TIMEOUT_MS = 15_000;
const BATCH = 50;

const ACCEPTED = new Set(['accepted', 'approved', 'success', 'kabul']);
const REJECTED = new Set(['rejected', 'declined', 'error', 'failed', 'red']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await authenticatedUserId(req);
    if (!userId) return json(401, { error: 'Giriş yapmalısın' });
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle();
    if (profile?.role !== 'admin') return json(403, { error: 'Yetkin yok' });

    const { data: enabled } = await admin.rpc('einvoice_enabled');
    if (enabled !== true) return json(409, { error: 'E-fatura henüz açık değil' });
    if (!STATUS_URL.includes('{id}') || !PROVIDER_TOKEN) return json(503, { error: 'Sağlayıcı durum adresi yapılandırılmamış' });

    const { data: rows, error } = await admin
      .from('invoices')
      .select('id, provider_id')
      .eq('status', 'submitted')
      .not('provider_id', 'is', null)
      .order('submitted_at', { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    const result = { checked: 0, accepted: 0, rejected: 0, unchanged: 0, failed: 0 };
    for (const row of rows ?? []) {
      result.checked += 1;
      try {
        const response = await fetch(STATUS_URL.replace('{id}', encodeURIComponent(String(row.provider_id))), {
          headers: { Authorization: `Bearer ${PROVIDER_TOKEN}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) { result.failed += 1; continue; }
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        const status = String(body.status ?? '').toLowerCase();
        if (!ACCEPTED.has(status) && !REJECTED.has(status)) { result.unchanged += 1; continue; }
        const next = ACCEPTED.has(status) ? 'accepted' : 'rejected';
        const message = next === 'rejected' ? String(body.error ?? body.message ?? 'GİB faturayı reddetti').slice(0, 900) : null;
        const { error: saveError } = await admin.rpc('service_set_invoice_status', {
          p_invoice: row.id, p_status: next, p_provider_id: null, p_error: message,
        });
        if (saveError) { console.error('einvoice-status save', row.id, saveError.message); result.failed += 1; continue; }
        result[next] += 1;
      } catch (e) {
        console.error('einvoice-status fetch', row.id, e);
        result.failed += 1;
      }
    }
    return json(200, result);
  } catch (e) {
    console.error('einvoice-status', e);
    return json(500, { error: 'Fatura durumları sorgulanamadı' });
  }
});
