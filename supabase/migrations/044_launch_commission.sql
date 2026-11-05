-- Satıcıya özel komisyon oranı. Lansman döneminde kuryesi olmayan işletmeler için ayrı oran verilebilir.
--
-- Oran sellers tablosuna eklenmedi: o tabloyu müşteriler de okur ve satıcı kendi satırını güncelleyebilir.
-- Ayrı tabloda yalnızca yönetici yazar, satıcı yalnızca kendi oranını görür. Kayıt yoksa 010/016'daki
-- tür oranı (app_config.order_pricing) uygulanır.
--
-- Örnek (yönetici, SQL Editor):
--   INSERT INTO public.seller_commission_rates (seller_id, rate_percent, note)
--   VALUES ('<satici-id>', 8, 'lansman, kuryesi yok')
--   ON CONFLICT (seller_id) DO UPDATE SET rate_percent = EXCLUDED.rate_percent, note = EXCLUDED.note, updated_at = now();

CREATE TABLE IF NOT EXISTS public.seller_commission_rates (
  seller_id    uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  rate_percent numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 50),
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_commission_rates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_commission_rates FROM anon;

DROP POLICY IF EXISTS "Yönetici komisyon oranlarını yönetir" ON public.seller_commission_rates;
CREATE POLICY "Yönetici komisyon oranlarını yönetir" ON public.seller_commission_rates
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Satıcı kendi oranını görür" ON public.seller_commission_rates;
CREATE POLICY "Satıcı kendi oranını görür" ON public.seller_commission_rates
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

-- ── Lansman: restoran oranı %7 (kendi kuryesi olan restoranlar) ───────────────
UPDATE public.app_config
   SET value = jsonb_set(value, '{restaurant_commission_rate_percent}', '7'::jsonb), updated_at = now()
 WHERE key = 'order_pricing';

