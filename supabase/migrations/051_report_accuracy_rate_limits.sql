-- 051: Rapor doğruluğu ve bildirim spamına karşı sınırlar.
--
-- 1. Karar raporları: ciro artık yalnızca teslim edilmiş ve iadesi onaylanmamış/yapılmamış siparişlerin
--    satış tutarıdır (toplam − bahşiş). Bahşiş restoranın satışı değildir; iade edilen sipariş ciro değildir.
-- 2. Birim ekonomi ve kampanya raporları: online ödeme komisyonu yalnızca online siparişe, kurye maliyeti
--    yalnızca platform kuryesine yazılır; yalnızca platformun karşıladığı indirim düşülür; iptal ve iade
--    edilen siparişler sayılmaz.
-- 3. Destek yanıtı ve kurumsal çalışma alanı talebi sınırlandı; yöneticiler her mesajda bildirime boğulmaz.

BEGIN;

-- ── 0. Ortak tanım ─────────────────────────────────────────────────────────

-- Raporlarda "gerçekleşen satış": teslim edilmiş, iadesi onaylanmamış ve parası iade edilmemiş sipariş.
CREATE OR REPLACE FUNCTION public.order_is_realized_sale(p_order public.orders)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_order.status = 'delivered'
     AND coalesce(p_order.refund_status, 'none') <> 'approved'
     AND coalesce(p_order.payment_status, '') NOT IN ('refund_pending','refunded');
$$;
REVOKE ALL ON FUNCTION public.order_is_realized_sale(public.orders) FROM PUBLIC, anon, authenticated;

-- Satış tutarı: müşterinin ödediği toplamdan bahşiş çıkarılır.
CREATE OR REPLACE FUNCTION public.order_sale_cents(p_order public.orders)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN public.order_is_realized_sale(p_order)
              THEN greatest(p_order.total_cents - coalesce(p_order.tip_cents, 0), 0)::bigint ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.order_sale_cents(public.orders) FROM PUBLIC, anon, authenticated;

