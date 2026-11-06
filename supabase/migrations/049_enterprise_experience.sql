-- 049: Kurumsal yönetim deneyimi — operasyon özeti, fatura detayı, toplu kesim ve mutabakat kırılımı.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_candidates integer;
  v_sla_open integer;
  v_refunds_requested integer;
  v_refunds_approved integer;
  v_reconciliation_differences integer;
  v_invoice_drafts integer;
  v_invoice_submitted integer;
  v_invoice_rejected integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer INTO v_candidates FROM public.orders o
   WHERE o.status = 'delivered'
     AND coalesce(o.refund_status, 'none') NOT IN ('requested','approved')
     AND coalesce(o.payment_status, '') NOT IN ('refund_pending','refunded')
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id);
  SELECT count(*)::integer INTO v_sla_open FROM public.sla_violations WHERE status = 'open';
  SELECT count(*)::integer INTO v_refunds_requested FROM public.refund_cases WHERE status = 'requested';
  SELECT count(*)::integer INTO v_refunds_approved FROM public.refund_cases WHERE status = 'approved';
  SELECT count(*)::integer INTO v_reconciliation_differences FROM public.reconciliation_runs WHERE status = 'difference';
  SELECT count(*)::integer INTO v_invoice_drafts FROM public.invoices WHERE status IN ('draft','queued');
  SELECT count(*)::integer INTO v_invoice_submitted FROM public.invoices WHERE status IN ('sending','submitted');
  SELECT count(*)::integer INTO v_invoice_rejected FROM public.invoices WHERE status = 'rejected';
  RETURN jsonb_build_object(
    'invoice_candidates', v_candidates, 'invoice_drafts', v_invoice_drafts,
    'invoice_submitted', v_invoice_submitted, 'invoice_rejected', v_invoice_rejected,
    'sla_open', v_sla_open, 'refunds_requested', v_refunds_requested,
    'refunds_approved', v_refunds_approved, 'reconciliation_differences', v_reconciliation_differences
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_operations_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_overview() TO authenticated;

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
    'updated_at', v_invoice.updated_at
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_invoice_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_invoice_detail(uuid) TO authenticated;


-- Karar raporunun önceki dönemle aynı tanımlarla karşılaştırılması.
CREATE OR REPLACE FUNCTION public.admin_decision_comparison(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_now timestamptz := now();
  v_current_from timestamptz := v_now - make_interval(days => v_days);
  v_previous_from timestamptz := v_now - make_interval(days => v_days * 2);
  v_period jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  v_period := jsonb_build_object(
    'current', (SELECT jsonb_build_object(
      'orders', count(*)::integer,
      'delivered', count(*) FILTER (WHERE status = 'delivered')::integer,
      'cancelled', count(*) FILTER (WHERE status = 'cancelled')::integer,
      'revenue_cents', coalesce(sum(total_cents) FILTER (WHERE status = 'delivered'), 0)::integer,
      'refunds', count(*) FILTER (WHERE refund_status IN ('requested','approved'))::integer,
      'success_rate', round(100.0 * count(*) FILTER (WHERE status = 'delivered') / nullif(count(*) FILTER (WHERE status IN ('delivered','cancelled')), 0), 1)
    ) FROM public.orders WHERE created_at >= v_current_from),
    'previous', (SELECT jsonb_build_object(
      'orders', count(*)::integer,
      'delivered', count(*) FILTER (WHERE status = 'delivered')::integer,
      'cancelled', count(*) FILTER (WHERE status = 'cancelled')::integer,
      'revenue_cents', coalesce(sum(total_cents) FILTER (WHERE status = 'delivered'), 0)::integer,
      'refunds', count(*) FILTER (WHERE refund_status IN ('requested','approved'))::integer,
      'success_rate', round(100.0 * count(*) FILTER (WHERE status = 'delivered') / nullif(count(*) FILTER (WHERE status IN ('delivered','cancelled')), 0), 1)
    ) FROM public.orders WHERE created_at >= v_previous_from AND created_at < v_current_from)
  );
  RETURN jsonb_build_object('days', v_days, 'current', v_period->'current', 'previous', v_period->'previous');
END $$;
REVOKE ALL ON FUNCTION public.admin_decision_comparison(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decision_comparison(integer) TO authenticated;

-- Toplu kesim yalnızca kayıtlı kurumsal profilleri kullanır; istemci fatura verisi gönderemez.
CREATE OR REPLACE FUNCTION public.admin_create_invoices(p_orders uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id uuid;
  v_profile public.corporate_billing_profiles;
  v_created integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_orders IS NULL OR cardinality(p_orders) = 0 THEN
    RAISE EXCEPTION 'En az bir sipariş seçilmelidir' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_orders) > 100 THEN
    RAISE EXCEPTION 'Tek seferde en fazla 100 fatura oluşturulabilir' USING ERRCODE = '22023';
  END IF;
  FOREACH v_order_id IN ARRAY p_orders LOOP
    BEGIN
      SELECT p.* INTO v_profile FROM public.corporate_billing_profiles p
        JOIN public.orders o ON o.customer_id = p.user_id WHERE o.id = v_order_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Fatura profili eksik'; END IF;
      PERFORM public.admin_create_invoice(v_order_id, jsonb_build_object(
        'title', v_profile.legal_title, 'taxNumber', v_profile.tax_number,
        'taxOffice', v_profile.tax_office, 'address', v_profile.address, 'email', v_profile.email
      ));
      -- Toplu işlem yalnızca taslak üretir; gönderim yönetici onayından sonra yapılır.
      UPDATE public.invoices SET status = 'draft', updated_at = now()
       WHERE order_id = v_order_id AND status = 'queued';
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id, 'message', left(SQLERRM, 300)
      ));
    END;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_errors);
