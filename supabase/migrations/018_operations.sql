-- 018: Mağaza açık/kapalı, haftalık menü, bildirimler ve sunucu tarafı sadakat
--
--  1. sellers.is_paused: satıcı mağazasını kendisi kapatıp açar (is_active yönetici onayıdır).
--  2. Kapalı mağazaya ve bugünkü menüde olmayan ürüne place_order sipariş açmaz.
--     seller_hours.day_of_week ve weekly_menu.day_of_week: 0=Pazartesi ... 6=Pazar.
--  3. Sipariş ve iade durumları müşteri ile satıcıya bildirim olarak yazılır (push: 019).
--  4. Sadakat puanı istemciden yazılamaz: teslimde sunucuda verilir, ödüller kişiye özel kupona dönüşür.

BEGIN;

-- ── 1. Mağazayı kapat / aç ─────────────────────────────────────────────────

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Çalışma saatleri ────────────────────────────────────────────────────
-- Hiç saat girmemiş satıcı açık sayılır. Gece yarısını aşan saatler (18:00-02:00) desteklenir.

CREATE OR REPLACE FUNCTION public.seller_open_at(p_seller_id uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Europe/Istanbul';
  v_dow   integer := extract(isodow FROM v_local)::integer - 1;
  v_time  time := v_local::time;
  v_today public.seller_hours%ROWTYPE;
  v_prev  public.seller_hours%ROWTYPE;
BEGIN
  SELECT * INTO v_prev FROM public.seller_hours
   WHERE seller_id = p_seller_id AND day_of_week = (v_dow + 6) % 7;
  IF FOUND AND v_prev.is_open AND v_prev.close_time < v_prev.open_time AND v_time < v_prev.close_time THEN
    RETURN TRUE;
  END IF;

  SELECT * INTO v_today FROM public.seller_hours
   WHERE seller_id = p_seller_id AND day_of_week = v_dow;
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;
  IF NOT v_today.is_open THEN
    RETURN FALSE;
  END IF;
  IF v_today.open_time IS NULL OR v_today.close_time IS NULL THEN
    RETURN TRUE;
  END IF;
  IF v_today.close_time < v_today.open_time THEN
    RETURN v_time >= v_today.open_time;
  END IF;
  RETURN v_time >= v_today.open_time AND v_time < v_today.close_time;
END $$;

-- ── 3. Kişiye özel kuponlar ────────────────────────────────────────────────

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Herkes kuponları görebilir" ON public.coupons;
CREATE POLICY "Herkes kuponları görebilir"
  ON public.coupons FOR SELECT
  USING (owner_id IS NULL OR owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.place_order(
  p_seller_id        uuid,
  p_items            jsonb,
  p_delivery_address text,
  p_notes            text DEFAULT NULL,
  p_payment_method   text DEFAULT 'cash',
  p_coupon_code      text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL
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
  IF p_payment_method NOT IN ('cash', 'card_door') THEN
    RAISE EXCEPTION 'Bu ödeme yöntemi şu an desteklenmiyor' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Minimum sipariş tutarı karşılanmıyor' USING ERRCODE = '22023';
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

  INSERT INTO public.orders (
    customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
    delivery_address, notes, payment_method, payment_status,
    commission_rate, commission_cents, discount_cents, coupon_code
  ) VALUES (
    v_uid, p_seller_id, 'pending', v_subtotal, v_delivery, v_total, 'TRY',
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

-- ── 4. Bildirimler ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_user(p_user uuid, p_title text, p_body text, p_type text, p_data jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, body, type, data)
  SELECT p_user, p_title, p_body, p_type, p_data WHERE p_user IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

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

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş 🛎️', 'Sipariş #' || v_short || ' onayınızı bekliyor.', 'order_status', v_data);
    RETURN NEW;
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
    IF NEW.status = 'cancelled' AND v_seller_user IS DISTINCT FROM auth.uid() THEN
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

DROP TRIGGER IF EXISTS orders_notify_trg ON public.orders;
CREATE TRIGGER orders_notify_trg
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_notify();

-- Satıcı favorilerine eklemiş müşterilere duyuru yapar (örn. menüye yeni yemek).
CREATE OR REPLACE FUNCTION public.notify_my_followers(p_title text, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers%ROWTYPE;
BEGIN
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Yalnızca aktif satıcılar duyuru yapabilir' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_title, '')) NOT BETWEEN 1 AND 100 OR length(coalesce(p_body, '')) > 300 THEN
    RAISE EXCEPTION 'Duyuru metni geçersiz' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, data)
  SELECT f.user_id, p_title, p_body, 'seller_update', jsonb_build_object('sellerId', v_seller.id)
    FROM public.favorites f WHERE f.seller_id = v_seller.id;
END $$;
REVOKE ALL ON FUNCTION public.notify_my_followers(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_my_followers(text, text) TO authenticated;

-- ── 5. Sadakat ─────────────────────────────────────────────────────────────
-- Uygulamanın okuduğu kolonlar tabloda yoktu, istemcinin yazımları sessizce başarısız oluyordu.

ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS free_deliveries_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS streak_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_earnings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS last_order_date TIMESTAMPTZ;

DROP POLICY IF EXISTS "Kullanıcı sadakat oluşturabilir" ON public.loyalty;
DROP POLICY IF EXISTS "Kullanıcı sadakat güncelleyebilir" ON public.loyalty;
REVOKE INSERT, UPDATE, DELETE ON public.loyalty FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_personal_coupon(p_user uuid, p_type text, p_value integer, p_title text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := 'ODUL' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
BEGIN
  INSERT INTO public.coupons (code, title, discount_type, discount_value, min_order_cents,
                              max_uses, max_uses_per_user, owner_id, expires_at)
  VALUES (v_code, p_title, p_type, p_value, 0, 1, 1, p_user, now() + interval '90 days');
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.issue_personal_coupon(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;

-- Puan ve sipariş sayısı yalnızca teslimde işlenir: iptal edilen sipariş puan kazandırmaz.
-- 1 TL = 1 puan, seviyeye göre çarpılır. Her 10. siparişte ücretsiz teslimat kuponu verilir.
CREATE OR REPLACE FUNCTION public.orders_award_loyalty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.loyalty%ROWTYPE;
  v_mult   numeric;
  v_orders integer;
  v_code   text;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.loyalty (user_id) VALUES (NEW.customer_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.loyalty WHERE user_id = NEW.customer_id FOR UPDATE;

  v_mult := CASE v_row.tier WHEN 'platinum' THEN 2 WHEN 'gold' THEN 1.5 WHEN 'silver' THEN 1.25 ELSE 1 END;
  v_orders := v_row.total_orders + 1;

  UPDATE public.loyalty
     SET points = points + floor(NEW.total_cents / 100.0 * v_mult)::integer,
         total_orders = v_orders,
         total_spent = total_spent + NEW.total_cents,
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

DROP TRIGGER IF EXISTS orders_award_loyalty_trg ON public.orders;
CREATE TRIGGER orders_award_loyalty_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_award_loyalty();

-- Puan karşılığı kişiye özel kupon verir ve kodu döndürür. Bedeller lib/loyalty.ts REWARDS ile aynıdır.
CREATE OR REPLACE FUNCTION public.redeem_reward(p_reward_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cost  integer;
  v_type  text;
  v_value integer;
  v_title text;
  v_row   public.loyalty%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ödül için giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  CASE p_reward_id
    WHEN 'free_del' THEN v_cost := 50;  v_type := 'free_delivery'; v_value := 0;    v_title := 'Ücretsiz Teslimat';
    WHEN 'disc_10'  THEN v_cost := 80;  v_type := 'fixed';         v_value := 1000; v_title := '₺10 İndirim';
    WHEN 'disc_20'  THEN v_cost := 150; v_type := 'fixed';         v_value := 2000; v_title := '₺20 İndirim';
    WHEN 'disc_30'  THEN v_cost := 250; v_type := 'fixed';         v_value := 3000; v_title := '₺30 İndirim';
    ELSE RAISE EXCEPTION 'Ödül bulunamadı' USING ERRCODE = '22023';
  END CASE;

  SELECT * INTO v_row FROM public.loyalty WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_row.points < v_cost THEN
    RAISE EXCEPTION 'Yetersiz puan' USING ERRCODE = '55000';
  END IF;

  UPDATE public.loyalty SET points = points - v_cost, updated_at = now() WHERE user_id = v_uid;
  RETURN public.issue_personal_coupon(v_uid, v_type, v_value, v_title);
END $$;
REVOKE ALL ON FUNCTION public.redeem_reward(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward(text) TO authenticated;

COMMIT;