-- ── 1. Karar raporları ─────────────────────────────────────────────────────

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
          coalesce(sum(public.order_sale_cents(o)), 0)::bigint AS revenue_cents,
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
          coalesce(sum(public.order_sale_cents(o)), 0)::bigint AS revenue_cents,
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
          coalesce(sum(public.order_sale_cents(o)), 0)::bigint AS revenue_cents,
          round(avg(extract(epoch FROM (o.delivered_at - o.created_at)) / 60) FILTER (WHERE o.delivered_at IS NOT NULL), 1) AS avg_delivery_minutes,
          round(100.0 * count(o.id) FILTER (WHERE o.status = 'cancelled') / nullif(count(o.id), 0), 1) AS cancel_rate,
          round(100.0 * count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved')) / nullif(count(o.id), 0), 1) AS refund_rate
        FROM public.sellers s LEFT JOIN public.orders o ON o.seller_id = s.id AND o.created_at >= v_from
        GROUP BY s.id, s.display_name
        HAVING count(o.id) > 0
      ) x
    ),
    -- Müşteri listesi en çok harcayan 200 kişiyle sınırlıdır; tüm müşteriler tek yanıtta dönmez.
    'customers', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.spend_cents DESC), '[]'::jsonb) FROM (
        SELECT u.id, coalesce(u.name, 'Müşteri') AS name, count(o.id)::integer AS orders,
          coalesce(sum(public.order_sale_cents(o)), 0)::bigint AS spend_cents,
          max(o.created_at) AS last_order_at,
          round(avg(extract(epoch FROM (o.delivered_at - o.created_at)) / 60) FILTER (WHERE o.delivered_at IS NOT NULL), 1) AS avg_delivery_minutes,
          count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer AS refunds,
          CASE WHEN count(o.id) = 1 THEN 'new' WHEN max(o.created_at) < now() - interval '30 days' THEN 'at_risk' ELSE 'repeat' END AS segment
        FROM public.orders o JOIN public.users u ON u.id = o.customer_id
        WHERE o.created_at >= v_from AND u.role = 'buyer'
        GROUP BY u.id, u.name
        ORDER BY spend_cents DESC
        LIMIT 200
      ) x
    ),
    'summary', (
      SELECT jsonb_build_object('orders', count(*)::integer,
        'delivered', count(*) FILTER (WHERE o.status = 'delivered')::integer,
        'cancelled', count(*) FILTER (WHERE o.status = 'cancelled')::integer,
        'revenue_cents', coalesce(sum(public.order_sale_cents(o)), 0)::bigint,
        'refunds', count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer,
        'success_rate', round(100.0 * count(*) FILTER (WHERE o.status = 'delivered') /
          nullif(count(*) FILTER (WHERE o.status IN ('delivered','cancelled')), 0), 1))
      FROM public.orders o WHERE o.created_at >= v_from
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_decision_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decision_report(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_decision_comparison(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_now timestamptz := now();
  v_current_from timestamptz := v_now - make_interval(days => v_days);
  v_previous_from timestamptz := v_now - make_interval(days => v_days * 2);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('days', v_days,
    'current', (SELECT jsonb_build_object(
      'orders', count(*)::integer,
      'delivered', count(*) FILTER (WHERE o.status = 'delivered')::integer,
      'cancelled', count(*) FILTER (WHERE o.status = 'cancelled')::integer,
      'revenue_cents', coalesce(sum(public.order_sale_cents(o)), 0)::bigint,
      'refunds', count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer,
      'success_rate', round(100.0 * count(*) FILTER (WHERE o.status = 'delivered') / nullif(count(*) FILTER (WHERE o.status IN ('delivered','cancelled')), 0), 1)
    ) FROM public.orders o WHERE o.created_at >= v_current_from),
    'previous', (SELECT jsonb_build_object(
      'orders', count(*)::integer,
      'delivered', count(*) FILTER (WHERE o.status = 'delivered')::integer,
      'cancelled', count(*) FILTER (WHERE o.status = 'cancelled')::integer,
      'revenue_cents', coalesce(sum(public.order_sale_cents(o)), 0)::bigint,
      'refunds', count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer,
      'success_rate', round(100.0 * count(*) FILTER (WHERE o.status = 'delivered') / nullif(count(*) FILTER (WHERE o.status IN ('delivered','cancelled')), 0), 1)
    ) FROM public.orders o WHERE o.created_at >= v_previous_from AND o.created_at < v_current_from));
END $$;
REVOKE ALL ON FUNCTION public.admin_decision_comparison(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decision_comparison(integer) TO authenticated;

-- ── 2. Birim ekonomi ve kampanya raporları ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_unit_economics(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_econ jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'unit_economics'), '{}'::jsonb);
  v_orders integer; v_gross bigint; v_commission bigint; v_discount bigint; v_online bigint;
  v_platform_courier integer; v_refunds integer;
  v_delivery_cost bigint; v_support_cost bigint; v_acquisition bigint; v_payment_fee bigint; v_contribution bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*) FILTER (WHERE public.order_is_realized_sale(o))::integer,
    coalesce(sum(o.subtotal_cents) FILTER (WHERE public.order_is_realized_sale(o)), 0),
    coalesce(sum(o.commission_cents) FILTER (WHERE public.order_is_realized_sale(o)), 0),
    -- Yalnızca platformun karşıladığı indirim (satıcı indirimi restoranın kendi maliyetidir).
    coalesce(sum(greatest(o.discount_cents - coalesce(o.seller_discount_cents, 0), 0)) FILTER (WHERE public.order_is_realized_sale(o)), 0),
    coalesce(sum(o.total_cents) FILTER (WHERE public.order_is_realized_sale(o) AND o.payment_method = 'online'), 0),
    count(*) FILTER (WHERE public.order_is_realized_sale(o) AND coalesce(o.delivery_mode, 'seller_courier') <> 'seller_courier')::integer,
    count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer
    INTO v_orders, v_gross, v_commission, v_discount, v_online, v_platform_courier, v_refunds
    FROM public.orders o WHERE o.created_at >= v_from;
  v_delivery_cost := v_platform_courier::bigint * public.sla_policy_int(v_econ, 'delivery_cost_cents', 0);
  v_support_cost := v_orders::bigint * public.sla_policy_int(v_econ, 'support_cost_cents', 0);
  v_acquisition := v_orders::bigint * public.sla_policy_int(v_econ, 'acquisition_cost_cents', 0);
  v_payment_fee := round(v_online * public.sla_policy_int(v_econ, 'payment_fee_bps', 0) / 10000.0)::bigint;
  v_contribution := v_commission - v_discount - v_delivery_cost - v_support_cost - v_acquisition - v_payment_fee;
  RETURN jsonb_build_object(
    'days', v_days, 'orders', v_orders, 'gross_cents', v_gross, 'commission_cents', v_commission,
    'discount_cents', v_discount, 'refunds', v_refunds, 'delivery_cost_cents', v_delivery_cost,
    'support_cost_cents', v_support_cost, 'acquisition_cost_cents', v_acquisition, 'payment_fee_cents', v_payment_fee,
    'contribution_cents', v_contribution,
    'contribution_per_order_cents', CASE WHEN v_orders = 0 THEN 0 ELSE round(v_contribution::numeric / v_orders)::bigint END,
    'margin_bps', CASE WHEN v_gross = 0 THEN 0 ELSE round(10000.0 * v_contribution / v_gross)::integer END
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_unit_economics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unit_economics(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_campaign_performance(p_days integer DEFAULT 30)
RETURNS TABLE (
  coupon_id uuid, code text, title text, seller_id uuid, seller_name text,
  redemptions integer, gross_cents integer, discount_cents integer, refunds integer,
  commission_cents integer, delivery_cost_cents integer, support_cost_cents integer,
  contribution_cents integer, margin_bps integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_econ jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'unit_economics'), '{}'::jsonb);
  v_delivery integer;
  v_support integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  v_delivery := public.sla_policy_int(v_econ, 'delivery_cost_cents', 0);
  v_support := public.sla_policy_int(v_econ, 'support_cost_cents', 0);
  RETURN QUERY
  WITH used AS (
    -- Yalnızca gerçekleşen satışlar kampanya kullanımı sayılır; iptal ve iade edilenler dışarıda kalır.
    SELECT c.id AS coupon_id, c.code, coalesce(c.title, c.code) AS title, c.seller_id, s.display_name AS seller_name,
      count(o.id) AS redemptions,
      coalesce(sum(o.subtotal_cents), 0) AS gross,
      coalesce(sum(greatest(o.discount_cents - coalesce(o.seller_discount_cents, 0), 0)), 0) AS platform_discount,
      coalesce(sum(o.discount_cents), 0) AS discount,
      coalesce(sum(o.commission_cents), 0) AS commission,
      count(o.id) FILTER (WHERE coalesce(o.delivery_mode, 'seller_courier') <> 'seller_courier') AS platform_courier
    FROM public.coupons c
    LEFT JOIN public.orders o ON o.coupon_code = c.code AND o.created_at >= v_from AND public.order_is_realized_sale(o)
    LEFT JOIN public.sellers s ON s.id = c.seller_id
    WHERE c.created_at >= v_from - interval '30 days' OR o.id IS NOT NULL
    GROUP BY c.id, c.code, c.title, c.seller_id, s.display_name
  ), refunded AS (
    SELECT o.coupon_code, count(*) AS n FROM public.orders o
     WHERE o.created_at >= v_from AND o.coupon_code IS NOT NULL AND o.refund_status IN ('requested','approved')
     GROUP BY o.coupon_code
  )
  SELECT u.coupon_id, u.code, u.title, u.seller_id, u.seller_name,
    u.redemptions::integer, u.gross::integer, u.discount::integer, coalesce(r.n, 0)::integer, u.commission::integer,
    (u.platform_courier * v_delivery)::integer, (u.redemptions * v_support)::integer,
    (u.commission - u.platform_discount - u.platform_courier * v_delivery - u.redemptions * v_support)::integer,
    CASE WHEN u.gross = 0 THEN 0 ELSE
      round(10000.0 * (u.commission - u.platform_discount - u.platform_courier * v_delivery - u.redemptions * v_support) / u.gross)::integer END
  FROM used u LEFT JOIN refunded r ON r.coupon_code = u.code
  ORDER BY 13 DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_campaign_performance(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_campaign_performance(integer) TO authenticated;

-- ── 3. Spam sınırları ──────────────────────────────────────────────────────

-- Müşteri bir talebe saatte en fazla 10 mesaj yazabilir. Yöneticiye bildirim, talepte son 10 dakikada
-- başka müşteri mesajı yoksa gider; art arda yazılan mesajlar tek bildirimle haber verilir.
CREATE OR REPLACE FUNCTION public.reply_support_ticket(p_ticket uuid, p_message text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.support_tickets;
  v_body text := left(btrim(coalesce(p_message, '')), 3000);
  v_recent boolean;
BEGIN
  SELECT * INTO v_row FROM public.support_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND OR v_row.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Talep bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'closed' THEN RAISE EXCEPTION 'Kapalı talep yanıtlanamaz' USING ERRCODE = '22023'; END IF;
  IF v_body = '' THEN RAISE EXCEPTION 'Mesaj boş olamaz' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.support_ticket_messages m
       WHERE m.ticket_id = v_row.id AND m.author_role = 'customer' AND m.created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Çok fazla mesaj gönderdin, biraz sonra tekrar dene' USING ERRCODE = '55000';
  END IF;
  v_recent := EXISTS (SELECT 1 FROM public.support_ticket_messages m
    WHERE m.ticket_id = v_row.id AND m.author_role = 'customer' AND m.created_at > now() - interval '10 minutes');
  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body)
  VALUES (v_row.id, auth.uid(), 'customer', v_body);
  UPDATE public.support_tickets SET status = 'open' WHERE id = v_row.id RETURNING * INTO v_row;
  IF NOT v_recent THEN
    PERFORM public.notify_user(u.id, 'Destek talebine yeni mesaj', left(v_body, 80), 'support',
                               jsonb_build_object('ticketId', v_row.id)) FROM public.users u WHERE u.role = 'admin';
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.reply_support_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(uuid, text) TO authenticated;

-- Bir kullanıcının aynı anda tek bekleyen talebi olabilir; günde en fazla 3 talep açılabilir.
CREATE OR REPLACE FUNCTION public.request_corporate_workspace(p_name text, p_budget_cents integer DEFAULT NULL)
RETURNS public.corporate_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.corporate_workspaces;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_workspaces WHERE owner_id = auth.uid() AND status = 'pending') THEN
    RAISE EXCEPTION 'Onay bekleyen bir talebin zaten var' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.corporate_workspaces WHERE owner_id = auth.uid() AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'Bugün çok fazla talep açtın, yarın tekrar dene' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.corporate_workspaces (owner_id, name, monthly_budget_cents)
  VALUES (auth.uid(), left(btrim(p_name), 120), p_budget_cents) RETURNING * INTO v_row;
  PERFORM public.notify_user(u.id, 'Kurumsal çalışma alanı talebi', v_row.name || ' onay bekliyor.', 'system',
    jsonb_build_object('workspaceId', v_row.id)) FROM public.users u WHERE u.role = 'admin';
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_corporate_workspace(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_corporate_workspace(text, integer) TO authenticated;

COMMIT;
