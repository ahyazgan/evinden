-- 059: Büyüme raporları ekranı için düzeltmeler.
--
-- - Restoran kalitesi raporu (050) siparişleri ve SLA ihlallerini aynı sorguda birleştirdiği için iki sayıyı
--   birbiriyle çarpıyordu (3 sipariş, 2 ihlal → 6 ve 6). Puan da yalnızca elle yenilenen sütundan
--   okunuyordu, hiç yenilenmediği için herkes 0 görünüyordu. Artık sayılar ayrı hesaplanır, puan rapor
--   anında aynı formülle bulunur.
-- - Ödemesi tamamlanmamış online siparişler (restorana hiç düşmemiş olanlar) kalite hesabına girmez.
-- - Birim ekonomi varsayımları (kurye, destek, ödeme komisyonu, edinme maliyeti) yönetim ekranından
--   düzenlenir; önceden yalnızca SQL ile değişiyordu.

BEGIN;

-- Maliyet varsayımları ve kalite ağırlıkları yalnızca yöneticiye açıktır (036 ile aynı, iki anahtar eklendi).
DROP POLICY IF EXISTS "Herkes app config okuyabilir" ON public.app_config;
CREATE POLICY "Herkes app config okuyabilir"
  ON public.app_config FOR SELECT
  USING (key NOT IN ('fraud_rules', 'iyzico_marketplace', 'unit_economics', 'seller_quality') OR public.is_admin());

-- Restorana ulaşmış sipariş: ödeme beklemeyen ve ödemesi tamamlanmadığı için iptal edilmemiş.
CREATE OR REPLACE FUNCTION public.order_reached_seller(p_order public.orders)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_order.status <> 'awaiting_payment'
     AND NOT (p_order.status = 'cancelled' AND p_order.payment_method = 'online'
              AND coalesce(p_order.payment_status, '') NOT IN ('paid','refund_pending','refunded'));
$$;
REVOKE ALL ON FUNCTION public.order_reached_seller(public.orders) FROM PUBLIC, anon, authenticated;

-- Kalite puanı: değerlendirme, iptal, iade ve SLA oranlarının ağırlıklı toplamı (050 formülü).
-- Yeterli sipariş yoksa 50 (nötr).
CREATE OR REPLACE FUNCTION public._seller_quality_score(p_rating numeric, p_orders integer, p_cancelled integer,
  p_refunds integer, p_sla integer, p_cfg jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_orders < greatest(1, public.sla_policy_int(p_cfg, 'minimum_orders', 5)) THEN 50::numeric
    ELSE round(greatest(0, least(100,
      coalesce(p_rating, 0) / 5.0 * public.sla_policy_int(p_cfg, 'review_weight', 40)
      + (1.0 - p_cancelled::numeric / p_orders) * public.sla_policy_int(p_cfg, 'cancellation_weight', 25)
      + (1.0 - p_refunds::numeric / p_orders) * public.sla_policy_int(p_cfg, 'refund_weight', 20)
      + (1.0 - least(1.0, p_sla::numeric / p_orders)) * public.sla_policy_int(p_cfg, 'sla_weight', 15)
    )), 2) END;
$$;
REVOKE ALL ON FUNCTION public._seller_quality_score(numeric, integer, integer, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_seller_quality(integer);
CREATE FUNCTION public.admin_seller_quality(p_days integer DEFAULT 90)
RETURNS TABLE (seller_id uuid, display_name text, is_active boolean, score numeric, rating numeric,
  orders integer, cancelled integer, refunds integer, sla_violations integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 90))));
  v_cfg jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'seller_quality'), '{}'::jsonb);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH o AS (
    SELECT o.seller_id,
      count(*)::integer AS orders,
      count(*) FILTER (WHERE o.status = 'cancelled')::integer AS cancelled,
      count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer AS refunds
    FROM public.orders o
    WHERE o.created_at >= v_from AND public.order_reached_seller(o)
    GROUP BY o.seller_id
  ), v AS (
    SELECT sv.seller_id, count(*)::integer AS n FROM public.sla_violations sv
     WHERE sv.occurred_at >= v_from AND sv.status <> 'waived'
     GROUP BY sv.seller_id
  )
  SELECT s.id, s.display_name, s.is_active,
    public._seller_quality_score(s.rating_avg, coalesce(o.orders, 0), coalesce(o.cancelled, 0),
                                 coalesce(o.refunds, 0), coalesce(v.n, 0), v_cfg),
    coalesce(s.rating_avg, 0)::numeric,
    coalesce(o.orders, 0), coalesce(o.cancelled, 0), coalesce(o.refunds, 0), coalesce(v.n, 0)
  FROM public.sellers s
  LEFT JOIN o ON o.seller_id = s.id
  LEFT JOIN v ON v.seller_id = s.id
  WHERE s.user_id IS NOT NULL AND (s.is_active OR coalesce(o.orders, 0) > 0)
  ORDER BY 4 ASC, coalesce(o.orders, 0) DESC, s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_seller_quality(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seller_quality(integer) TO authenticated;

-- 050 ile aynı amaç; aynı sayım ve formül kullanılır, sonuç sütuna yazılır.
CREATE OR REPLACE FUNCTION public.refresh_seller_quality(p_seller uuid)
RETURNS numeric LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_score numeric;
  v_orders integer; v_cancelled integer; v_refunded integer; v_sla integer;
  v_rating numeric;
  v_cfg jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'seller_quality'), '{}'::jsonb);
