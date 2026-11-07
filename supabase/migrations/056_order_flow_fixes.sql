-- 056: Sipariş akışı düzeltmeleri.
--
-- - Restoranın kabul ederken seçtiği hazırlık süresi kaydedilir; müşterinin tahmini teslim saati bundan
--   hesaplanır. Önceden süre yalnızca restoranın ekranında kalıyordu, müşteri restoranın genel en uzun
--   teslimat süresini görüyordu.
-- - Müşteriye giden "kabul edildi" bildirimi hazırlık süresini, "iptal edildi" bildirimi iptal nedenini taşır.
-- - Kurumsal fatura talebi bildirimi restoranın fatura sekmesini açar (invoiceRequest bayrağı).

BEGIN;

-- ── 1. Hazırlık süresi ─────────────────────────────────────────────────────

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS prep_minutes INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_prep_minutes_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_prep_minutes_check
      CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 5 AND 180);
  END IF;
END $$;

-- 050 ile aynı; hazırlık süresi de yalnızca RPC ile yazılır.
CREATE OR REPLACE FUNCTION public.orders_lock_operation_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND NOT public._internal_call() THEN
    NEW.eta_minutes := OLD.eta_minutes;
    NEW.eta_updated_at := OLD.eta_updated_at;
    NEW.prep_minutes := OLD.prep_minutes;
    NEW.delivery_mode := OLD.delivery_mode;
    NEW.courier_provider := OLD.courier_provider;
    NEW.courier_tracking_code := OLD.courier_tracking_code;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_lock_operation_fields() FROM PUBLIC, anon, authenticated;

