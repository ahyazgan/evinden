-- 022: Online ödeme (iyzico Checkout Form)
--
-- Akış: place_order 'awaiting_payment' açar -> payment-init ödeme sayfasını başlatır ->
-- payment-callback sonucu iyzico'dan doğrular -> mark_order_paid siparişi 'pending' yapar.
-- Kart bilgisi uygulamaya ve sunucuya hiç gelmez. Varsayılan olarak KAPALIDIR:
-- app_config.online_payment.enabled yönetici panelinden açılır.
--
-- Parası alınmış sipariş iptal edilir veya iadesi onaylanırsa ödeme 'refund_pending' olur;
-- para payment-refund ile iade edilince 'refunded' olur.

BEGIN;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%payment_status%' OR pg_get_constraintdef(oid) ILIKE '%out_for_delivery%')
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('awaiting_payment','pending','accepted','preparing','ready','out_for_delivery','delivered','cancelled'));
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK (payment_status IN
  ('pending','paid','refund_pending','refunded'));

INSERT INTO public.app_config (key, value) VALUES ('online_payment', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.online_payment_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value->>'enabled')::boolean FROM public.app_config WHERE key = 'online_payment'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.place_order(
  p_seller_id        uuid,
  p_items            jsonb,
  p_delivery_address text,
  p_notes            text DEFAULT NULL,
  p_payment_method   text DEFAULT 'cash',
  p_coupon_code      text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL,
  p_delivery_lat     numeric DEFAULT NULL,
  p_delivery_lng     numeric DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_cfg       jsonb;
  v_fee       integer;
  v_free_over integer;
  v_rate      numeric;
  v_min       integer;
  v_seller    public.sellers%ROWTYPE;
  v_el        jsonb;
  v_mi        public.menu_items%ROWTYPE;
  v_var       public.menu_item_variants%ROWTYPE;
  v_por       public.menu_item_portions%ROWTYPE;
  v_qty       integer;
  v_unit      integer;
  v_title     text;
  v_extra_ids uuid[];
  v_extras_n  integer;
  v_extras_sum integer;
  v_extras_lbl text;
  v_today     date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_dow       integer := extract(isodow FROM (now() AT TIME ZONE 'Europe/Istanbul'))::integer - 1;
  v_sold      integer;
  v_subtotal  integer := 0;
  v_delivery  integer;
  v_discount  integer := 0;
  v_total     integer;
  v_commission integer;
  v_coupon    public.coupons%ROWTYPE;
  v_lines     jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_order     public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sipariş için giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  IF p_payment_method NOT IN ('cash', 'card_door', 'online') THEN
    RAISE EXCEPTION 'Bu ödeme yöntemi şu an desteklenmiyor' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'online' AND NOT public.online_payment_enabled() THEN
    RAISE EXCEPTION 'Online ödeme şu an kullanılamıyor' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Sepet geçersiz' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_address IS NULL OR length(btrim(p_delivery_address)) < 5 OR length(p_delivery_address) > 500 THEN
    RAISE EXCEPTION 'Teslimat adresi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_notes, '')) > 500 THEN
    RAISE EXCEPTION 'Sipariş notu çok uzun' USING ERRCODE = '22001';
  END IF;

  SELECT value INTO v_cfg FROM public.app_config WHERE key = 'order_pricing';
  v_cfg       := coalesce(v_cfg, '{}'::jsonb);
  v_fee       := coalesce((v_cfg->>'delivery_fee_cents')::integer, 1500);
  v_free_over := coalesce((v_cfg->>'free_delivery_threshold_cents')::integer, 15000);
  v_rate      := coalesce((v_cfg->>'commission_rate_percent')::numeric, 8);
  v_min       := coalesce((v_cfg->>'min_order_cents')::integer, 0);

  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller_id;
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Bu satıcı şu an sipariş almıyor' USING ERRCODE = '22023';
  END IF;
  IF v_seller.is_paused OR NOT public.seller_open_at(p_seller_id, now()) THEN
    RAISE EXCEPTION 'Bu satıcı şu an kapalı' USING ERRCODE = '22023';
  END IF;
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazanızdan sipariş veremezsiniz' USING ERRCODE = '22023';
  END IF;
  IF v_seller.seller_type = 'restaurant' THEN
    v_rate := coalesce((v_cfg->>'restaurant_commission_rate_percent')::numeric, 1);
  END IF;

  -- Satıcının kendi ayarı varsa platform varsayılanının yerine geçer.
  v_fee       := coalesce(v_seller.delivery_fee_cents, v_fee);
  v_free_over := coalesce(v_seller.free_delivery_threshold_cents, v_free_over);
  v_min       := greatest(v_min, v_seller.min_order_cents);

  -- Konumu bilinen satıcı yalnızca teslimat alanına sipariş alır.
  IF v_seller.latitude IS NOT NULL AND v_seller.longitude IS NOT NULL THEN
    IF p_delivery_lat IS NULL OR p_delivery_lng IS NULL
       OR p_delivery_lat NOT BETWEEN -90 AND 90 OR p_delivery_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Teslimat konumu bulunamadı' USING ERRCODE = 'EVN02';
    END IF;
    IF public.distance_km(v_seller.latitude, v_seller.longitude, p_delivery_lat, p_delivery_lng) > v_seller.delivery_radius_km THEN
      RAISE EXCEPTION 'Bu adres satıcının teslimat alanının dışında' USING ERRCODE = 'EVN03';
    END IF;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_el->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 50 THEN
      RAISE EXCEPTION 'Adet geçersiz' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_mi FROM public.menu_items
     WHERE id = (v_el->>'menu_item_id')::uuid AND seller_id = p_seller_id
     FOR UPDATE;
    IF NOT FOUND OR NOT v_mi.is_available THEN
      RAISE EXCEPTION 'Ürün bu satıcıda mevcut değil' USING ERRCODE = '22023';
    END IF;
    IF v_seller.uses_weekly_menu AND NOT EXISTS (
      SELECT 1 FROM public.weekly_menu w
       WHERE w.menu_item_id = v_mi.id AND w.day_of_week = v_dow AND w.is_active
    ) THEN
      RAISE EXCEPTION '% bugünkü menüde yok', v_mi.title USING ERRCODE = '22023';
    END IF;

    v_unit  := v_mi.price_cents;
    v_title := v_mi.title;

    IF coalesce(v_el->>'portion_id', '') <> '' THEN
      SELECT * INTO v_por FROM public.menu_item_portions
       WHERE id = (v_el->>'portion_id')::uuid AND menu_item_id = v_mi.id AND is_available;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Porsiyon seçeneği geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_por.price_cents;
      v_title := v_title || ' (' || v_por.label || ')';
    END IF;

    IF coalesce(v_el->>'variant_id', '') <> '' THEN
      SELECT * INTO v_var FROM public.menu_item_variants
       WHERE id = (v_el->>'variant_id')::uuid AND menu_item_id = v_mi.id AND is_available;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Seçenek geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_unit + v_var.price_diff_cents;
      v_title := v_title || ' (' || v_var.label || ')';
    END IF;

    v_extras_sum := 0;
    v_extras_lbl := NULL;
    IF jsonb_typeof(v_el->'extra_ids') = 'array' AND jsonb_array_length(v_el->'extra_ids') > 0 THEN
      SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_extra_ids
        FROM jsonb_array_elements_text(v_el->'extra_ids') AS x;
      SELECT count(*), coalesce(sum(price_cents), 0), string_agg(label, ', ' ORDER BY sort_order, label)
        INTO v_extras_n, v_extras_sum, v_extras_lbl
        FROM public.menu_item_extras
       WHERE id = ANY (v_extra_ids) AND menu_item_id = v_mi.id AND is_available;
      IF v_extras_n <> coalesce(array_length(v_extra_ids, 1), 0) THEN
        RAISE EXCEPTION 'Ek seçeneklerden biri geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_unit + v_extras_sum;
      v_title := v_title || ' + ' || v_extras_lbl;
    END IF;

    -- Günlük stok (0 = sınırsız)
    IF v_mi.daily_limit > 0 THEN
      v_sold := CASE WHEN v_mi.stock_reset_date = v_today THEN v_mi.sold_today ELSE 0 END;
      IF v_sold + v_qty > v_mi.daily_limit THEN
        RAISE EXCEPTION 'Stok yetersiz: %', v_mi.title USING ERRCODE = '22023';
      END IF;
      UPDATE public.menu_items
         SET sold_today = v_sold + v_qty, stock_reset_date = v_today, updated_at = now()
       WHERE id = v_mi.id;
    END IF;

    v_subtotal := v_subtotal + v_unit * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_mi.id, 'title', v_title, 'unit', v_unit, 'qty', v_qty, 'line', v_unit * v_qty);
  END LOOP;

  IF v_subtotal < v_min THEN
    RAISE EXCEPTION 'Minimum sipariş tutarı: ₺%', to_char(v_min / 100.0, 'FM999990.##') USING ERRCODE = '22023';
  END IF;

  v_delivery := CASE WHEN v_subtotal >= v_free_over THEN 0 ELSE v_fee END;

  IF coalesce(btrim(p_coupon_code), '') <> '' THEN
    SELECT * INTO v_coupon FROM public.coupons
     WHERE upper(code) = upper(btrim(p_coupon_code))
       AND is_active
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kupon geçersiz veya süresi dolmuş' USING ERRCODE = '22023';
    END IF;
    IF v_coupon.owner_id IS NOT NULL AND v_coupon.owner_id <> v_uid THEN
      RAISE EXCEPTION 'Kupon geçersiz veya süresi dolmuş' USING ERRCODE = '22023';
    END IF;
    IF v_subtotal < v_coupon.min_order_cents THEN
      RAISE EXCEPTION 'Kupon için minimum tutar karşılanmıyor' USING ERRCODE = '22023';
    END IF;
    -- Kupon satırı FOR UPDATE ile kilitli: aynı anda gelen iki sipariş hakkı aşamaz.
    IF v_coupon.max_uses_per_user IS NOT NULL AND (
      SELECT count(*) FROM public.coupon_redemptions r
       WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid
    ) >= v_coupon.max_uses_per_user THEN
      RAISE EXCEPTION 'Bu kuponu kullanım hakkınız doldu' USING ERRCODE = '22023';
    END IF;
    IF v_coupon.discount_type = 'percent' THEN
      v_discount := floor(v_subtotal * v_coupon.discount_value / 100.0)::integer;
      IF v_coupon.max_discount_cents IS NOT NULL THEN
        v_discount := least(v_discount, v_coupon.max_discount_cents);
      END IF;
    ELSIF v_coupon.discount_type = 'fixed' THEN
      v_discount := least(v_coupon.discount_value, v_subtotal);
    ELSIF v_coupon.discount_type = 'free_delivery' THEN
      v_delivery := 0;
    END IF;
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_total := greatest(v_subtotal + v_delivery - v_discount, 0);
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents <> v_total THEN
    RAISE EXCEPTION 'Sipariş tutarı değişti' USING ERRCODE = 'EVN01', DETAIL = v_total::text;
  END IF;
  v_commission := round(v_subtotal * v_rate / 100.0)::integer;
  IF p_payment_method = 'online' AND v_total <= 0 THEN
    RAISE EXCEPTION 'Ödenecek tutar yok, kapıda ödemeyi seçin' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (
    customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
    delivery_address, notes, payment_method, payment_status,
    commission_rate, commission_cents, discount_cents, coupon_code
  ) VALUES (
    v_uid, p_seller_id, CASE WHEN p_payment_method = 'online' THEN 'awaiting_payment' ELSE 'pending' END, v_subtotal, v_delivery, v_total, 'TRY',
    btrim(p_delivery_address), nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method, 'pending',
    v_rate, v_commission, v_discount, CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.code END
  ) RETURNING * INTO v_order;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, title_snapshot, unit_price_cents, quantity, line_total_cents)
    VALUES (v_order.id, (v_line->>'menu_item_id')::uuid, v_line->>'title',
            (v_line->>'unit')::integer, (v_line->>'qty')::integer, (v_line->>'line')::integer);
  END LOOP;

  IF v_coupon.id IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions (coupon_id, user_id, order_id)
    VALUES (v_coupon.id, v_uid, v_order.id);
  END IF;

  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.orders_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_seller boolean;
  v_is_customer boolean;
  v_status_ok boolean := FALSE;
