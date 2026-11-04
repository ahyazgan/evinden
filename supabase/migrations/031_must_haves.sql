-- Canlı öncesi zorunlular: alerjen bilgisi, sipariş onayı kaydı, destek talepleri, telefon doğrulama.

-- ── 1. Alerjen ──────────────────────────────────────────────
-- NULL: satıcı belirtmedi. Boş dizi: alerjen içermiyor. İkisi farklı anlam taşır.
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS allergens text[];

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_allergens_known;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_allergens_known CHECK (
  allergens IS NULL OR allergens <@ ARRAY[
    'gluten','milk','egg','peanut','tree_nut','sesame','soy','fish','crustacean','mollusc',
    'celery','mustard','sulphite','lupin'
  ]::text[]
);

-- ── 2. Sipariş onayı ────────────────────────────────────────
-- Müşterinin hangi metni ne zaman kabul ettiği kayıt altına alınır; sonradan değiştirilemez.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

CREATE OR REPLACE FUNCTION public.orders_terms_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.terms_version := OLD.terms_version;
  NEW.terms_accepted_at := OLD.terms_accepted_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_terms_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_terms_immutable_trg ON public.orders;
CREATE TRIGGER orders_terms_immutable_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_terms_immutable();

DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric);

CREATE OR REPLACE FUNCTION public.place_order(
  p_seller_id        uuid,
  p_items            jsonb,
  p_delivery_address text,
  p_notes            text DEFAULT NULL,
  p_payment_method   text DEFAULT 'cash',
  p_coupon_code      text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL,
  p_delivery_lat     numeric DEFAULT NULL,
  p_delivery_lng     numeric DEFAULT NULL,
  p_terms_version    text DEFAULT NULL
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
  v_seller_discount integer := 0;
  v_platform_delivery integer := 0;
  v_platform_fee integer;
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
  v_platform_fee := v_fee;
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
    IF v_coupon.seller_id IS NOT NULL AND v_coupon.seller_id <> p_seller_id THEN
      RAISE EXCEPTION 'Bu kupon yalnızca kuponu veren satıcıda geçerli' USING ERRCODE = '22023';
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
      -- Platform kuponunda teslimat bedelini platform üstlenir, ama en çok kendi ücreti kadar:
      -- satıcı kendi ücretini yüksek girip platformdan para çekemesin, fazlası satıcıya kalır.
      IF v_coupon.seller_id IS NULL THEN
        v_platform_delivery := least(v_delivery, v_platform_fee);
      END IF;
      v_delivery := 0;
    END IF;
    IF v_coupon.seller_id IS NOT NULL THEN
      v_seller_discount := v_discount;
    END IF;
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  v_total := greatest(v_subtotal + v_delivery - v_discount, 0);
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents <> v_total THEN
    RAISE EXCEPTION 'Sipariş tutarı değişti' USING ERRCODE = 'EVN01', DETAIL = v_total::text;
  END IF;
  -- Satıcının kendi indirimi satış tutarını düşürür; komisyon kalan tutardan alınır.
  v_commission := round((v_subtotal - v_seller_discount) * v_rate / 100.0)::integer;
  IF p_payment_method = 'online' AND v_total <= 0 THEN
    RAISE EXCEPTION 'Ödenecek tutar yok, kapıda ödemeyi seçin' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (
    customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
    delivery_address, notes, payment_method, payment_status,
    commission_rate, commission_cents, discount_cents, coupon_code, seller_discount_cents, platform_delivery_cents,
    terms_version, terms_accepted_at
  ) VALUES (
    v_uid, p_seller_id, CASE WHEN p_payment_method = 'online' THEN 'awaiting_payment' ELSE 'pending' END, v_subtotal, v_delivery, v_total, 'TRY',
    btrim(p_delivery_address), nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method, 'pending',
    v_rate, v_commission, v_discount, CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.code END, v_seller_discount, v_platform_delivery,
    nullif(btrim(coalesce(p_terms_version, '')), ''), CASE WHEN nullif(btrim(coalesce(p_terms_version, '')), '') IS NOT NULL THEN now() END
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
REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric, text) TO authenticated;

-- ── 3. Destek talepleri ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  order_id   uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  category   text NOT NULL CHECK (category IN ('order', 'payment', 'account', 'seller', 'other')),
  message    text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 2000),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  reply      text,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON public.support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets (status, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.support_tickets FROM anon, authenticated;

DROP POLICY IF EXISTS "support_tickets_select" ON public.support_tickets;
CREATE POLICY "support_tickets_select" ON public.support_tickets FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_category text,
  p_message  text,
  p_order    uuid DEFAULT NULL
) RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.support_tickets;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Destek talebi için giriş yap' USING ERRCODE = '42501';
  END IF;
  IF p_order IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders o
    LEFT JOIN public.sellers s ON s.id = o.seller_id
    WHERE o.id = p_order AND (o.customer_id = v_uid OR s.user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.support_tickets
      WHERE user_id = v_uid AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'Bugün çok fazla talep açtın, yarın tekrar dene' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.support_tickets (user_id, order_id, category, message)
  VALUES (v_uid, p_order, p_category, btrim(p_message))
  RETURNING * INTO v_row;

  PERFORM public.notify_user(u.id, 'Yeni destek talebi', left(v_row.message, 80), 'support',
                             jsonb_build_object('ticketId', v_row.id))
  FROM public.users u WHERE u.role = 'admin';

  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_support_tickets(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, user_id uuid, user_name text, order_id uuid, category text, message text,
  status text, reply text, replied_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.user_id, u.name, t.order_id, t.category, t.message, t.status, t.reply, t.replied_at, t.created_at
    FROM public.support_tickets t
    JOIN public.users u ON u.id = t.user_id
    WHERE p_status IS NULL OR t.status = p_status
    ORDER BY t.created_at DESC
    LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_support_tickets(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_support_tickets(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_answer_support_ticket(p_ticket uuid, p_reply text)
RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.support_tickets;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reply, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Yanıt boş olamaz' USING ERRCODE = '55000';
  END IF;
  UPDATE public.support_tickets
  SET reply = btrim(p_reply), replied_at = now(), status = 'answered'
  WHERE id = p_ticket
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Talep bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.notify_user(v_row.user_id, 'Destek talebin yanıtlandı', left(v_row.reply, 80), 'support',
                             jsonb_build_object('ticketId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_answer_support_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_answer_support_ticket(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_close_support_ticket(p_ticket uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_tickets SET status = 'closed' WHERE id = p_ticket;
END $$;
REVOKE ALL ON FUNCTION public.admin_close_support_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_support_ticket(uuid) TO authenticated;

-- ── 4. Telefon doğrulama ────────────────────────────────────
-- Kapalı başlar: Supabase'de SMS sağlayıcısı kurulmadan açılırsa kimse sipariş veremez.
INSERT INTO public.app_config (key, value) VALUES ('phone_verification', '{"required": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.orders_require_verified_phone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF (SELECT (value->>'required')::boolean FROM public.app_config WHERE key = 'phone_verification') IS TRUE
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND phone_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Sipariş vermek için telefonunu doğrula' USING ERRCODE = 'EVN02';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_require_verified_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_require_verified_phone_trg ON public.orders;
CREATE TRIGGER orders_require_verified_phone_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_require_verified_phone();