-- Restoran siparişi hazırlık süresiyle kabul eder. eta_minutes, eta_updated_at anından teslime (gel-al
-- siparişte hazır olmaya) kalan toplam dakikadır: hazırlık + restoranın en kısa ve en uzun teslimat süresi
-- arasındaki fark kadar yol (en az 10 dakika). Eve teslimde restoranın ilan ettiği en kısa süreden az
-- gösterilmez.
-- Süre önce iç çağrıyla yazılır, durum sonra restoranın kendi yetkisiyle değişir: durum kuralları
-- (orders_guard) olduğu gibi uygulanır ve müşteri bildirimi süreyi görür. Durum değişemezse süre de geri alınır.
CREATE OR REPLACE FUNCTION public.seller_accept_order(p_order uuid, p_prep_minutes integer)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_seller public.sellers;
  v_travel integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  IF p_prep_minutes IS NULL OR p_prep_minutes NOT BETWEEN 5 AND 180 THEN
    RAISE EXCEPTION 'Hazırlık süresi 5 ile 180 dakika arasında olmalı' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = v_order.seller_id;
  IF v_seller.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Sipariş artık onay beklemiyor' USING ERRCODE = '55000';
  END IF;

  v_travel := CASE WHEN v_order.fulfillment = 'pickup' THEN 0
    ELSE greatest(10, coalesce(v_seller.delivery_time_max, 40) - coalesce(v_seller.delivery_time_min, 20)) END;

  PERFORM set_config('app.internal', '1', true);
  UPDATE public.orders
     SET prep_minutes = p_prep_minutes,
         eta_minutes = CASE WHEN v_order.fulfillment = 'pickup' THEN p_prep_minutes
           ELSE greatest(p_prep_minutes + v_travel, coalesce(v_seller.delivery_time_min, 0)) END,
         eta_updated_at = now()
   WHERE id = p_order;
  PERFORM set_config('app.internal', '', true);

  UPDATE public.orders SET status = 'accepted', updated_at = now() WHERE id = p_order RETURNING * INTO v_order;
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.seller_accept_order(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_accept_order(uuid, integer) TO authenticated;

-- 050 ile aynı; restoranın verdiği hazırlık süresi varsa genel süre yerine o kullanılır.
CREATE OR REPLACE FUNCTION public.order_eta(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_seller public.sellers;
  v_uid uuid := auth.uid();
  v_prep integer;
  v_queue integer := 0;
  v_elapsed integer := 0;
  v_eta integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_uid IS NOT NULL AND NOT public.is_admin()
     AND v_uid IS DISTINCT FROM v_order.customer_id
     AND NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_order.seller_id AND s.user_id = v_uid) THEN
    RAISE EXCEPTION 'Bu siparişi göremezsin' USING ERRCODE = '42501';
  END IF;
  IF v_order.status IN ('delivered','cancelled') THEN
    RETURN jsonb_build_object('status', v_order.status, 'eta_minutes', NULL, 'eta_at', NULL, 'confidence', 'finished');
  END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = v_order.seller_id;
  v_prep := greatest(5, least(180, coalesce(v_order.prep_minutes, v_seller.delivery_time_min, 20)));
  IF v_order.status IN ('pending','accepted','preparing') THEN
    SELECT count(*)::integer INTO v_queue FROM public.orders q
     WHERE q.seller_id = v_order.seller_id AND q.status IN ('pending','accepted','preparing')
       AND q.created_at < v_order.created_at;
    v_elapsed := floor(extract(epoch FROM (now() - coalesce(v_order.accepted_at, v_order.created_at))) / 60)::integer;
  END IF;
  IF v_order.status = 'pending' THEN
    v_eta := v_prep + least(45, v_queue * 5);
  ELSIF v_order.status = 'accepted' THEN
    v_eta := greatest(5, v_prep - v_elapsed) + least(30, v_queue * 3);
  ELSIF v_order.status = 'preparing' THEN
    v_eta := greatest(5, v_prep - v_elapsed) + 5;
  ELSIF v_order.status = 'ready' THEN
    v_eta := 10 + least(20, v_queue * 2);
  ELSE
    v_eta := 12;
  END IF;
  v_eta := greatest(5, least(240, v_eta));
  RETURN jsonb_build_object(
    'status', v_order.status, 'eta_minutes', v_eta,
    'eta_at', now() + make_interval(mins => v_eta),
    'confidence', CASE WHEN v_order.status = 'pending' THEN 'estimated' ELSE 'live' END,
    'queue_ahead', v_queue
  );
END $$;
REVOKE ALL ON FUNCTION public.order_eta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_eta(uuid) TO authenticated;

-- ── 2. Bildirimler ─────────────────────────────────────────────────────────
-- 038 ile aynı; kabul bildirimi hazırlık süresini, iptal bildirimi iptal nedenini taşır.

CREATE OR REPLACE FUNCTION public.orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_user uuid;
  v_seller_name text;
  v_data  jsonb := jsonb_build_object('orderId', NEW.id);
  v_new_data jsonb := jsonb_build_object('orderId', NEW.id, 'new_order', true);
  v_short text := left(NEW.id::text, 8);
  v_title text;
  v_body text;
  v_new_body text;
BEGIN
  SELECT user_id, display_name INTO v_seller_user, v_seller_name FROM public.sellers WHERE id = NEW.seller_id;

  v_new_body := 'Sipariş #' || v_short
    || CASE WHEN NEW.scheduled_for IS NOT NULL
         THEN ' (' || to_char(NEW.scheduled_for AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI') || ' için planlı)'
         ELSE '' END
    || ' onayını bekliyor.';

  -- Online sipariş satıcıya ödeme alındıktan sonra görünür.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'awaiting_payment' THEN
      PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_new_data);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'pending' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_new_data);
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.notify_user(NEW.customer_id, 'Ödemen iade edildi', 'Sipariş #' || v_short, 'order_status', v_data);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := CASE NEW.status
      WHEN 'accepted'         THEN 'Siparişin kabul edildi'
      WHEN 'preparing'        THEN 'Siparişin hazırlanıyor'
      WHEN 'ready'            THEN CASE WHEN NEW.fulfillment = 'pickup' THEN 'Siparişin hazır, gelip alabilirsin' ELSE 'Siparişin hazır' END
      WHEN 'out_for_delivery' THEN 'Siparişin yolda'
      WHEN 'delivered'        THEN CASE WHEN NEW.fulfillment = 'pickup' THEN 'Siparişini teslim aldın' ELSE 'Siparişin teslim edildi' END
      WHEN 'cancelled'        THEN 'Siparişin iptal edildi'
    END;
    v_body := v_seller_name || ' · Sipariş #' || v_short;
    IF NEW.status = 'accepted' AND NEW.prep_minutes IS NOT NULL AND NEW.scheduled_for IS NULL THEN
      v_body := v_body || ' · Hazırlık yaklaşık ' || NEW.prep_minutes || ' dk';
    ELSIF NEW.status = 'cancelled' AND nullif(btrim(NEW.cancel_reason), '') IS NOT NULL THEN
      v_body := v_body || ' · ' || left(NEW.cancel_reason, 120);
    END IF;
    IF v_title IS NOT NULL AND NEW.customer_id IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(NEW.customer_id, v_title, v_body, 'order_status', v_data);
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status <> 'awaiting_payment' AND v_seller_user IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(v_seller_user, 'Sipariş iptal edildi',
        'Sipariş #' || v_short || ' iptal edildi.'
          || CASE WHEN nullif(btrim(NEW.cancel_reason), '') IS NOT NULL THEN ' Neden: ' || left(NEW.cancel_reason, 120) ELSE '' END,
        'order_status', v_data);
    END IF;
  END IF;

  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status THEN
    IF NEW.refund_status = 'requested' THEN
      PERFORM public.notify_user(v_seller_user, 'İade talebi', 'Sipariş #' || v_short || ' için iade talep edildi.', 'order_status', v_data);
    ELSIF NEW.refund_status IN ('approved', 'rejected') THEN
      PERFORM public.notify_user(
        NEW.customer_id,
        CASE NEW.refund_status WHEN 'approved' THEN 'İade talebin onaylandı' ELSE 'İade talebin reddedildi' END,
        'Sipariş #' || v_short, 'order_status', v_data);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 053 ile aynı; bildirim restoranın fatura sekmesini açsın diye invoiceRequest bayrağı taşır.
