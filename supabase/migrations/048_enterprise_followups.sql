-- 048: SLA motorunun tam sürümü, iade ödeme senkronu ve fatura adayları.

BEGIN;

-- Kural değerleri bozuk olsa bile görev durmaz; geçersiz değer yerine varsayılan kullanılır.
CREATE OR REPLACE FUNCTION public.sla_policy_int(p_policy jsonb, p_key text, p_default integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_policy->>p_key ~ '^[0-9]{1,6}$' THEN (p_policy->>p_key)::integer ELSE p_default END;
$$;
REVOKE ALL ON FUNCTION public.sla_policy_int(jsonb, text, integer) FROM PUBLIC, anon, authenticated;

-- Bekleyen siparişin hatırlatma ve iptali SLA kuralından bağımsız olarak her zaman çalışır (029/037 davranışı).
-- SLA açıkken buna ek olarak ihlal kaydı tutulur. "action" yalnızca hazırlama gecikmesini etkiler:
-- "penalty" kayıt açar, "cancel" siparişi de iptal eder.
CREATE OR REPLACE FUNCTION public.sla_process_orders(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb;
  v_enabled boolean;
  v_remind integer;
  v_cancel integer;
  v_prepare integer;
  v_action text;
  v_penalty integer;
  v_cancelled integer := 0;
  v_violations integer := 0;
  v_row record;
BEGIN
  v_policy := coalesce(public.sla_policy(), '{}'::jsonb);
  v_enabled := coalesce(v_policy->>'enabled', 'true') <> 'false';
  v_remind := greatest(1, least(240, public.sla_policy_int(v_policy, 'reminder_minutes', 10)));
  v_cancel := greatest(v_remind + 1, least(720, public.sla_policy_int(v_policy, 'cancel_minutes', 30)));
  v_prepare := greatest(30, least(1440, public.sla_policy_int(v_policy, 'preparation_cancel_minutes', 90)));
  v_action := CASE WHEN v_policy->>'action' = 'cancel' THEN 'cancel' ELSE 'penalty' END;
  v_penalty := greatest(0, least(100000, public.sla_policy_int(v_policy, 'penalty_cents', 0)));

  -- Veri temizliği (037): SLA kapalı olsa da yapılır.
  DELETE FROM public.analytics_events WHERE created_at < p_now - interval '180 days';
  DELETE FROM public.order_courier_locations WHERE updated_at < p_now - interval '6 hours';

  -- 1. Bekleyen sipariş: hatırlatma ve iptal. Planlı siparişte süre yalnızca restoran açıkken işler.
  FOR v_row IN
    SELECT o.id, o.seller_id, s.user_id, o.scheduled_for, coalesce(o.pending_since, o.created_at) AS pending_since,
           floor(extract(epoch FROM (p_now - coalesce(o.pending_since, o.created_at))) / 60)::integer AS age
      FROM public.orders o JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'pending'
  LOOP
    IF (CASE WHEN v_row.scheduled_for IS NULL
      THEN v_row.age >= v_remind AND v_row.age < v_cancel
      ELSE v_row.scheduled_for >= p_now + interval '15 minutes'
        AND public.scheduled_reply_elapsed(v_row.seller_id, v_row.pending_since, v_remind)
        AND NOT public.scheduled_reply_elapsed(v_row.seller_id, v_row.pending_since, v_cancel)
    END) THEN
      UPDATE public.orders SET pending_reminded_at = p_now WHERE id = v_row.id AND pending_reminded_at IS NULL;
      IF FOUND THEN PERFORM public.notify_user(v_row.user_id, 'Bekleyen siparişin var',
        'Yanıtlamazsan sipariş iptal edilecek.', 'order_status', jsonb_build_object('orderId', v_row.id)); END IF;
    END IF;
    IF (CASE WHEN v_row.scheduled_for IS NULL THEN v_row.age >= v_cancel
      ELSE v_row.scheduled_for < p_now + interval '15 minutes'
        OR public.scheduled_reply_elapsed(v_row.seller_id, v_row.pending_since, v_cancel)
    END) THEN
      UPDATE public.orders SET status = 'cancelled', cancel_reason = 'Satıcı zamanında yanıtlamadı', updated_at = p_now
       WHERE id = v_row.id AND status = 'pending';
      IF FOUND THEN
        v_cancelled := v_cancelled + 1;
        IF v_enabled THEN
          INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late, penalty_cents)
          VALUES (v_row.id, v_row.seller_id, 'acceptance_timeout', greatest(v_row.age - v_cancel, 0), v_penalty)
          ON CONFLICT (order_id, violation_type) DO NOTHING;
          IF FOUND THEN v_violations := v_violations + 1; END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Planlı sipariş yaklaşıyor hatırlatması (034).
  FOR v_row IN
    SELECT o.id, o.seller_id, s.user_id, o.scheduled_for
      FROM public.orders o JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'accepted' AND o.scheduled_reminded_at IS NULL
       AND o.scheduled_for > p_now AND o.scheduled_for <= p_now + interval '60 minutes'
  LOOP
    UPDATE public.orders SET scheduled_reminded_at = p_now WHERE id = v_row.id AND scheduled_reminded_at IS NULL;
    IF FOUND THEN PERFORM public.notify_user(v_row.user_id, 'Planlı sipariş yaklaşıyor',
      'Sipariş #' || left(v_row.id::text, 8) || ' saat ' ||
      to_char(v_row.scheduled_for AT TIME ZONE 'Europe/Istanbul', 'HH24:MI') || ' için planlı.',
      'order_status', jsonb_build_object('orderId', v_row.id)); END IF;
  END LOOP;

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('enabled', false, 'cancelled', v_cancelled, 'violations', 0);
  END IF;

  -- 3. Hazırlama gecikmesi. Planlı siparişte süre planlanan saatten başlar; saat gelmeden işlem yapılmaz.
  FOR v_row IN
    SELECT x.id, x.seller_id, floor(extract(epoch FROM (p_now - x.started)) / 60)::integer AS age
      FROM (
        SELECT o.id, o.seller_id,
               CASE WHEN o.scheduled_for IS NOT NULL
                    THEN greatest(o.scheduled_for, coalesce(o.accepted_at, o.status_changed_at, o.updated_at))
                    ELSE coalesce(o.accepted_at, o.status_changed_at, o.updated_at) END AS started
          FROM public.orders o
         WHERE o.status = 'accepted' AND (o.scheduled_for IS NULL OR o.scheduled_for <= p_now)
      ) x
  LOOP
    IF v_row.age >= v_prepare THEN
      INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late, penalty_cents)
      VALUES (v_row.id, v_row.seller_id, 'preparation_timeout', v_row.age - v_prepare, v_penalty)
      ON CONFLICT (order_id, violation_type) DO NOTHING;
      IF FOUND THEN v_violations := v_violations + 1; END IF;
      IF v_action = 'cancel' THEN
        UPDATE public.orders SET status = 'cancelled', cancel_reason = 'Hazırlama süresi aşıldı', updated_at = p_now
         WHERE id = v_row.id AND status = 'accepted';
        IF FOUND THEN v_cancelled := v_cancelled + 1; END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enabled', true, 'cancelled', v_cancelled, 'violations', v_violations,
    'reminder_minutes', v_remind, 'cancel_minutes', v_cancel, 'preparation_cancel_minutes', v_prepare,
    'action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.sla_process_orders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sla_process_orders(timestamptz) TO service_role;

