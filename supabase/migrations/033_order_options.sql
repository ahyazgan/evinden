-- 033: Sipariş seçenekleri: kapıda yemek kartı, planlı sipariş, gelip alma, bahşiş.
-- Kuralların hepsi sunucuda; istemci yalnızca seçimi gönderir.
--
-- Yemek kartı: yalnızca kapıda (kasada) ödenir, online kabul için kart şirketleriyle sözleşme gerekir.
--   Hesapta 'card_door' ile aynıdır: para satıcıdadır, komisyonu platforma borçludur. Bakiye hesabı
--   "online değilse para satıcıda" diye yazıldığı için ayrı dal gerekmez.
-- Bahşiş: müşterinin ödediği tutara girer, tamamı satıcıya kalır; komisyon alınmaz, platform payı yoktur.
--   İade edilen sipariş bahşişi de geri verir: iyzico işlemleri total_cents üzerinden iade edilir,
--   hesap kesiminin ters kaydı da bakiyenin tamamını (bahşiş dahil) geri alır.

BEGIN;

-- ── 1. Kolonlar ────────────────────────────────────────────────────────────

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS meal_cards text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS accepts_scheduled boolean NOT NULL DEFAULT TRUE;
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS pickup_enabled boolean NOT NULL DEFAULT FALSE;

ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_meal_cards_known;
ALTER TABLE public.sellers ADD CONSTRAINT sellers_meal_cards_known CHECK (
  meal_cards <@ ARRAY['multinet','pluxee','setcard','metropol','edenred']::text[]
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_reminded_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_check CHECK (fulfillment IN ('delivery', 'pickup'));
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tip_cents_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_tip_cents_check CHECK (tip_cents BETWEEN 0 AND 50000);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_tip_delivery_only;
ALTER TABLE public.orders ADD CONSTRAINT orders_tip_delivery_only CHECK (fulfillment = 'delivery' OR tip_cents = 0);

-- Seçenekler siparişle yazılır, sonradan değişmez. Bahşiş tutarı hesabı etkilediği için yönetici de
-- değiştiremez (hesap kesimi alanları gibi). Gelip alınacak sipariş hiçbir yoldan "yolda" olamaz;
-- kurye konumu yalnızca bu durumda yazıldığı için konum paylaşımı da başlayamaz (032).
CREATE OR REPLACE FUNCTION public.orders_options_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public._internal_call() AND (
       NEW.fulfillment IS DISTINCT FROM OLD.fulfillment
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR NEW.scheduled_reminded_at IS DISTINCT FROM OLD.scheduled_reminded_at
    OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents
  ) THEN
    RAISE EXCEPTION 'Sipariş seçenekleri değiştirilemez' USING ERRCODE = '42501';
  END IF;
  IF NEW.fulfillment = 'pickup' AND NEW.status = 'out_for_delivery' THEN
    RAISE EXCEPTION 'Gelip alınacak sipariş yola çıkamaz' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_options_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_options_guard_trg ON public.orders;
CREATE TRIGGER orders_options_guard_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_options_guard();

-- ── 2. place_order ─────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, text, text, text, text, integer, numeric, numeric, text);

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

-- ── 3. Hesap: bahşiş tamamen satıcının ─────────────────────────────────────
-- Aynı hesap istemcide lib/earnings.ts içinde; test ikisini karşılaştırır.
-- Bakiye fonksiyonu değişmedi: online değilse (kapıda yemek kartı dahil) para satıcıdadır, bahşiş
-- hem hakkına hem aldığı paraya girdiği için bakiyeye etkisi olmaz; online ödemede platform aktarır.
-- order_open_amount_cents de order_balance_cents'i kullandığı için ters kayıt bahşişi de geri alır.

CREATE OR REPLACE FUNCTION public.order_net_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT o.subtotal_cents + o.delivery_fee_cents + o.platform_delivery_cents + o.tip_cents
         - o.seller_discount_cents - o.commission_cents;
$$;

-- Rapora bahşiş satırı eklendi; dönüş tipi değiştiği için yeniden oluşturulur.
DROP FUNCTION IF EXISTS public.get_my_earnings(timestamptz, timestamptz);
CREATE FUNCTION public.get_my_earnings(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  order_count integer, gross_cents integer, seller_discount_cents integer, commission_cents integer,
  net_cents integer, collected_cents integer, open_balance_cents integer, open_order_count integer, held_count integer,
  tip_cents integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller uuid;
  v_open public.seller_open_total;
BEGIN
  SELECT s.id INTO v_seller FROM public.sellers s WHERE s.user_id = auth.uid();
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'Satıcı hesabı bulunamadı' USING ERRCODE = '42501';
  END IF;
  v_open := public.seller_open_totals(v_seller);
  RETURN QUERY
  SELECT count(*)::integer,
         coalesce(sum(o.subtotal_cents + o.delivery_fee_cents + o.platform_delivery_cents), 0)::integer,
         coalesce(sum(o.seller_discount_cents), 0)::integer,
         coalesce(sum(o.commission_cents), 0)::integer,
         coalesce(sum(public.order_net_cents(o)), 0)::integer,
         coalesce(sum(CASE WHEN o.payment_method = 'online' THEN 0 ELSE o.total_cents END), 0)::integer,
         v_open.balance_cents, v_open.order_count, v_open.held_count,
         coalesce(sum(o.tip_cents), 0)::integer
    FROM public.orders o
   WHERE o.seller_id = v_seller
     AND public.order_counts_as_sale(o)
     AND o.delivered_at >= p_from AND o.delivered_at < p_to;
END $$;
REVOKE ALL ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) TO authenticated;