-- ── place_order: 040 ile aynı, satıcıya özel oran eklendi ─────────────────────

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
  p_terms_version    text DEFAULT NULL,
  p_fulfillment      text DEFAULT 'delivery',
  p_scheduled_for    timestamptz DEFAULT NULL,
  p_tip_cents        integer DEFAULT 0
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_cfg       jsonb;
  v_fee       integer;
  v_free_over integer;
  v_rate      numeric;
  v_override  numeric;
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
  v_option_ids uuid[];
  v_grp       record;
  v_today     date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  -- Yemeğin servis edileceği gün: planlı siparişte seçilen gün, yoksa bugün.
  v_serve_date date := (coalesce(p_scheduled_for, now()) AT TIME ZONE 'Europe/Istanbul')::date;
  v_dow       integer := extract(isodow FROM (coalesce(p_scheduled_for, now()) AT TIME ZONE 'Europe/Istanbul'))::integer - 1;
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
  v_fulfillment text := coalesce(p_fulfillment, 'delivery');
  v_pickup    boolean := coalesce(p_fulfillment, 'delivery') = 'pickup';
  v_tip       integer := coalesce(p_tip_cents, 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sipariş için giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  IF p_payment_method NOT IN ('cash', 'card_door', 'meal_card_door', 'online') THEN
    RAISE EXCEPTION 'Bu ödeme yöntemi şu an desteklenmiyor' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'online' AND NOT public.online_payment_enabled() THEN
    RAISE EXCEPTION 'Online ödeme şu an kullanılamıyor' USING ERRCODE = '22023';
  END IF;
  IF v_fulfillment NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'Teslim şekli geçersiz' USING ERRCODE = '22023';
  END IF;
  IF v_tip < 0 OR v_tip > 50000 THEN
    RAISE EXCEPTION 'Bahşiş en çok ₺500 olabilir' USING ERRCODE = '22023';
  END IF;
  IF v_pickup AND v_tip > 0 THEN
    RAISE EXCEPTION 'Gelip alırken bahşiş eklenmez' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Sepet geçersiz' USING ERRCODE = '22023';
  END IF;
  -- Gelip almada istemcinin gönderdiği adres yok sayılır, aşağıda işaret metni yazılır.
  IF NOT v_pickup AND (p_delivery_address IS NULL OR length(btrim(p_delivery_address)) < 5 OR length(p_delivery_address) > 500) THEN
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
  -- Geçici kapanan restoran planlı sipariş de almaz: onaylayacak kimse yok, sipariş boşuna iptal olur.
  IF v_seller.is_paused THEN
    RAISE EXCEPTION 'Bu satıcı şu an kapalı' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_for IS NULL THEN
    IF NOT public.seller_open_at(p_seller_id, now()) THEN
      RAISE EXCEPTION 'Bu satıcı şu an kapalı' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Planlı siparişte önemli olan seçilen saat: restoran şu an kapalı olabilir. Onay süresi normal
    -- siparişle aynıdır (expire_pending_orders), restoran hemen kabul veya reddeder.
    IF NOT v_seller.accepts_scheduled THEN
      RAISE EXCEPTION 'Bu restoran ileri tarihli sipariş almıyor' USING ERRCODE = '22023';
    END IF;
    IF p_scheduled_for < now() + interval '45 minutes' THEN
      RAISE EXCEPTION 'En erken 45 dakika sonrasına sipariş verebilirsin' USING ERRCODE = '22023';
    END IF;
    IF p_scheduled_for > now() + interval '7 days' THEN
      RAISE EXCEPTION 'En çok 7 gün sonrasına sipariş verebilirsin' USING ERRCODE = '22023';
    END IF;
    IF NOT public.seller_open_at(p_seller_id, p_scheduled_for) THEN
      RAISE EXCEPTION 'Restoran seçtiğin saatte kapalı' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazanızdan sipariş veremezsiniz' USING ERRCODE = '22023';
  END IF;
  IF v_pickup AND NOT v_seller.pickup_enabled THEN
    RAISE EXCEPTION 'Bu restoranda gelip alma yok' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'meal_card_door' AND cardinality(v_seller.meal_cards) = 0 THEN
    RAISE EXCEPTION 'Bu restoran yemek kartı kabul etmiyor' USING ERRCODE = '22023';
  END IF;
  IF v_seller.seller_type = 'restaurant' THEN
    v_rate := coalesce((v_cfg->>'restaurant_commission_rate_percent')::numeric, 1);
  END IF;
  -- Satıcıya özel oran (lansman, anlaşmalı oran) tür oranının yerine geçer.
  SELECT rate_percent INTO v_override FROM public.seller_commission_rates WHERE seller_id = p_seller_id;
  IF FOUND THEN
    v_rate := v_override;
  END IF;

  -- Satıcının kendi ayarı varsa platform varsayılanının yerine geçer.
  v_fee       := coalesce(v_seller.delivery_fee_cents, v_fee);
  v_free_over := coalesce(v_seller.free_delivery_threshold_cents, v_free_over);
  v_min       := greatest(v_min, v_seller.min_order_cents);

  -- Konumu bilinen satıcı yalnızca teslimat alanına sipariş alır. Gelip almada teslimat yok.
  IF NOT v_pickup AND v_seller.latitude IS NOT NULL AND v_seller.longitude IS NOT NULL THEN
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
    -- Haftalık menüde bakılan gün, yemeğin servis edileceği gündür.
    IF v_seller.uses_weekly_menu AND NOT EXISTS (
      SELECT 1 FROM public.weekly_menu w
       WHERE w.menu_item_id = v_mi.id AND w.day_of_week = v_dow AND w.is_active
    ) THEN
      IF p_scheduled_for IS NULL THEN
        RAISE EXCEPTION '% bugünkü menüde yok', v_mi.title USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION '% seçtiğin günün menüsünde yok', v_mi.title USING ERRCODE = '22023';
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

    -- Seçim grupları: seçimler yalnızca bu ürüne ait açık seçeneklerden olur, her grubun kuralı
    -- burada denetlenir. Hiç seçim göndermeyen eski uygulama da zorunlu gruba takılır.
    v_option_ids := '{}';
    IF jsonb_typeof(v_el->'option_ids') = 'array' AND jsonb_array_length(v_el->'option_ids') > 0 THEN
      SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_option_ids
        FROM jsonb_array_elements_text(v_el->'option_ids') AS x;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_option_ids) AS sel(id)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.menu_options o
           JOIN public.menu_option_groups g ON g.id = o.group_id
          WHERE o.id = sel.id AND g.menu_item_id = v_mi.id AND o.is_available
       )
    ) THEN
      RAISE EXCEPTION '% için seçtiğin bir seçenek artık yok. Ürünü sepetten çıkarıp yeniden ekle.', v_mi.title USING ERRCODE = '22023';
    END IF;
    FOR v_grp IN
      SELECT g.title, g.min_select, g.max_select,
             count(o.id)::integer AS picked,
             coalesce(sum(o.price_cents), 0)::integer AS price,
             string_agg(o.label, ', ' ORDER BY o.sort_order, o.label) AS labels
        FROM public.menu_option_groups g
        LEFT JOIN public.menu_options o ON o.group_id = g.id AND o.id = ANY (v_option_ids)
       WHERE g.menu_item_id = v_mi.id
       GROUP BY g.id
       ORDER BY g.sort_order, g.title
    LOOP
      IF v_grp.picked < v_grp.min_select THEN
        RAISE EXCEPTION '% için % seçimi eksik', v_mi.title, v_grp.title USING ERRCODE = '22023';
      END IF;
      IF v_grp.max_select IS NOT NULL AND v_grp.picked > v_grp.max_select THEN
        RAISE EXCEPTION '% için % en fazla % seçilebilir', v_mi.title, v_grp.title, v_grp.max_select USING ERRCODE = '22023';
      END IF;
      IF v_grp.picked > 0 THEN
        v_unit  := v_unit + v_grp.price;
        v_title := v_title || ' · ' || v_grp.title || ': ' || v_grp.labels;
      END IF;
    END LOOP;

    -- Günlük stok (0 = sınırsız). Sayaç yalnızca bugünü tutar (sold_today + stock_reset_date), gelecek
    -- günlerin sayacı yoktur. Bu yüzden günlük adetle sınırlı ürün, başka bir güne planlanan siparişte
    -- reddedilir: bugünden düşülse o günün satışı gereksiz azalır, servis gününde de limit aşılırdı.
    -- Bugüne planlanan sipariş normal sipariş gibi bugünün sayacından düşer; iptalde orders_restock
    -- aynı sayaca geri verir. Limiti olmayan ürün her güne planlanabilir.
    IF v_mi.daily_limit > 0 THEN
      IF v_serve_date <> v_today THEN
        RAISE EXCEPTION '% günlük adetle sınırlı, yalnızca bugün için sipariş verebilirsin', v_mi.title USING ERRCODE = '22023';
      END IF;
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

  v_delivery := CASE WHEN v_pickup OR v_subtotal >= v_free_over THEN 0 ELSE v_fee END;

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
    IF v_pickup AND v_coupon.discount_type = 'free_delivery' THEN
      RAISE EXCEPTION 'Ücretsiz teslimat kuponu gelip almada geçerli değil' USING ERRCODE = '22023';
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

  -- Bahşiş indirime girmez: müşteri ne yazdıysa o kadar eklenir.
  v_total := greatest(v_subtotal + v_delivery - v_discount, 0) + v_tip;
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents <> v_total THEN
    RAISE EXCEPTION 'Sipariş tutarı değişti' USING ERRCODE = 'EVN01', DETAIL = v_total::text;
  END IF;
  -- Satıcının kendi indirimi satış tutarını düşürür; komisyon kalan tutardan alınır. Bahşiş komisyona girmez.
  v_commission := round((v_subtotal - v_seller_discount) * v_rate / 100.0)::integer;
  IF p_payment_method = 'online' AND v_total <= 0 THEN
    RAISE EXCEPTION 'Ödenecek tutar yok, kapıda ödemeyi seçin' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (
    customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
    delivery_address, notes, payment_method, payment_status,
    commission_rate, commission_cents, discount_cents, coupon_code, seller_discount_cents, platform_delivery_cents,
    terms_version, terms_accepted_at, fulfillment, scheduled_for, tip_cents
  ) VALUES (
    v_uid, p_seller_id, CASE WHEN p_payment_method = 'online' THEN 'awaiting_payment' ELSE 'pending' END, v_subtotal, v_delivery, v_total, 'TRY',
    CASE WHEN v_pickup THEN 'Gelip alınacak' ELSE btrim(p_delivery_address) END, nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method, 'pending',
    v_rate, v_commission, v_discount, CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.code END, v_seller_discount, v_platform_delivery,
    nullif(btrim(coalesce(p_terms_version, '')), ''), CASE WHEN nullif(btrim(coalesce(p_terms_version, '')), '') IS NOT NULL THEN now() END,
    v_fulfillment, p_scheduled_for, v_tip
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
REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer) TO authenticated;
