-- 024: Satıcı kampanyaları, kazanç raporu ve hesap kesimi
--
--  - Satıcı kendi mağazasına özel kupon açar; indirimi satıcı üstlenir, komisyon indirimli tutardan alınır.
--  - Platform kuponu indirimini platform üstlenir; ücretsiz teslimat kuponunda teslimat bedelini de öder.
--  - Her sipariş için bakiye = satıcının hakkı - satıcının müşteriden aldığı para.
--    Online ödemede para platformdadır (bakiye artı: satıcıya ödenir).
--    Nakit ve kapıda kartta para satıcıdadır (bakiye çoğunlukla eksi: satıcı komisyonu öder).
--  - Yönetici hesap kesimini kaydeder. Kesilmiş sipariş sonradan iade edilirse tutar sonraki kesime ters kayıt olarak girer.

BEGIN;

-- ── 1. Kolonlar ve tablolar ────────────────────────────────────────────────

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.sellers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS coupons_seller_id_idx ON public.coupons (seller_id) WHERE seller_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID        NOT NULL REFERENCES public.sellers(id),
  -- Artı: platform satıcıya ödedi. Eksi: satıcı platforma ödedi.
  amount_cents     INTEGER     NOT NULL,
  order_count      INTEGER     NOT NULL,
  commission_cents INTEGER     NOT NULL,
  note             TEXT,
  created_by       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_payouts_seller_idx ON public.seller_payouts (seller_id, created_at DESC);
ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.seller_payouts FROM anon, authenticated;
DROP POLICY IF EXISTS "Satıcı ve yönetici hesap kesimlerini görür" ON public.seller_payouts;
CREATE POLICY "Satıcı ve yönetici hesap kesimlerini görür"
  ON public.seller_payouts FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