END $$;
REVOKE ALL ON FUNCTION public.admin_create_invoices(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_invoices(uuid[]) TO authenticated;


-- Sipariş toplamları ve satırlar ayrı alt sorgularda toplanır; çok kalemli sipariş
-- beklenen tutarı birden fazla saymaz.
CREATE OR REPLACE FUNCTION public.admin_reconciliation_breakdown(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.reconciliation_runs;
  v_orders jsonb;
  v_items jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_run FROM public.reconciliation_runs WHERE id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mutabakat bulunamadı' USING ERRCODE = 'P0002'; END IF;

  -- Brüt: dönemde çekilen tüm online tutar. İade: iadesi tamamlanan tutar. Net = brüt − iade = beklenen tutar (046).
  SELECT jsonb_build_object(
    'gross_sales_cents', coalesce(sum(o.total_cents::bigint), 0)::integer,
    'refunds_cents', coalesce(sum(o.total_cents::bigint) FILTER (WHERE o.payment_status = 'refunded'), 0)::integer,
    'refund_pending_cents', coalesce(sum(o.total_cents::bigint) FILTER (WHERE o.payment_status = 'refund_pending'), 0)::integer,
    'online_orders', count(*)::integer,
    'door_orders', 0,
    'net_cents', coalesce(sum(o.total_cents::bigint) FILTER (WHERE o.payment_status IN ('paid','refund_pending')), 0)::integer
  ) INTO v_orders
    FROM public.orders o
   WHERE o.payment_method = 'online'
     AND o.payment_status IN ('paid','refund_pending','refunded')
     AND o.created_at >= v_run.period_start AND o.created_at < v_run.period_end;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', oi.title_snapshot, 'quantity', oi.quantity, 'line_total_cents', oi.line_total_cents
  ) ORDER BY oi.id), '[]'::jsonb) INTO v_items
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
   WHERE o.payment_method = 'online'
     AND o.payment_status IN ('paid','refund_pending','refunded')
     AND o.created_at >= v_run.period_start AND o.created_at < v_run.period_end;

  RETURN jsonb_build_object(
    'expected_cents', v_run.expected_cents, 'actual_cents', v_run.actual_cents,
    'difference_cents', v_run.difference_cents,
    'gross_sales_cents', coalesce(v_orders->>'gross_sales_cents', '0')::integer,
    'refunds_cents', coalesce(v_orders->>'refunds_cents', '0')::integer,
    'refund_pending_cents', coalesce(v_orders->>'refund_pending_cents', '0')::integer,
    'online_orders', coalesce(v_orders->>'online_orders', '0')::integer,
    'door_orders', coalesce(v_orders->>'door_orders', '0')::integer,
    'net_cents', coalesce(v_orders->>'net_cents', '0')::integer,
    'items', v_items
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_reconciliation_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconciliation_breakdown(uuid) TO authenticated;

-- Reddedilen fatura, yönetici onayıyla yeniden gönderim kuyruğuna alınabilir.
CREATE OR REPLACE FUNCTION public.admin_retry_invoice(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  UPDATE public.invoices
     SET status = 'queued', provider_id = NULL, error = NULL, submitted_at = NULL,
         accepted_at = NULL, updated_at = now()
   WHERE id = p_invoice AND status = 'rejected';
  IF NOT FOUND THEN RAISE EXCEPTION 'Yalnızca reddedilen fatura yeniden gönderilebilir' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_retry_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_invoice(uuid) TO authenticated;

-- Gönderim sonucu belirsiz kalan fatura (zaman aşımı, ağ hatası) kendiliğinden yeniden gönderilmez.
-- Yönetici sağlayıcı panelinde faturanın ulaşmadığını gördükten sonra kuyruğa geri alır.
CREATE OR REPLACE FUNCTION public.admin_release_invoice(p_invoice uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_note, ''))) < 5 THEN RAISE EXCEPTION 'Kısa bir açıklama yaz' USING ERRCODE = '22023'; END IF;
  UPDATE public.invoices SET status = 'queued', error = left('Yönetici kuyruğa aldı: ' || btrim(p_note), 1000), updated_at = now()
   WHERE id = p_invoice AND status = 'sending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Gönderimde bekleyen fatura bulunamadı' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_release_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_invoice(uuid, text) TO authenticated;

COMMIT;