CREATE OR REPLACE FUNCTION public.request_order_invoice(p_order uuid)
RETURNS public.order_invoice_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_profile public.corporate_billing_profiles;
  v_row public.order_invoice_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status = 'cancelled' OR coalesce(v_order.refund_status, 'none') IN ('requested','approved')
     OR coalesce(v_order.payment_status, '') IN ('refund_pending','refunded') THEN
    RAISE EXCEPTION 'İptal veya iade edilen siparişe fatura istenemez' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'delivered' AND coalesce(v_order.delivered_at, v_order.updated_at) < now() - interval '30 days' THEN
    RAISE EXCEPTION 'Fatura teslimden sonraki 30 gün içinde istenebilir' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_profile FROM public.corporate_billing_profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Önce kurumsal fatura bilgilerini kaydet' USING ERRCODE = '55000'; END IF;

  INSERT INTO public.order_invoice_requests (order_id, seller_id, customer_id, buyer)
  VALUES (p_order, v_order.seller_id, auth.uid(), jsonb_build_object(
    'title', v_profile.legal_title, 'taxNumber', v_profile.tax_number, 'taxOffice', v_profile.tax_office,
    'address', v_profile.address, 'email', v_profile.email))
  ON CONFLICT (order_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.order_id IS NULL THEN RAISE EXCEPTION 'Bu sipariş için fatura zaten istendi' USING ERRCODE = '23505'; END IF;

  PERFORM public.notify_user(s.user_id, 'Kurumsal fatura istendi',
    v_profile.legal_title || ' sipariş #' || left(p_order::text, 8) || ' için fatura istiyor.', 'system',
    jsonb_build_object('orderId', p_order, 'invoiceRequest', true)) FROM public.sellers s WHERE s.id = v_order.seller_id;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_order_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_order_invoice(uuid) TO authenticated;

COMMIT;