BEGIN
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = p_seller AND s.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer,
    count(*) FILTER (WHERE o.status = 'cancelled')::integer,
    count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer
    INTO v_orders, v_cancelled, v_refunded
    FROM public.orders o
   WHERE o.seller_id = p_seller AND o.created_at >= now() - interval '90 days' AND public.order_reached_seller(o);
  SELECT count(*)::integer INTO v_sla FROM public.sla_violations
    WHERE seller_id = p_seller AND occurred_at >= now() - interval '90 days' AND status <> 'waived';
  SELECT coalesce(s.rating_avg, 0) INTO v_rating FROM public.sellers s WHERE s.id = p_seller;
  v_score := public._seller_quality_score(v_rating, v_orders, v_cancelled, v_refunded, v_sla, v_cfg);
  PERFORM set_config('app.internal', '1', true);
  UPDATE public.sellers SET quality_score = v_score, quality_updated_at = now() WHERE id = p_seller;
  PERFORM set_config('app.internal', '', true);
  RETURN v_score;
END $$;
REVOKE ALL ON FUNCTION public.refresh_seller_quality(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_seller_quality(uuid) TO authenticated;

-- Birim ekonomi varsayımları. Değerler kuruş (oran baz puan) ve 0-999999 arası tam sayıdır; raporlar
-- bu aralık dışındaki değeri yok sayar (sla_policy_int).
CREATE OR REPLACE FUNCTION public.admin_update_unit_economics(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_next jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Ayar geçersiz' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_value) LOOP
    IF v_key NOT IN ('delivery_cost_cents','support_cost_cents','payment_fee_bps','acquisition_cost_cents') THEN
      RAISE EXCEPTION 'Bilinmeyen ayar: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_value->v_key) <> 'number' OR (p_value->>v_key) !~ '^[0-9]{1,6}$' THEN
      RAISE EXCEPTION '%: 0 ile 999999 arasında tam sayı olmalı', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_value ? 'payment_fee_bps') AND (p_value->>'payment_fee_bps')::integer > 2000 THEN
    RAISE EXCEPTION 'Ödeme komisyonu en fazla %%20 olabilir' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.app_config (key, value) VALUES ('unit_economics', p_value)
  ON CONFLICT (key) DO UPDATE SET value = public.app_config.value || EXCLUDED.value, updated_at = now()
  RETURNING value INTO v_next;
  RETURN v_next;
END $$;
REVOKE ALL ON FUNCTION public.admin_update_unit_economics(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_unit_economics(jsonb) TO authenticated;

COMMIT;
