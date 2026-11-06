-- 047: Karar destek raporları ve SLA yönetim API'si.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_decision_report(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_from timestamptz := now() - make_interval(days => v_days);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'days', v_days,
    'daily', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.day), '[]'::jsonb) FROM (
        SELECT (o.created_at AT TIME ZONE 'Europe/Istanbul')::date AS day,
          count(*)::integer AS orders,
          count(*) FILTER (WHERE o.status = 'delivered')::integer AS delivered,
          count(*) FILTER (WHERE o.status = 'cancelled')::integer AS cancelled,
          coalesce(sum(o.total_cents) FILTER (WHERE o.status = 'delivered'), 0)::integer AS revenue_cents,
          count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer AS refunds,
          round(100.0 * count(*) FILTER (WHERE o.status = 'delivered') /
            nullif(count(*) FILTER (WHERE o.status IN ('delivered','cancelled')), 0), 1) AS success_rate
        FROM public.orders o WHERE o.created_at >= v_from
        GROUP BY 1
      ) x
    ),
    'weekly', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.week_start), '[]'::jsonb) FROM (
        SELECT date_trunc('week', o.created_at AT TIME ZONE 'Europe/Istanbul')::date AS week_start,
          count(*)::integer AS orders,
          count(*) FILTER (WHERE o.status = 'delivered')::integer AS delivered,
          coalesce(sum(o.total_cents) FILTER (WHERE o.status = 'delivered'), 0)::integer AS revenue_cents,
          count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer AS refunds,
          round(100.0 * count(*) FILTER (WHERE o.status = 'delivered') /
            nullif(count(*) FILTER (WHERE o.status IN ('delivered','cancelled')), 0), 1) AS success_rate
        FROM public.orders o WHERE o.created_at >= v_from
        GROUP BY 1
      ) x
    ),
    'sellers', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.revenue_cents DESC), '[]'::jsonb) FROM (
        SELECT s.id, s.display_name, count(o.id)::integer AS orders,
          count(o.id) FILTER (WHERE o.status = 'delivered')::integer AS delivered,
          coalesce(sum(o.total_cents) FILTER (WHERE o.status = 'delivered'), 0)::integer AS revenue_cents,
          round(avg(extract(epoch FROM (o.delivered_at - o.created_at)) / 60) FILTER (WHERE o.delivered_at IS NOT NULL), 1) AS avg_delivery_minutes,
          round(100.0 * count(o.id) FILTER (WHERE o.status = 'cancelled') / nullif(count(o.id), 0), 1) AS cancel_rate,
          round(100.0 * count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved')) / nullif(count(o.id), 0), 1) AS refund_rate
        FROM public.sellers s LEFT JOIN public.orders o ON o.seller_id = s.id AND o.created_at >= v_from
        GROUP BY s.id, s.display_name
        HAVING count(o.id) > 0
      ) x
    ),
    'customers', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.spend_cents DESC), '[]'::jsonb) FROM (
        SELECT u.id, coalesce(u.name, 'Müşteri') AS name, count(o.id)::integer AS orders,
          coalesce(sum(o.total_cents) FILTER (WHERE o.status = 'delivered'), 0)::integer AS spend_cents,
          max(o.created_at) AS last_order_at,
          round(avg(extract(epoch FROM (o.delivered_at - o.created_at)) / 60) FILTER (WHERE o.delivered_at IS NOT NULL), 1) AS avg_delivery_minutes,
          count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer AS refunds,
          CASE WHEN count(o.id) = 1 THEN 'new' WHEN max(o.created_at) < now() - interval '30 days' THEN 'at_risk' ELSE 'repeat' END AS segment
        FROM public.orders o JOIN public.users u ON u.id = o.customer_id
        WHERE o.created_at >= v_from AND u.role = 'buyer'
        GROUP BY u.id, u.name
      ) x
    ),
    'summary', (
      SELECT jsonb_build_object('orders', count(*)::integer,
        'delivered', count(*) FILTER (WHERE status = 'delivered')::integer,
        'cancelled', count(*) FILTER (WHERE status = 'cancelled')::integer,
        'revenue_cents', coalesce(sum(total_cents) FILTER (WHERE status = 'delivered'), 0)::integer,
        'refunds', count(*) FILTER (WHERE refund_status IN ('requested','approved'))::integer,
        'success_rate', round(100.0 * count(*) FILTER (WHERE status = 'delivered') /
          nullif(count(*) FILTER (WHERE status IN ('delivered','cancelled')), 0), 1))
      FROM public.orders WHERE created_at >= v_from
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_decision_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decision_report(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_sla_violations(p_status text DEFAULT 'open')
RETURNS TABLE (
  id uuid, order_id uuid, seller_id uuid, seller_name text, violation_type text,
  minutes_late integer, penalty_cents integer, status text, note text, occurred_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT v.id, v.order_id, v.seller_id, s.display_name, v.violation_type, v.minutes_late,
           v.penalty_cents, v.status, v.note, v.occurred_at
      FROM public.sla_violations v JOIN public.sellers s ON s.id = v.seller_id
     WHERE p_status IS NULL OR v.status = p_status
     ORDER BY v.occurred_at DESC LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_sla_violations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_sla_violations(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_sla_policy(p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_value jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  -- Yalnızca bilinen anahtarlar kabul edilir; bozuk değer zamanlanmış görevi durdurmasın.
  v_value := public.sla_policy() || coalesce(p_policy, '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_value) k
              WHERE k NOT IN ('enabled','reminder_minutes','cancel_minutes','preparation_cancel_minutes','action','penalty_cents'))
     OR jsonb_typeof(v_value->'enabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_value->'reminder_minutes') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value->'cancel_minutes') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value->'preparation_cancel_minutes') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value->'penalty_cents') IS DISTINCT FROM 'number'
     OR v_value->>'action' IS NULL OR v_value->>'action' NOT IN ('cancel','penalty') THEN
    RAISE EXCEPTION 'Geçersiz SLA kuralı' USING ERRCODE = '22023';
  END IF;
  IF (v_value->>'reminder_minutes') !~ '^[0-9]+$' OR (v_value->>'cancel_minutes') !~ '^[0-9]+$'
     OR (v_value->>'preparation_cancel_minutes') !~ '^[0-9]+$' OR (v_value->>'penalty_cents') !~ '^[0-9]+$'
     OR (v_value->>'reminder_minutes')::integer < 1 OR (v_value->>'reminder_minutes')::integer > 240
     OR (v_value->>'cancel_minutes')::integer <= (v_value->>'reminder_minutes')::integer
     OR (v_value->>'cancel_minutes')::integer > 720
     OR (v_value->>'preparation_cancel_minutes')::integer < 30
     OR (v_value->>'preparation_cancel_minutes')::integer > 1440
     OR (v_value->>'penalty_cents')::integer > 100000 THEN
    RAISE EXCEPTION 'Geçersiz SLA kuralı' USING ERRCODE = '22023';
  END IF;
  -- Restoran 60 dakikaya kadar hazırlık süresi seçebilir; iptal eşiği bunun altına inemez.
  IF v_value->>'action' = 'cancel' AND (v_value->>'preparation_cancel_minutes')::integer < 90 THEN
    RAISE EXCEPTION 'Otomatik iptal için hazırlama süresi en az 90 dakika olmalı' USING ERRCODE = '22023';
  END IF;
  UPDATE public.app_config SET value = v_value, updated_at = now() WHERE key = 'sla_policy';
  RETURN v_value;
END $$;
REVOKE ALL ON FUNCTION public.admin_update_sla_policy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_sla_policy(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_sla_violation(p_violation uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('waived','collected') THEN RAISE EXCEPTION 'Geçersiz SLA durumu' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_violations SET status = p_status, note = left(coalesce(p_note, ''), 500),
    resolved_at = now(), resolved_by = auth.uid()
   WHERE id = p_violation AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'SLA ihlali bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_resolve_sla_violation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_sla_violation(uuid, text, text) TO authenticated;

-- E-fatura gönderimi iki adımlıdır. Edge Function önce faturayı "sending" durumuna alır (yalnızca kuyruktaki
-- fatura alınabilir); aynı faturayı ikinci bir istek alamaz, böylece sağlayıcıya iki kez gitmez.
CREATE OR REPLACE FUNCTION public.service_claim_invoice(p_invoice uuid)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice public.invoices;
BEGIN
  UPDATE public.invoices SET status = 'sending', error = NULL, updated_at = now()
   WHERE id = p_invoice AND status = 'queued'
  RETURNING * INTO v_invoice;
  RETURN v_invoice;
END $$;
REVOKE ALL ON FUNCTION public.service_claim_invoice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_invoice(uuid) TO service_role;

-- Sağlayıcı sonucu yalnızca gönderimdeki faturaya yazılır. "queued" sonucu, sağlayıcının isteği açıkça
-- reddettiği (gönderilmediği kesin) durumlar içindir; sonucu belirsiz istekte fatura "sending" kalır.
CREATE OR REPLACE FUNCTION public.service_set_invoice_status(
  p_invoice uuid, p_status text, p_provider_id text DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('queued','sending','submitted','accepted','rejected') THEN
    RAISE EXCEPTION 'Geçersiz fatura durumu' USING ERRCODE = '22023';
  END IF;
  UPDATE public.invoices SET status = p_status,
    provider_id = coalesce(nullif(left(btrim(coalesce(p_provider_id, '')), 300), ''), provider_id),
    error = nullif(left(coalesce(p_error, ''), 1000), ''),
    submitted_at = CASE WHEN p_status IN ('submitted','accepted') THEN coalesce(submitted_at, now()) ELSE submitted_at END,
    accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END, updated_at = now()
   WHERE id = p_invoice
     AND (status = 'sending' OR (status = 'submitted' AND p_status IN ('accepted','rejected')));
  IF NOT FOUND THEN RAISE EXCEPTION 'Gönderimde olan fatura bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.service_set_invoice_status(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_set_invoice_status(uuid, text, text, text) TO service_role;

COMMIT;