-- sellers herkese açıktır; IBAN bu yüzden ayrı tabloda durur.
CREATE TABLE IF NOT EXISTS public.seller_payout_accounts (
  seller_id    UUID        PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  iban         TEXT        NOT NULL CHECK (iban ~ '^TR[0-9]{24}$'),
  account_name TEXT        NOT NULL CHECK (length(btrim(account_name)) BETWEEN 3 AND 100),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.seller_payout_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_payout_accounts FROM anon;
DROP POLICY IF EXISTS "Satıcı ödeme hesabını görür" ON public.seller_payout_accounts;
CREATE POLICY "Satıcı ödeme hesabını görür"
  ON public.seller_payout_accounts FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS "Satıcı ödeme hesabını ekler" ON public.seller_payout_accounts;
CREATE POLICY "Satıcı ödeme hesabını ekler"
  ON public.seller_payout_accounts FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS "Satıcı ödeme hesabını günceller" ON public.seller_payout_accounts;
CREATE POLICY "Satıcı ödeme hesabını günceller"
  ON public.seller_payout_accounts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_discount_cents   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_delivery_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payout_id          UUID REFERENCES public.seller_payouts(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reversal_payout_id UUID REFERENCES public.seller_payouts(id);
UPDATE public.orders SET delivered_at = updated_at WHERE status = 'delivered' AND delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_seller_delivered_idx ON public.orders (seller_id, delivered_at) WHERE status = 'delivered';

CREATE OR REPLACE FUNCTION public.orders_settlement_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Yönetici de bu alanları elle değiştiremez: hesap kesimi yalnızca admin_settle_seller ile yazılır.
  IF auth.uid() IS NOT NULL AND NOT public._internal_call() THEN
    IF NEW.seller_discount_cents IS DISTINCT FROM OLD.seller_discount_cents
       OR NEW.platform_delivery_cents IS DISTINCT FROM OLD.platform_delivery_cents
       OR NEW.payout_id IS DISTINCT FROM OLD.payout_id
       OR NEW.reversal_payout_id IS DISTINCT FROM OLD.reversal_payout_id THEN
      RAISE EXCEPTION 'Hesap kesimi alanları değiştirilemez' USING ERRCODE = '42501';
    END IF;
    NEW.delivered_at := OLD.delivered_at;
  END IF;
  -- Ters kaydı işlenmiş sipariş yeniden satışa dönemez: hiçbir kesime girmeden kazançta görünürdü.
  IF OLD.reversal_payout_id IS NOT NULL AND public.order_counts_as_sale(NEW) THEN
    RAISE EXCEPTION 'Hesap kesiminde iade edilmiş sipariş yeniden açılamaz' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    NEW.delivered_at := coalesce(NEW.delivered_at, now());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_settlement_trg ON public.orders;
CREATE TRIGGER orders_settlement_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_settlement_fields();

-- ── 2. place_order: satıcı kuponu ──────────────────────────────────────────

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
    commission_rate, commission_cents, discount_cents, coupon_code, seller_discount_cents, platform_delivery_cents
  ) VALUES (
    v_uid, p_seller_id, CASE WHEN p_payment_method = 'online' THEN 'awaiting_payment' ELSE 'pending' END, v_subtotal, v_delivery, v_total, 'TRY',
    btrim(p_delivery_address), nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method, 'pending',
    v_rate, v_commission, v_discount, CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.code END, v_seller_discount, v_platform_delivery
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

-- ── 3. Sipariş hesabı ──────────────────────────────────────────────────────
-- Aynı hesap istemcide lib/earnings.ts içinde; test ikisini karşılaştırır.

CREATE OR REPLACE FUNCTION public.order_net_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT o.subtotal_cents + o.delivery_fee_cents + o.platform_delivery_cents
         - o.seller_discount_cents - o.commission_cents;
$$;

CREATE OR REPLACE FUNCTION public.order_balance_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT public.order_net_cents(o) - CASE WHEN o.payment_method = 'online' THEN 0 ELSE o.total_cents END;
$$;

-- Satış kazanca sayılır mı? İade talebi sonuçlanana kadar sayılır, onaylanınca düşer.
CREATE OR REPLACE FUNCTION public.order_counts_as_sale(o public.orders)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT o.status = 'delivered'
     AND coalesce(o.refund_status, 'none') <> 'approved'
     AND o.payment_status NOT IN ('refunded', 'refund_pending');
$$;

-- Kesime girecek tutar: henüz kesilmemiş satış (artı) veya kesildikten sonra iade edilmiş satış (ters kayıt).
-- İade talebi açık olan sipariş beklemede kalır. Kesime girmeyecekse NULL.
CREATE OR REPLACE FUNCTION public.order_open_amount_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN o.payout_id IS NULL AND public.order_counts_as_sale(o)
         AND coalesce(o.refund_status, 'none') <> 'requested' THEN public.order_balance_cents(o)
    WHEN o.payout_id IS NOT NULL AND o.reversal_payout_id IS NULL AND NOT public.order_counts_as_sale(o)
      THEN -public.order_balance_cents(o)
  END;
$$;

DROP TYPE IF EXISTS public.seller_open_total CASCADE;
CREATE TYPE public.seller_open_total AS (balance_cents integer, order_count integer, commission_cents integer, held_count integer);

CREATE OR REPLACE FUNCTION public.seller_open_totals(p_seller uuid)
RETURNS public.seller_open_total
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROW(
    coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
    (count(*) FILTER (WHERE public.order_open_amount_cents(o) IS NOT NULL))::integer,
    coalesce(sum(CASE WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END)
      FILTER (WHERE public.order_open_amount_cents(o) IS NOT NULL), 0)::integer,
    (count(*) FILTER (WHERE o.status = 'delivered' AND o.refund_status = 'requested' AND o.payout_id IS NULL))::integer
  )::public.seller_open_total
  FROM public.orders o WHERE o.seller_id = p_seller;
$$;

REVOKE ALL ON FUNCTION public.order_net_cents(public.orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_balance_cents(public.orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_counts_as_sale(public.orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_open_amount_cents(public.orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_open_totals(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Satıcı raporu ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_earnings(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  order_count integer, gross_cents integer, seller_discount_cents integer, commission_cents integer,
  net_cents integer, collected_cents integer, open_balance_cents integer, open_order_count integer, held_count integer
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
         v_open.balance_cents, v_open.order_count, v_open.held_count
    FROM public.orders o
   WHERE o.seller_id = v_seller
     AND public.order_counts_as_sale(o)
     AND o.delivered_at >= p_from AND o.delivered_at < p_to;
END $$;
REVOKE ALL ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) TO authenticated;

-- ── 5. Yönetici: ödeme takibi ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_payout_overview()
RETURNS TABLE (
  seller_id uuid, display_name text, seller_type text, iban text, account_name text,
  balance_cents integer, order_count integer, commission_cents integer, held_count integer, last_payout_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.display_name, s.seller_type, a.iban, a.account_name,
         t.balance_cents, t.order_count, t.commission_cents, t.held_count,
         (SELECT max(p.created_at) FROM public.seller_payouts p WHERE p.seller_id = s.id)
    FROM public.sellers s
    LEFT JOIN public.seller_payout_accounts a ON a.seller_id = s.id
    CROSS JOIN LATERAL public.seller_open_totals(s.id) t
   WHERE t.order_count > 0 OR t.held_count > 0
   ORDER BY abs(t.balance_cents) DESC, s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_payout_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_platform_totals()
RETURNS TABLE (delivered_count bigint, sales_cents bigint, commission_cents bigint, payable_cents bigint, receivable_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sales AS (
    SELECT count(*) AS n, coalesce(sum(o.total_cents), 0) AS total, coalesce(sum(o.commission_cents), 0) AS commission
      FROM public.orders o WHERE public.order_counts_as_sale(o)
  ), balances AS (
    SELECT (public.seller_open_totals(s.id)).balance_cents AS b FROM public.sellers s
  )
  SELECT sales.n, sales.total::bigint, sales.commission::bigint,
         coalesce((SELECT sum(b) FROM balances WHERE b > 0), 0)::bigint,
         coalesce((SELECT -sum(b) FROM balances WHERE b < 0), 0)::bigint
    FROM sales;
END $$;
REVOKE ALL ON FUNCTION public.admin_platform_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_totals() TO authenticated;

-- Yönetici ekranda gördüğü tutarı gönderir; o arada bakiye değiştiyse (EVN04) kesim yapılmaz.
CREATE OR REPLACE FUNCTION public.admin_settle_seller(p_seller uuid, p_expected_cents integer, p_note text DEFAULT NULL)
RETURNS public.seller_payouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_settle uuid[];
  v_reverse uuid[];
  v_amount integer;
  v_commission integer;
  v_payout public.seller_payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_user FROM public.sellers WHERE id = p_seller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Satıcı bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NULL), '{}'),
         coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NOT NULL), '{}'),
         coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
         coalesce(sum(CASE WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END), 0)::integer
    INTO v_settle, v_reverse, v_amount, v_commission
    FROM (
      SELECT * FROM public.orders x
       WHERE x.seller_id = p_seller AND public.order_open_amount_cents(x) IS NOT NULL
       FOR UPDATE
    ) o;

  IF coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Kesilecek sipariş yok' USING ERRCODE = '55000';
  END IF;
  IF v_amount <> p_expected_cents THEN
    RAISE EXCEPTION 'Bakiye değişti, listeyi yenileyin' USING ERRCODE = 'EVN04', DETAIL = v_amount::text;
  END IF;
  IF length(coalesce(p_note, '')) > 300 THEN
    RAISE EXCEPTION 'Not çok uzun' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.seller_payouts (seller_id, amount_cents, order_count, commission_cents, note, created_by)
  VALUES (p_seller, v_amount, coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0),
          v_commission, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  RETURNING * INTO v_payout;

  PERFORM set_config('app.internal', '1', true);
  UPDATE public.orders SET payout_id = v_payout.id WHERE id = ANY (v_settle);
  UPDATE public.orders SET reversal_payout_id = v_payout.id WHERE id = ANY (v_reverse);
  PERFORM set_config('app.internal', '', true);

  PERFORM public.notify_user(
    v_user, 'Hesap kesimi yapıldı',
    CASE WHEN v_amount >= 0
      THEN '₺' || to_char(v_amount / 100.0, 'FM999999990.00') || ' hesabınıza gönderildi.'
      ELSE '₺' || to_char(-v_amount / 100.0, 'FM999999990.00') || ' komisyon ödemeniz kaydedildi.'
    END,
    'payout', jsonb_build_object('payoutId', v_payout.id));
  RETURN v_payout;
END $$;
REVOKE ALL ON FUNCTION public.admin_settle_seller(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settle_seller(uuid, integer, text) TO authenticated;

-- ── 6. Satıcı kampanyaları ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_seller_coupon(
  p_code text, p_title text, p_type text, p_value integer, p_min_order_cents integer,
  p_max_uses integer, p_expires_at timestamptz, p_max_discount_cents integer DEFAULT NULL
)
RETURNS public.coupons
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers%ROWTYPE;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Yalnızca aktif satıcılar kampanya açabilir' USING ERRCODE = '42501';
  END IF;
  IF v_code !~ '^[A-Z0-9]{4,20}$' THEN
    RAISE EXCEPTION 'Kod 4-20 karakter olmalı; Türkçe karakter ve boşluk kullanmayın' USING ERRCODE = '55000';
  END IF;
  IF length(v_title) NOT BETWEEN 3 AND 60 THEN
    RAISE EXCEPTION 'Kampanya adı 3-60 karakter olmalı' USING ERRCODE = '55000';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('percent', 'fixed', 'free_delivery') THEN
    RAISE EXCEPTION 'Kampanya türü geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_type = 'percent' AND coalesce(p_value, 0) NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'İndirim yüzdesi 1-90 arasında olmalı' USING ERRCODE = '55000';
  END IF;
  IF p_type = 'fixed' AND coalesce(p_value, 0) < 100 THEN
    RAISE EXCEPTION 'İndirim tutarı en az ₺1 olmalı' USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_min_order_cents, 0) < 0 OR coalesce(p_max_discount_cents, 1) <= 0 THEN
    RAISE EXCEPTION 'Tutar sınırı geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Kullanım sınırı geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '180 days' THEN
    RAISE EXCEPTION 'Bitiş tarihi en fazla 180 gün sonrası olabilir' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.coupons c
       WHERE c.seller_id = v_seller.id AND c.is_active AND (c.expires_at IS NULL OR c.expires_at > now())) >= 20 THEN
    RAISE EXCEPTION 'En fazla 20 aktif kampanyanız olabilir' USING ERRCODE = '55000';
  END IF;

  BEGIN
    INSERT INTO public.coupons (
      code, title, discount_type, discount_value, min_order_cents, max_discount_cents,
      max_uses, max_uses_per_user, is_active, expires_at, seller_id, icon
    ) VALUES (
      v_code, v_title, p_type, CASE WHEN p_type = 'free_delivery' THEN 0 ELSE p_value END,
      coalesce(p_min_order_cents, 0), CASE WHEN p_type = 'percent' THEN p_max_discount_cents END,
      p_max_uses, 1, TRUE, p_expires_at, v_seller.id, '🏷️'
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Bu kod kullanılıyor, başka bir kod seçin' USING ERRCODE = '55000';
  END;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.create_seller_coupon(text, text, text, integer, integer, integer, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_seller_coupon(text, text, text, integer, integer, integer, timestamptz, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_seller_coupon_active(p_coupon uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.coupons c SET is_active = p_active
   WHERE c.id = p_coupon
     AND c.seller_id IN (SELECT s.id FROM public.sellers s WHERE s.user_id = auth.uid() AND s.is_active);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kampanya bulunamadı' USING ERRCODE = 'P0002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_seller_coupon_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_seller_coupon_active(uuid, boolean) TO authenticated;

-- Kullanılmış kupon silinmez, kapatılır: siparişlerin kupon geçmişi kaybolmasın. Silindiyse TRUE döner.
CREATE OR REPLACE FUNCTION public.delete_seller_coupon(p_coupon uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.coupons%ROWTYPE;
BEGIN
  SELECT c.* INTO v_row FROM public.coupons c
   WHERE c.id = p_coupon AND c.seller_id IN (SELECT s.id FROM public.sellers s WHERE s.user_id = auth.uid())
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kampanya bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.used_count > 0 OR EXISTS (SELECT 1 FROM public.coupon_redemptions r WHERE r.coupon_id = p_coupon) THEN
    UPDATE public.coupons SET is_active = FALSE WHERE id = p_coupon;
    RETURN FALSE;
  END IF;
  DELETE FROM public.coupons WHERE id = p_coupon;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.delete_seller_coupon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_seller_coupon(uuid) TO authenticated;

COMMIT;