-- Zamanlanmış görev (029) bu imzayla çağırır. Süreler artık SLA kuralından okunur; varsayılanı 10/30 dakikadır.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.sla_process_orders(now());
  RETURN coalesce((v_result->>'cancelled')::integer, 0);
END $$;
REVOKE ALL ON FUNCTION public.expire_pending_orders(integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_refund_case_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    UPDATE public.refund_cases SET status = 'paid', paid_at = now(), updated_at = now() WHERE order_id = NEW.id;
  ELSIF NEW.refund_status IS DISTINCT FROM OLD.refund_status AND NEW.refund_status IN ('requested','approved','rejected') THEN
    -- Eski yönetim ekranı refund_status'u doğrudan yazar; karar bilgisi burada da doldurulur.
    INSERT INTO public.refund_cases (order_id, seller_id, customer_id, reason, payment_method, requested_cents, status,
      approved_cents, decided_at, decided_by)
    VALUES (NEW.id, NEW.seller_id, NEW.customer_id, left(coalesce(nullif(btrim(NEW.refund_reason), ''), 'Belirtilmedi'), 500),
      coalesce(NEW.payment_method, 'cash'), NEW.total_cents, NEW.refund_status,
      CASE WHEN NEW.refund_status = 'approved' THEN NEW.total_cents END,
      CASE WHEN NEW.refund_status IN ('approved','rejected') THEN now() END,
      CASE WHEN NEW.refund_status IN ('approved','rejected') THEN auth.uid() END)
    ON CONFLICT (order_id) DO UPDATE SET
      reason = excluded.reason, requested_cents = excluded.requested_cents,
      -- Ödenmiş iade, eski yoldan gelen bir durum değişikliğiyle geri açılmaz.
      status = CASE WHEN refund_cases.status = 'paid' THEN 'paid' ELSE excluded.status END,
      approved_cents = CASE WHEN refund_cases.status = 'paid' THEN refund_cases.approved_cents
                            WHEN excluded.status = 'approved' THEN coalesce(refund_cases.approved_cents, excluded.approved_cents)
                            ELSE NULL END,
      decided_at = coalesce(refund_cases.decided_at, excluded.decided_at),
      decided_by = coalesce(refund_cases.decided_by, excluded.decided_by),
      updated_at = now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_refund_case_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_refund_case_sync_trg ON public.orders;
CREATE TRIGGER orders_refund_case_sync_trg AFTER UPDATE OF refund_status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_refund_case_sync();

-- 046'dan önce açılmış iade talepleri de yeni vaka tablosuna taşınır. Silinmiş müşterinin ve yemek kartıyla
-- ödenmiş siparişin kaydı da taşınır; iadesi zaten yapılmış online sipariş "ödendi" olarak gelir.
INSERT INTO public.refund_cases (order_id, seller_id, customer_id, reason, payment_method, requested_cents, status,
  approved_cents, paid_at)
SELECT o.id, o.seller_id, o.customer_id, left(coalesce(nullif(btrim(o.refund_reason), ''), 'Belirtilmedi'), 500),
       coalesce(o.payment_method, 'cash'), o.total_cents,
       CASE WHEN o.payment_status = 'refunded' THEN 'paid' ELSE o.refund_status END,
       CASE WHEN o.refund_status = 'approved' THEN o.total_cents END,
       CASE WHEN o.payment_status = 'refunded' THEN o.updated_at END
  FROM public.orders o
 WHERE o.refund_status IN ('requested','approved','rejected')
 ON CONFLICT (order_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_mark_refund_case_paid(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.refund_cases;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND OR v_case.status <> 'approved' THEN RAISE EXCEPTION 'Onaylanmış iade vakası bulunamadı' USING ERRCODE = '22023'; END IF;
  IF v_case.payment_method = 'online' THEN
    RAISE EXCEPTION 'Online iade iyzico üzerinden tamamlanır' USING ERRCODE = '55000';
  END IF;
  UPDATE public.refund_cases SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = p_case;
END $$;
REVOKE ALL ON FUNCTION public.admin_mark_refund_case_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_refund_case_paid(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_invoice_candidates()
RETURNS TABLE (
  order_id uuid, customer_id uuid, customer_name text, seller_id uuid, seller_name text,
  total_cents integer, created_at timestamptz,
  billing_title text, billing_tax_number text, billing_tax_office text, billing_address text, billing_email text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.customer_id, coalesce(u.name, 'Müşteri'), o.seller_id, s.display_name, o.total_cents, o.created_at,
           b.legal_title, b.tax_number, b.tax_office, b.address, b.email
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
      LEFT JOIN public.users u ON u.id = o.customer_id
      LEFT JOIN public.corporate_billing_profiles b ON b.user_id = o.customer_id
     WHERE o.status = 'delivered'
       AND coalesce(o.refund_status, 'none') NOT IN ('requested','approved')
       AND coalesce(o.payment_status, '') NOT IN ('refund_pending','refunded')
       AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
     ORDER BY o.created_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_invoice_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_invoice_candidates() TO authenticated;

-- Müşteri kendi teslim siparişi için, kayıtlı kurumsal profilinden fatura talebi oluşturur.
-- Tutar ve satır hesabı yönetici yoluyla aynıdır (046: _invoice_amounts).
CREATE OR REPLACE FUNCTION public.request_invoice(p_order uuid)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_profile public.corporate_billing_profiles;
  v_invoice public.invoices;
  v_rate integer := public._invoice_tax_rate();
  v_amounts jsonb;
BEGIN
  IF NOT public.einvoice_enabled() THEN
    RAISE EXCEPTION 'Kurumsal fatura şu an alınamıyor' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR v_order.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._assert_invoiceable(v_order);
  IF EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order) THEN RAISE EXCEPTION 'Bu sipariş için fatura talebi zaten var' USING ERRCODE = '23505'; END IF;
  SELECT * INTO v_profile FROM public.corporate_billing_profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Kurumsal fatura profilin eksik' USING ERRCODE = '55000'; END IF;
  v_amounts := public._invoice_amounts(v_order, v_rate);
  INSERT INTO public.invoices (
    invoice_number, order_id, seller_id, customer_id, status, buyer_snapshot, seller_snapshot,
    lines, subtotal_cents, tax_cents, total_cents, tax_rate_bps
  ) VALUES (
    public._next_invoice_number(), p_order, v_order.seller_id, v_order.customer_id, 'draft',
    jsonb_build_object('title', v_profile.legal_title, 'taxNumber', v_profile.tax_number,
      'taxOffice', v_profile.tax_office, 'address', v_profile.address, 'email', v_profile.email),
    public._invoice_seller_snapshot(v_order.seller_id),
    v_amounts->'lines', (v_amounts->>'subtotal_cents')::integer, (v_amounts->>'tax_cents')::integer,
    (v_amounts->>'total_cents')::integer, v_rate
  ) RETURNING * INTO v_invoice;
  RETURN v_invoice;
END $$;
REVOKE ALL ON FUNCTION public.request_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_queue_invoice(p_invoice uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF NOT public.einvoice_enabled() THEN RAISE EXCEPTION 'E-fatura henüz açık değil' USING ERRCODE = '55000'; END IF;
  UPDATE public.invoices SET status = 'queued', updated_at = now()
   WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura taslağı bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_queue_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_queue_invoice(uuid) TO authenticated;

COMMIT;