BEGIN
  IF v_uid IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;

  -- Para ve kimlik alanları kimse tarafından (admin hariç) değiştirilemez.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.delivery_fee_cents IS DISTINCT FROM OLD.delivery_fee_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.coupon_code IS DISTINCT FROM OLD.coupon_code
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.commission_cents IS DISTINCT FROM OLD.commission_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sipariş tutarı ve temel bilgileri değiştirilemez' USING ERRCODE = '42501';
  END IF;

  v_is_customer := coalesce(OLD.customer_id = v_uid, FALSE);
  v_is_seller := EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = OLD.seller_id AND s.user_id = v_uid);

  -- Durum geçişi
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_is_seller THEN
      v_status_ok := CASE OLD.status
        WHEN 'pending'          THEN NEW.status IN ('accepted', 'cancelled')
        WHEN 'accepted'         THEN NEW.status IN ('preparing', 'cancelled')
        WHEN 'preparing'        THEN NEW.status IN ('ready', 'cancelled')
        WHEN 'ready'            THEN NEW.status IN ('out_for_delivery', 'delivered', 'cancelled')
        WHEN 'out_for_delivery' THEN NEW.status IN ('delivered', 'cancelled')
        ELSE FALSE
      END;
    END IF;
    IF NOT v_status_ok AND v_is_customer THEN
      v_status_ok := (NEW.status = 'cancelled' AND OLD.status IN ('awaiting_payment', 'pending', 'accepted'));
    END IF;
    IF NOT v_status_ok THEN
      RAISE EXCEPTION 'Geçersiz sipariş durumu değişikliği: % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Ödeme durumu: yalnızca satıcı, teslimde 'pending' -> 'paid' (nakit / kapıda kart tahsilatı)
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NOT (v_is_seller AND OLD.payment_status = 'pending' AND NEW.payment_status = 'paid'
            AND NEW.status = 'delivered') THEN
      RAISE EXCEPTION 'Ödeme durumu bu şekilde değiştirilemez' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- İade: müşteri yalnızca teslim edilmiş siparişte talep açabilir; onay / ret yöneticide.
  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status THEN
    IF NOT (v_is_customer AND coalesce(OLD.refund_status, 'none') = 'none'
            AND NEW.refund_status = 'requested' AND OLD.status = 'delivered') THEN
      RAISE EXCEPTION 'İade durumu bu şekilde değiştirilemez' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Açıklamalar yalnızca ilgili işlemle birlikte yazılır, sonradan değiştirilemez.
  IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
     AND NOT (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
    RAISE EXCEPTION 'İptal nedeni sonradan değiştirilemez' USING ERRCODE = '42501';
  END IF;
  IF NEW.refund_reason IS DISTINCT FROM OLD.refund_reason
     AND NEW.refund_status IS NOT DISTINCT FROM OLD.refund_status THEN
    RAISE EXCEPTION 'İade nedeni sonradan değiştirilemez' USING ERRCODE = '42501';
  END IF;

  IF length(coalesce(NEW.cancel_reason, '')) > 500 OR length(coalesce(NEW.refund_reason, '')) > 500 THEN
    RAISE EXCEPTION 'Açıklama çok uzun' USING ERRCODE = '22001';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_user uuid;
  v_seller_name text;
  v_data  jsonb := jsonb_build_object('orderId', NEW.id);
  v_short text := left(NEW.id::text, 8);
  v_title text;
BEGIN
  SELECT user_id, display_name INTO v_seller_user, v_seller_name FROM public.sellers WHERE id = NEW.seller_id;

  -- Online sipariş satıcıya ödeme alındıktan sonra görünür.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'awaiting_payment' THEN
      PERFORM public.notify_user(v_seller_user, 'Yeni sipariş 🛎️', 'Sipariş #' || v_short || ' onayınızı bekliyor.', 'order_status', v_data);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'pending' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş 🛎️', 'Sipariş #' || v_short || ' onayınızı bekliyor.', 'order_status', v_data);
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.notify_user(NEW.customer_id, 'Ödemeniz iade edildi', 'Sipariş #' || v_short, 'order_status', v_data);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := CASE NEW.status
      WHEN 'accepted'         THEN 'Siparişiniz kabul edildi ✅'
      WHEN 'preparing'        THEN 'Siparişiniz hazırlanıyor 🍳'
      WHEN 'ready'            THEN 'Siparişiniz hazır 🎉'
      WHEN 'out_for_delivery' THEN 'Siparişiniz yolda 🛵'
      WHEN 'delivered'        THEN 'Siparişiniz teslim edildi ✓'
      WHEN 'cancelled'        THEN 'Siparişiniz iptal edildi'
    END;
    IF v_title IS NOT NULL AND NEW.customer_id IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(NEW.customer_id, v_title, v_seller_name || ' · Sipariş #' || v_short, 'order_status', v_data);
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status <> 'awaiting_payment' AND v_seller_user IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(v_seller_user, 'Sipariş iptal edildi', 'Sipariş #' || v_short || ' iptal edildi.', 'order_status', v_data);
    END IF;
  END IF;

  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status THEN
    IF NEW.refund_status = 'requested' THEN
      PERFORM public.notify_user(v_seller_user, 'İade talebi', 'Sipariş #' || v_short || ' için iade talep edildi.', 'order_status', v_data);
    ELSIF NEW.refund_status IN ('approved', 'rejected') THEN
      PERFORM public.notify_user(
        NEW.customer_id,
        CASE NEW.refund_status WHEN 'approved' THEN 'İade talebiniz onaylandı' ELSE 'İade talebiniz reddedildi' END,
        'Sipariş #' || v_short, 'order_status', v_data);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Yalnızca Edge Function'lar (service role) ve yönetici okur; token ve işlem numaraları burada durur.
CREATE TABLE IF NOT EXISTS public.order_payments (
  order_id     UUID        PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  provider     TEXT        NOT NULL DEFAULT 'iyzico',
  token        TEXT        UNIQUE,
  payment_id   TEXT,
  transactions JSONB       NOT NULL DEFAULT '[]'::jsonb,
  last_error   TEXT,
  paid_at      TIMESTAMPTZ,
  refunded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payments FROM anon, authenticated;
GRANT SELECT ON public.order_payments TO authenticated;
DROP POLICY IF EXISTS "Admin ödemeleri görebilir" ON public.order_payments;
CREATE POLICY "Admin ödemeleri görebilir" ON public.order_payments FOR SELECT USING (public.is_admin());

-- orders_guard'dan SONRA çalışmalı (tetikleyiciler ada göre sıralanır): satıcının ve müşterinin
-- ödeme durumunu değiştirmesi yasak, ama bu değişikliği sistem yapıyor.
CREATE OR REPLACE FUNCTION public.orders_flag_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_method = 'online' AND OLD.payment_status = 'paid'
     AND ((NEW.status = 'cancelled' AND OLD.status <> 'cancelled')
          OR (NEW.refund_status = 'approved' AND OLD.refund_status IS DISTINCT FROM 'approved')) THEN
    NEW.payment_status := 'refund_pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_zz_flag_refund_trg ON public.orders;
CREATE TRIGGER orders_zz_flag_refund_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_flag_refund();

CREATE OR REPLACE FUNCTION public.record_payment_init(p_order uuid, p_token text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.order_payments (order_id, token) VALUES (p_order, p_token)
  ON CONFLICT (order_id) DO UPDATE SET token = EXCLUDED.token, last_error = NULL;
$$;

-- Ödeme sonucunu işler; aynı sonuç birden fazla gelebilir. Sonucu metin olarak döndürür:
-- paid, already_paid, refund_pending (sipariş ödeme gelmeden iptal olmuş, para iade edilmeli).
CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order uuid, p_payment_id text, p_transactions jsonb, p_paid_cents integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.payment_method <> 'online' THEN
    RAISE EXCEPTION 'Sipariş online ödemeli değil' USING ERRCODE = '22023';
  END IF;
  IF p_paid_cents <> v_order.total_cents THEN
    RAISE EXCEPTION 'Ödenen tutar sipariş tutarıyla uyuşmuyor' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_payments
     SET payment_id = p_payment_id, transactions = coalesce(p_transactions, '[]'::jsonb),
         paid_at = coalesce(paid_at, now()), last_error = NULL
   WHERE order_id = p_order;

  IF v_order.payment_status <> 'pending' THEN
    RETURN 'already_paid';
  END IF;
  IF v_order.status = 'cancelled' THEN
    UPDATE public.orders SET payment_status = 'refund_pending', updated_at = now() WHERE id = p_order;
    RETURN 'refund_pending';
  END IF;
  UPDATE public.orders SET status = 'pending', payment_status = 'paid', updated_at = now() WHERE id = p_order;
  RETURN 'paid';
END $$;

CREATE OR REPLACE FUNCTION public.mark_order_refunded(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
   WHERE id = p_order AND payment_status = 'refund_pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş iade beklemiyor' USING ERRCODE = '55000';
  END IF;
  UPDATE public.order_payments SET refunded_at = now(), last_error = NULL WHERE order_id = p_order;
END $$;

CREATE OR REPLACE FUNCTION public.record_payment_error(p_order uuid, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.order_payments SET last_error = left(p_error, 500) WHERE order_id = p_order;
$$;

-- Ödemesi tamamlanmayan siparişleri iptal eder; stok ve kupon hakkı tetikleyicilerle geri döner.
CREATE OR REPLACE FUNCTION public.expire_unpaid_orders(p_minutes integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.orders
     SET status = 'cancelled', cancel_reason = 'Ödeme tamamlanmadı', updated_at = now()
   WHERE status = 'awaiting_payment' AND created_at < now() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'record_payment_init(uuid, text)',
    'mark_order_paid(uuid, text, jsonb, integer)',
    'mark_order_refunded(uuid)',
    'record_payment_error(uuid, text)',
    'expire_unpaid_orders(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