-- Platformun "satış" toplamına bahşiş girmez.
CREATE OR REPLACE FUNCTION public.admin_platform_totals()
RETURNS TABLE (delivered_count bigint, sales_cents bigint, commission_cents bigint, payable_cents bigint, receivable_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sales AS (
    SELECT count(*) AS n, coalesce(sum(o.total_cents - o.tip_cents), 0) AS total, coalesce(sum(o.commission_cents), 0) AS commission
      FROM public.orders o WHERE public.order_counts_as_sale(o)
  ), balances AS (
    SELECT (public.seller_open_totals(s.id)).balance_cents AS b FROM public.sellers s
  )
  SELECT sales.n, sales.total::bigint, sales.commission::bigint,
         coalesce((SELECT sum(b) FROM balances WHERE b > 0), 0)::bigint,
         coalesce((SELECT -sum(b) FROM balances WHERE b < 0), 0)::bigint
    FROM sales;
END $$;

-- Sadakat puanı platformun verdiği bir değer: bahşişten puan kazanılmaz.
CREATE OR REPLACE FUNCTION public.orders_award_loyalty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.loyalty%ROWTYPE;
  v_mult   numeric;
  v_orders integer;
  v_code   text;
  v_spent  integer := NEW.total_cents - NEW.tip_cents;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.loyalty (user_id) VALUES (NEW.customer_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.loyalty WHERE user_id = NEW.customer_id FOR UPDATE;

  v_mult := CASE v_row.tier WHEN 'platinum' THEN 2 WHEN 'gold' THEN 1.5 WHEN 'silver' THEN 1.25 ELSE 1 END;
  v_orders := v_row.total_orders + 1;

  UPDATE public.loyalty
     SET points = points + floor(v_spent / 100.0 * v_mult)::integer,
         total_orders = v_orders,
         total_spent = total_spent + v_spent,
         tier = CASE WHEN v_orders >= 30 THEN 'platinum' WHEN v_orders >= 15 THEN 'gold'
                     WHEN v_orders >= 5 THEN 'silver' ELSE 'bronze' END,
         free_deliveries_earned = free_deliveries_earned + CASE WHEN v_orders % 10 = 0 THEN 1 ELSE 0 END,
         last_order_date = now(),
         updated_at = now()
   WHERE user_id = NEW.customer_id;

  IF v_orders % 10 = 0 THEN
    v_code := public.issue_personal_coupon(NEW.customer_id, 'free_delivery', 0, 'Ücretsiz Teslimat');
    PERFORM public.notify_user(NEW.customer_id, 'Ücretsiz teslimat kazandınız 🎉',
      'Kupon kodunuz: ' || v_code, 'promo', jsonb_build_object('couponCode', v_code));
  END IF;
  RETURN NEW;
END $$;

-- ── 4. Bildirimler ─────────────────────────────────────────────────────────
-- 030 ile aynı; yeni sipariş planlıysa saati yazılır, gelip almada müşteriye gelmesi söylenir.

CREATE OR REPLACE FUNCTION public.orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_user uuid;
  v_seller_name text;
  v_data  jsonb := jsonb_build_object('orderId', NEW.id);
  v_short text := left(NEW.id::text, 8);
  v_title text;
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
      PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_data);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'pending' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_data);
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
        CASE NEW.refund_status WHEN 'approved' THEN 'İade talebin onaylandı' ELSE 'İade talebin reddedildi' END,
        'Sipariş #' || v_short, 'order_status', v_data);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 028'deki görevle aynı; ek olarak kabul edilmiş planlı sipariş saatine bir saat kala satıcıya
-- hatırlatılır. Görev zaten iki dakikada bir çalışıyor (029), yeni zamanlama gerekmez.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer;
BEGIN
  FOR v_row IN
    SELECT o.id, s.user_id
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'pending'
       AND o.pending_reminded_at IS NULL
       AND COALESCE(o.pending_since, o.created_at) < now() - make_interval(mins => p_remind_minutes)
       AND COALESCE(o.pending_since, o.created_at) >= now() - make_interval(mins => p_cancel_minutes)
  LOOP
    PERFORM public.notify_user(
      v_row.user_id,
      'Bekleyen siparişin var',
      'Yanıtlamazsan sipariş iptal edilecek.',
      'order_status',
      jsonb_build_object('orderId', v_row.id)
    );
    UPDATE public.orders SET pending_reminded_at = now() WHERE id = v_row.id;
  END LOOP;

  FOR v_row IN
    SELECT o.id, s.user_id, o.scheduled_for
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'accepted'
       AND o.scheduled_reminded_at IS NULL
       AND o.scheduled_for > now()
       AND o.scheduled_for <= now() + interval '60 minutes'
  LOOP
    PERFORM public.notify_user(
      v_row.user_id,
      'Planlı sipariş yaklaşıyor',
      'Sipariş #' || left(v_row.id::text, 8) || ' saat '
        || to_char(v_row.scheduled_for AT TIME ZONE 'Europe/Istanbul', 'HH24:MI') || ' için planlı.',
      'order_status',
      jsonb_build_object('orderId', v_row.id)
    );
    UPDATE public.orders SET scheduled_reminded_at = now() WHERE id = v_row.id;
  END LOOP;

  UPDATE public.orders
     SET status = 'cancelled', cancel_reason = 'Satıcı zamanında yanıtlamadı', updated_at = now()
   WHERE status = 'pending'
     AND COALESCE(pending_since, created_at) < now() - make_interval(mins => p_cancel_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.expire_pending_orders(integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;
