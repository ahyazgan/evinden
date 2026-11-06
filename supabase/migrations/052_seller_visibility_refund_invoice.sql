-- 052: Restoranın kendi SLA kaydı ve faturaları, tek iade karar yolu, ödeme tarihine göre mutabakat,
-- iadesi onaylanan siparişin faturası için düzeltme akışı.
--
-- İade faturası notu: Türkiye'de iade faturasını malı geri veren alıcı keser; gönderilmiş temel e-fatura ise
-- GİB e-Fatura İptal portalından iptal edilir. Platform bu yüzden satıcı adına "IADE" belgesi üretmez.
-- Gönderilmemiş fatura kendiliğinden iptal edilir; gönderilmiş fatura "düzeltme gerekiyor" diye işaretlenir
-- ve yönetici sonucu (iptal edildi / alıcının iade faturası) kaydeder.

BEGIN;

-- ── 1. Restoran kendi SLA kayıtlarını ve faturalarını görür ─────────────────

CREATE OR REPLACE FUNCTION public.seller_list_sla_violations(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, order_id uuid, violation_type text, minutes_late integer, penalty_cents integer,
  status text, note text, occurred_at timestamptz, resolved_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT v.id, v.order_id, v.violation_type, v.minutes_late, v.penalty_cents, v.status, v.note,
           v.occurred_at, v.resolved_at
      FROM public.sla_violations v
      JOIN public.sellers s ON s.id = v.seller_id
     WHERE s.user_id = auth.uid()
     ORDER BY v.occurred_at DESC
     LIMIT greatest(1, least(200, coalesce(p_limit, 100)));
END $$;
REVOKE ALL ON FUNCTION public.seller_list_sla_violations(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_sla_violations(integer) TO authenticated;

-- ── 2. Fatura düzeltme alanları ─────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS correction_status text CHECK (correction_status IS NULL OR correction_status IN ('required','resolved')),
  ADD COLUMN IF NOT EXISTS correction_outcome text CHECK (correction_outcome IS NULL OR correction_outcome IN ('cancelled','credit_note')),
  ADD COLUMN IF NOT EXISTS correction_reference text CHECK (correction_reference IS NULL OR length(correction_reference) <= 100),
  ADD COLUMN IF NOT EXISTS correction_note text CHECK (correction_note IS NULL OR length(correction_note) <= 500),
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_correction_idx ON public.invoices (correction_status) WHERE correction_status = 'required';

CREATE OR REPLACE FUNCTION public.seller_list_invoices(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, invoice_number text, order_id uuid, status text, buyer_title text,
  subtotal_cents integer, tax_cents integer, total_cents integer,
  issued_at timestamptz, accepted_at timestamptz, correction_status text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT i.id, i.invoice_number, i.order_id, i.status, coalesce(i.buyer_snapshot->>'title', 'Alıcı'),
           i.subtotal_cents, i.tax_cents, i.total_cents, i.issued_at, i.accepted_at, i.correction_status
      FROM public.invoices i
      JOIN public.sellers s ON s.id = i.seller_id
     WHERE s.user_id = auth.uid()
     ORDER BY i.created_at DESC
     LIMIT greatest(1, least(200, coalesce(p_limit, 100)));
END $$;
REVOKE ALL ON FUNCTION public.seller_list_invoices(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_list_invoices(integer) TO authenticated;

-- İadesi onaylanan veya parası iade edilen sipariş.
CREATE OR REPLACE FUNCTION public._order_refunded(p_order uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order
    AND (o.refund_status = 'approved' OR coalesce(o.payment_status, '') IN ('refund_pending','refunded')));
$$;
REVOKE ALL ON FUNCTION public._order_refunded(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_invoice_refund_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flagged integer;
BEGIN
  IF NOT ((NEW.refund_status = 'approved' AND OLD.refund_status IS DISTINCT FROM 'approved')
       OR (coalesce(NEW.payment_status, '') IN ('refund_pending','refunded')
           AND coalesce(OLD.payment_status, '') NOT IN ('refund_pending','refunded'))) THEN
    RETURN NEW;
  END IF;
  -- Henüz sağlayıcıya gitmemiş fatura iptal edilir.
  UPDATE public.invoices SET status = 'cancelled', error = 'Sipariş iade edildi; fatura gönderilmeden iptal edildi', updated_at = now()
   WHERE order_id = NEW.id AND status IN ('draft','queued');
  -- Gönderilmiş fatura için yöneticinin GİB iptali veya alıcının iade faturasını kaydetmesi gerekir.
  UPDATE public.invoices SET correction_status = 'required', updated_at = now()
   WHERE order_id = NEW.id AND status IN ('sending','submitted','accepted') AND correction_status IS NULL;
  GET DIAGNOSTICS v_flagged = ROW_COUNT;
  IF v_flagged > 0 THEN
    PERFORM public.notify_user(u.id, 'Fatura düzeltmesi gerekiyor',
      'İadesi onaylanan siparişin e-faturası gönderilmiş. İptal veya iade faturası kaydını tamamla.', 'system',
      jsonb_build_object('orderId', NEW.id)) FROM public.users u WHERE u.role = 'admin';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_invoice_refund_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_invoice_refund_sync_trg ON public.orders;
CREATE TRIGGER orders_invoice_refund_sync_trg AFTER UPDATE OF refund_status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_invoice_refund_sync();

-- Mevcut kayıtlar: iadesi yapılmış siparişin faturası da aynı kurala göre işaretlenir.
UPDATE public.invoices i SET status = 'cancelled', error = 'Sipariş iade edildi; fatura gönderilmeden iptal edildi', updated_at = now()
 WHERE i.status IN ('draft','queued') AND public._order_refunded(i.order_id);
UPDATE public.invoices i SET correction_status = 'required', updated_at = now()
 WHERE i.status IN ('sending','submitted','accepted') AND i.correction_status IS NULL AND public._order_refunded(i.order_id);

-- İadesi onaylanan siparişin faturası kuyruğa alınamaz ve gönderilemez.
CREATE OR REPLACE FUNCTION public.service_claim_invoice(p_invoice uuid)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice public.invoices;
BEGIN
  UPDATE public.invoices SET status = 'sending', error = NULL, updated_at = now()
   WHERE id = p_invoice AND status = 'queued' AND NOT public._order_refunded(order_id)
  RETURNING * INTO v_invoice;
  RETURN v_invoice;
END $$;
REVOKE ALL ON FUNCTION public.service_claim_invoice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_invoice(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_queue_invoice(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF NOT public.einvoice_enabled() THEN RAISE EXCEPTION 'E-fatura henüz açık değil' USING ERRCODE = '55000'; END IF;
  IF public._order_refunded((SELECT order_id FROM public.invoices WHERE id = p_invoice)) THEN
    RAISE EXCEPTION 'İadesi onaylanan siparişin faturası gönderilemez' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices SET status = 'queued', updated_at = now()
   WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura taslağı bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_queue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_queue_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_retry_invoice(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF public._order_refunded((SELECT order_id FROM public.invoices WHERE id = p_invoice)) THEN
    RAISE EXCEPTION 'İadesi onaylanan siparişin faturası yeniden gönderilemez' USING ERRCODE = '55000';
  END IF;
  UPDATE public.invoices
     SET status = 'queued', provider_id = NULL, error = NULL, submitted_at = NULL,
         accepted_at = NULL, updated_at = now()
   WHERE id = p_invoice AND status = 'rejected';
  IF NOT FOUND THEN RAISE EXCEPTION 'Yalnızca reddedilen fatura yeniden gönderilebilir' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_retry_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_invoice(uuid) TO authenticated;

-- Yönetici düzeltmenin sonucunu kaydeder:
--   cancelled   — fatura GİB e-Fatura İptal portalından iptal edildi (alıcı onayıyla);
--   credit_note — alıcı iade faturası kesti; numarası referans olarak yazılır.
CREATE OR REPLACE FUNCTION public.admin_resolve_invoice_correction(
  p_invoice uuid, p_outcome text, p_reference text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invoice public.invoices;
  v_reference text := nullif(left(btrim(coalesce(p_reference, '')), 100), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_outcome NOT IN ('cancelled','credit_note') THEN RAISE EXCEPTION 'Geçersiz sonuç' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_invoice.correction_status IS DISTINCT FROM 'required' THEN
    RAISE EXCEPTION 'Düzeltme bekleyen fatura bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status NOT IN ('submitted','accepted') THEN
    RAISE EXCEPTION 'Önce gönderim sonucunu netleştir' USING ERRCODE = '55000';
  END IF;
  IF p_outcome = 'credit_note' AND (v_reference IS NULL OR length(v_reference) < 3) THEN
    RAISE EXCEPTION 'İade faturasının numarasını yaz' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET
    status = CASE WHEN p_outcome = 'cancelled' THEN 'cancelled' ELSE status END,
    correction_status = 'resolved', correction_outcome = p_outcome, correction_reference = v_reference,
    correction_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    corrected_at = now(), corrected_by = auth.uid(), updated_at = now()
   WHERE id = p_invoice;
END $$;
REVOKE ALL ON FUNCTION public.admin_resolve_invoice_correction(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_invoice_correction(uuid, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_list_invoices(text);
CREATE FUNCTION public.admin_list_invoices(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, invoice_number text, order_id uuid, seller_id uuid, seller_name text, customer_id uuid,
  customer_name text, status text, subtotal_cents integer, tax_cents integer, total_cents integer,
  provider text, provider_id text, error text, issued_at timestamptz, created_at timestamptz,
  correction_status text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT i.id, i.invoice_number, i.order_id, i.seller_id, s.display_name, i.customer_id,
           coalesce(u.name, 'Müşteri'), i.status, i.subtotal_cents, i.tax_cents, i.total_cents,
           i.provider, i.provider_id, i.error, i.issued_at, i.created_at, i.correction_status
      FROM public.invoices i
      JOIN public.sellers s ON s.id = i.seller_id
      LEFT JOIN public.users u ON u.id = i.customer_id
     WHERE p_status IS NULL OR i.status = p_status
     ORDER BY i.created_at DESC LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_invoices(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_invoices(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_invoice_detail(p_invoice uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice public.invoices;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura bulunamadı' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'order_id', v_invoice.order_id,
    'status', v_invoice.status, 'buyer_snapshot', v_invoice.buyer_snapshot,
    'seller_snapshot', v_invoice.seller_snapshot, 'lines', v_invoice.lines,
    'subtotal_cents', v_invoice.subtotal_cents, 'tax_cents', v_invoice.tax_cents,
    'total_cents', v_invoice.total_cents, 'provider', v_invoice.provider,
    'provider_id', v_invoice.provider_id, 'error', v_invoice.error,
    'issued_at', v_invoice.issued_at, 'submitted_at', v_invoice.submitted_at,
    'accepted_at', v_invoice.accepted_at, 'created_at', v_invoice.created_at,
    'updated_at', v_invoice.updated_at,
    'correction_status', v_invoice.correction_status, 'correction_outcome', v_invoice.correction_outcome,
    'correction_reference', v_invoice.correction_reference, 'correction_note', v_invoice.correction_note,
    'corrected_at', v_invoice.corrected_at
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_invoice_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_invoice_detail(uuid) TO authenticated;

-- ── 3. Tek iade karar yolu ──────────────────────────────────────────────────
-- Uygulamadaki iki ekran (İadeler ve Siparişler) da admin_decide_refund_case'i kullanır; vaka kaydı (not,
-- karar veren, tutar) ve sipariş birlikte güncellenir. refund_status'a doğrudan yazan eski bir istemci olsa
-- da 048'deki eşitleme tetikleyicisi vakayı aynı bilgilerle günceller.

CREATE OR REPLACE FUNCTION public.admin_decide_refund_case(
  p_case uuid, p_decision text, p_approved_cents integer DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.refund_cases;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Geçersiz karar' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND OR v_case.status <> 'requested' THEN RAISE EXCEPTION 'İade vakası bulunamadı veya karara bağlanmış' USING ERRCODE = '22023'; END IF;
  -- Kısmi iade henüz desteklenmez: online iade ve satıcı kazancı siparişin tamamı üzerinden işler.
  IF p_decision = 'approved' AND p_approved_cents IS NOT NULL AND p_approved_cents <> v_case.requested_cents THEN
    RAISE EXCEPTION 'Kısmi iade desteklenmiyor; iade tutarın tamamı onaylanır' USING ERRCODE = '22023';
  END IF;
  UPDATE public.refund_cases SET status = p_decision,
    approved_cents = CASE WHEN p_decision = 'approved' THEN v_case.requested_cents ELSE NULL END,
    decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), decided_at = now(), decided_by = auth.uid(), updated_at = now()
   WHERE id = p_case;
  UPDATE public.orders SET refund_status = p_decision, updated_at = now() WHERE id = v_case.order_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_decide_refund_case(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_refund_case(uuid, text, integer, text) TO authenticated;

-- Sipariş ekranındaki onay/ret düğmeleri aynı vakayı karara bağlar.
CREATE OR REPLACE FUNCTION public.admin_decide_refund(p_order uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_case FROM public.refund_cases WHERE order_id = p_order;
  IF v_case IS NULL THEN RAISE EXCEPTION 'Bu sipariş için iade talebi yok' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_decide_refund_case(v_case, p_decision, NULL, p_note);
END $$;
REVOKE ALL ON FUNCTION public.admin_decide_refund(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_refund(uuid, text, text) TO authenticated;

-- ── 4. Mutabakat: para hareketinin tarihine göre ────────────────────────────
-- iyzico ve banka dökümü parayı çekildiği ve iade edildiği gün gösterir. Sipariş tarihine göre
-- hesaplanan beklenen tutar, ay sonunda verilen siparişi veya ertesi ay yapılan iadeyi yanlış döneme yazar.
--   tahsilat = dönemde ödemesi alınan online siparişler
--   iade     = dönemde parası iade edilen online siparişler (sipariş daha önceki dönemde olabilir)
--   beklenen = tahsilat − iade

CREATE OR REPLACE FUNCTION public._reconciliation_totals(p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'collected_cents', coalesce((SELECT sum(o.total_cents::bigint) FROM public.orders o JOIN public.order_payments p ON p.order_id = o.id
       WHERE o.payment_method = 'online' AND p.paid_at >= p_start AND p.paid_at < p_end), 0),
    'collected_orders', (SELECT count(*) FROM public.orders o JOIN public.order_payments p ON p.order_id = o.id
       WHERE o.payment_method = 'online' AND p.paid_at >= p_start AND p.paid_at < p_end),
    'refunded_cents', coalesce((SELECT sum(o.total_cents::bigint) FROM public.orders o JOIN public.order_payments p ON p.order_id = o.id
       WHERE o.payment_method = 'online' AND o.payment_status = 'refunded' AND p.refunded_at >= p_start AND p.refunded_at < p_end), 0),
    'refund_pending_cents', coalesce((SELECT sum(o.total_cents::bigint) FROM public.orders o JOIN public.order_payments p ON p.order_id = o.id
       WHERE o.payment_method = 'online' AND o.payment_status = 'refund_pending' AND p.paid_at < p_end), 0)
  );
$$;
REVOKE ALL ON FUNCTION public._reconciliation_totals(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_reconciliation(
  p_period_start timestamptz, p_period_end timestamptz, p_actual_cents integer,
  p_source text DEFAULT 'iyzico', p_reference text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS public.reconciliation_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_totals jsonb;
  v_expected integer;
  v_run public.reconciliation_runs;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_period_end <= p_period_start OR p_actual_cents < 0 THEN RAISE EXCEPTION 'Geçersiz mutabakat dönemi' USING ERRCODE = '22023'; END IF;
  IF p_source NOT IN ('iyzico','bank') THEN RAISE EXCEPTION 'Geçersiz kaynak' USING ERRCODE = '22023'; END IF;
  v_totals := public._reconciliation_totals(p_period_start, p_period_end);
  v_expected := ((v_totals->>'collected_cents')::bigint - (v_totals->>'refunded_cents')::bigint)::integer;
  INSERT INTO public.reconciliation_runs (period_start, period_end, source, reference, expected_cents, actual_cents,
    difference_cents, status, details, note)
  VALUES (p_period_start, p_period_end, p_source, nullif(left(btrim(coalesce(p_reference, '')), 200), ''), v_expected, p_actual_cents,
    p_actual_cents - v_expected, CASE WHEN p_actual_cents = v_expected THEN 'matched' ELSE 'difference' END,
    v_totals || jsonb_build_object('basis', 'payment_date'), nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  RETURNING * INTO v_run;
  RETURN v_run;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_reconciliation(timestamptz, timestamptz, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_reconciliation(timestamptz, timestamptz, integer, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reconciliation_breakdown(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.reconciliation_runs;
  v_totals jsonb;
  v_items jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_run FROM public.reconciliation_runs WHERE id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mutabakat bulunamadı' USING ERRCODE = 'P0002'; END IF;
  v_totals := public._reconciliation_totals(v_run.period_start, v_run.period_end);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', oi.title_snapshot, 'quantity', oi.quantity, 'line_total_cents', oi.line_total_cents
  ) ORDER BY oi.id), '[]'::jsonb) INTO v_items
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.order_payments p ON p.order_id = o.id
   WHERE o.payment_method = 'online' AND p.paid_at >= v_run.period_start AND p.paid_at < v_run.period_end;

  RETURN jsonb_build_object(
    'expected_cents', v_run.expected_cents, 'actual_cents', v_run.actual_cents,
    'difference_cents', v_run.difference_cents,
    'gross_sales_cents', (v_totals->>'collected_cents')::bigint,
    'refunds_cents', (v_totals->>'refunded_cents')::bigint,
    'refund_pending_cents', (v_totals->>'refund_pending_cents')::bigint,
    'online_orders', (v_totals->>'collected_orders')::integer,
    'door_orders', 0,
    'net_cents', (v_totals->>'collected_cents')::bigint - (v_totals->>'refunded_cents')::bigint,
    'basis', 'payment_date',
    'items', v_items
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_reconciliation_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconciliation_breakdown(uuid) TO authenticated;

-- ── 5. Operasyon özeti: düzeltme bekleyen ve yanıt bekleyen faturalar ──────

CREATE OR REPLACE FUNCTION public.admin_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'invoice_candidates', (SELECT count(*)::integer FROM public.orders o
       WHERE o.status = 'delivered'
         AND coalesce(o.refund_status, 'none') NOT IN ('requested','approved')
         AND coalesce(o.payment_status, '') NOT IN ('refund_pending','refunded')
         AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)),
    'invoice_drafts', (SELECT count(*)::integer FROM public.invoices WHERE status IN ('draft','queued')),
    'invoice_submitted', (SELECT count(*)::integer FROM public.invoices WHERE status IN ('sending','submitted')),
    'invoice_rejected', (SELECT count(*)::integer FROM public.invoices WHERE status = 'rejected'),
    'invoice_corrections', (SELECT count(*)::integer FROM public.invoices WHERE correction_status = 'required'),
    -- 24 saattir sağlayıcıdan sonuç gelmeyen fatura: durum sorgusu çalıştırılmalı.
    'invoice_stale', (SELECT count(*)::integer FROM public.invoices
       WHERE status = 'submitted' AND submitted_at < now() - interval '24 hours'),
    'sla_open', (SELECT count(*)::integer FROM public.sla_violations WHERE status = 'open'),
    'refunds_requested', (SELECT count(*)::integer FROM public.refund_cases WHERE status = 'requested'),
    'refunds_approved', (SELECT count(*)::integer FROM public.refund_cases WHERE status = 'approved'),
    'reconciliation_differences', (SELECT count(*)::integer FROM public.reconciliation_runs WHERE status = 'difference')
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_operations_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_overview() TO authenticated;

COMMIT;
