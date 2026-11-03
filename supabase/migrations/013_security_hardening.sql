-- 013: Güvenlik sıkılaştırma + sunucu tarafı sipariş fiyatlandırma
--
-- Çözülen açıklar:
--  1. Müşteri sipariş toplamını / kalem fiyatını / durumunu kendisi yazabiliyordu
--     -> orders ve order_items'a doğrudan INSERT kapatıldı; sipariş yalnızca place_order() ile açılır,
--        fiyat sunucuda menü tablosundan hesaplanır.
--  2. Kullanıcı kendi users satırında role / is_approved değiştirebiliyordu (satıcı onayını atlama,
--     admin olma) -> users_guard tetikleyicisi.
--  3. Satıcı sipariş tutarını / ödeme durumunu değiştirebiliyor, müşteri iptal-iade yapamıyordu
--     -> orders_guard tetikleyicisi (kolon koruması + durum geçiş kuralı) + müşteri UPDATE politikası.
--  4. Satıcı kendi puanını yazabiliyor, kendini aktif edebiliyordu -> sellers_guard.
--  5. Sahte / çoklu yorum, yorum puanını satıcının değiştirmesi -> reviews_guard + puan yeniden hesaplama.
--  6. is_admin() fonksiyonuna search_path eklendi.
--  7. Kupon sınırsız tekrar kullanılabiliyor, iptal edilen sipariş hakkı geri vermiyordu
--     -> coupon_redemptions + coupons.max_uses_per_user + orders_release_coupon.
--  8. Müşteri eski fiyatı görüp yeni fiyattan sipariş verebiliyordu -> place_order beklenen tutarı denetler.
--  9. Aynı siparişe aynı anda iki yorum yazılabiliyordu -> reviews.order_id benzersiz indeksi.
-- 10. Satıcı müşterinin iade nedenini değiştirebiliyordu -> açıklamalar yalnızca işlemle birlikte yazılır.
--
-- Not: Service role (auth.uid() NULL) ve admin tüm korumaları geçer.

BEGIN;

-- ── 0. Yardımcılar ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Sunucu içi işlemlerin (puan yeniden hesaplama gibi) korumaları geçmesi için işaret.
-- set_config PostgREST ile dışarıya açık değildir; yalnızca bu migration'daki fonksiyonlar kullanır.
CREATE OR REPLACE FUNCTION public._internal_call()
RETURNS BOOLEAN AS $$
  SELECT coalesce(current_setting('app.internal', true), '') = '1';
$$ LANGUAGE sql STABLE;

-- ── 1. users: rol ve onay alanları korunur ─────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('buyer', 'seller', 'admin'));

CREATE OR REPLACE FUNCTION public.users_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role NOT IN ('buyer', 'seller') THEN
      RAISE EXCEPTION 'Geçersiz rol' USING ERRCODE = '42501';
    END IF;
    -- Alıcılar anında onaylı, satıcılar yönetici onayı bekler.
    NEW.is_approved := (NEW.role = 'buyer');
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
      RAISE EXCEPTION 'Rol ve onay durumu yalnızca yönetici tarafından değiştirilebilir' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_guard_trg ON public.users;
CREATE TRIGGER users_guard_trg
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_guard();

-- ── 2. sellers: puan ve aktivasyon korunur ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.sellers_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.rating_avg := 0;
    NEW.rating_count := 0;
    NEW.is_active := FALSE; -- yönetici onayı gerekir
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
       OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
      RAISE EXCEPTION 'Bu alanlar değiştirilemez' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_active AND NOT OLD.is_active THEN
      RAISE EXCEPTION 'Satıcı aktivasyonu yönetici onayı gerektirir' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sellers_guard_trg ON public.sellers;
CREATE TRIGGER sellers_guard_trg
  BEFORE INSERT OR UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_guard();

-- ── 3. orders: komisyon alanları, politikalar, koruma ──────────────────────

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_rate  NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_cents INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_cents   INTEGER      NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_code      TEXT;

-- Doğrudan INSERT kapanır: sipariş yalnızca place_order() ile açılır.
DROP POLICY IF EXISTS "Müşteri sipariş oluşturabilir" ON public.orders;
DROP POLICY IF EXISTS "Müşteri sipariş kalemi ekleyebilir" ON public.order_items;
REVOKE INSERT ON public.orders FROM anon, authenticated;
REVOKE INSERT ON public.order_items FROM anon, authenticated;

-- Müşteri kendi siparişini iptal edebilir / iade isteyebilir (kolonlar orders_guard ile sınırlı).
DROP POLICY IF EXISTS "Müşteri kendi siparişini güncelleyebilir" ON public.orders;
CREATE POLICY "Müşteri kendi siparişini güncelleyebilir"
  ON public.orders FOR UPDATE
  USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

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
      v_status_ok := (NEW.status = 'cancelled' AND OLD.status IN ('pending', 'accepted'));
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

DROP TRIGGER IF EXISTS orders_guard_trg ON public.orders;
CREATE TRIGGER orders_guard_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard();

-- İptal edilen siparişin stoğu aynı gün için geri verilir. Aynı ürün farklı seçimlerle birden fazla
-- satır olabildiğinden adetler önce toplanır: UPDATE ... FROM eşleşen satırlardan yalnızca birini uygular.
CREATE OR REPLACE FUNCTION public.orders_restock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.menu_items mi
       SET sold_today = greatest(mi.sold_today - oi.quantity, 0)
      FROM (
        SELECT menu_item_id, sum(quantity)::integer AS quantity
          FROM public.order_items
         WHERE order_id = NEW.id
         GROUP BY menu_item_id
      ) oi
     WHERE oi.menu_item_id = mi.id
       AND mi.daily_limit > 0
       AND mi.stock_reset_date = (OLD.created_at AT TIME ZONE 'Europe/Istanbul')::date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_restock_trg ON public.orders;
CREATE TRIGGER orders_restock_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_restock();

-- ── 4. Sipariş fiyatlandırma ayarları ──────────────────────────────────────

-- İstemci kupon tavanını (max_discount_cents) okuyor ama kolon hiç yoktu; yüzde kuponların
-- tavanı yanlışlıkla indirim yüzdesine (örn. 20 kuruş) düşüyordu.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_discount_cents INTEGER;
UPDATE public.coupons SET max_discount_cents = 5000 WHERE code = 'EVINDEN20'  AND max_discount_cents IS NULL;
UPDATE public.coupons SET max_discount_cents = 1500 WHERE code = 'TATLI15'    AND max_discount_cents IS NULL;
UPDATE public.coupons SET max_discount_cents = 6000 WHERE code = 'KAHVALTI25' AND max_discount_cents IS NULL;

-- Kişi başı kullanım hakkı. Varsayılan 1; NULL sınırsız demektir.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER DEFAULT 1;
UPDATE public.coupons SET max_uses_per_user = 3    WHERE code = 'LEZZET10';
UPDATE public.coupons SET max_uses_per_user = 2    WHERE code = 'TATLI15';
UPDATE public.coupons SET max_uses_per_user = NULL WHERE code = 'UCRETSIZ';

-- Geçerli kupon kullanımları: iptal edilen siparişin kaydı silinir, hak geri döner.
-- Yalnızca place_order yazar; kullanıcı kendi kayıtlarını okuyabilir.
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id  UUID        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  order_id   UUID        NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_user_idx ON public.coupon_redemptions (coupon_id, user_id);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.coupon_redemptions FROM anon, authenticated;
DROP POLICY IF EXISTS "Kullanıcı kendi kupon kullanımlarını görebilir" ON public.coupon_redemptions;
CREATE POLICY "Kullanıcı kendi kupon kullanımlarını görebilir"
  ON public.coupon_redemptions FOR SELECT USING (auth.uid() = user_id);

INSERT INTO public.app_config (key, value) VALUES (
  'order_pricing',
  '{"delivery_fee_cents": 1500, "free_delivery_threshold_cents": 15000, "commission_rate_percent": 8, "min_order_cents": 0}'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ── 5. place_order: fiyat sunucuda hesaplanır ──────────────────────────────
-- p_items: [{"menu_item_id": uuid, "quantity": int, "variant_id": uuid?, "portion_id": uuid?, "extra_ids": [uuid]?}]
-- p_expected_total_cents: müşterinin ekranda gördüğü tutar. Hesaplanan tutar farklıysa sipariş açılmaz,
-- 'EVN01' kodu ve DETAIL içinde yeni tutar döner; müşteri onaylayınca yeni tutarla tekrar çağrılır.

-- Önceki sürüm farklı imzalıydı; iki sürüm kalırsa çağrı belirsizleşir.
DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, text, text, text, text);

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
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazanızdan sipariş veremezsiniz' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, text, text, text, text, integer) TO authenticated;

-- İptal edilen sipariş kupon hakkını ve toplam kullanım sayacını geri verir.
CREATE OR REPLACE FUNCTION public.orders_release_coupon()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coupon uuid;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    DELETE FROM public.coupon_redemptions WHERE order_id = NEW.id RETURNING coupon_id INTO v_coupon;
    IF FOUND THEN
      UPDATE public.coupons SET used_count = greatest(used_count - 1, 0) WHERE id = v_coupon;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_release_coupon_trg ON public.orders;
CREATE TRIGGER orders_release_coupon_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_release_coupon();

-- ── 6. reviews: yalnızca teslim edilmiş siparişe, tek yorum; alan koruması ─

CREATE OR REPLACE FUNCTION public.reviews_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_seller boolean;
BEGIN
  IF v_uid IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id IS DISTINCT FROM v_uid OR NEW.order_id IS NULL THEN
      RAISE EXCEPTION 'Yorum için teslim edilmiş bir sipariş gerekir' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = NEW.order_id AND o.customer_id = v_uid
         AND o.seller_id = NEW.seller_id AND o.status = 'delivered'
    ) THEN
      RAISE EXCEPTION 'Yorum için teslim edilmiş bir sipariş gerekir' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.order_id = NEW.order_id) THEN
      RAISE EXCEPTION 'Bu sipariş için zaten yorum yapılmış' USING ERRCODE = '23505';
    END IF;
    NEW.helpful_count := 0;
    NEW.seller_reply := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.helpful_count IS DISTINCT FROM OLD.helpful_count
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Bu alanlar değiştirilemez' USING ERRCODE = '42501';
  END IF;

  v_is_seller := EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = OLD.seller_id AND s.user_id = v_uid);

  IF OLD.customer_id = v_uid THEN
    IF NEW.seller_reply IS DISTINCT FROM OLD.seller_reply THEN
      RAISE EXCEPTION 'Satıcı yanıtı değiştirilemez' USING ERRCODE = '42501';
    END IF;
  ELSIF v_is_seller THEN
    IF NEW.rating IS DISTINCT FROM OLD.rating OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.photo_url IS DISTINCT FROM OLD.photo_url
       OR NEW.menu_item_title IS DISTINCT FROM OLD.menu_item_title THEN
      RAISE EXCEPTION 'Satıcı yalnızca yanıt yazabilir' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reviews_guard_trg ON public.reviews;
CREATE TRIGGER reviews_guard_trg
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_guard();

-- Aynı anda gelen iki istek reviews_guard kontrolünü birlikte geçebilir; asıl garanti indekstir.
-- Mevcut çift yorumlar otomatik silinmez: varsa indeks atlanır ve uyarı verilir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reviews WHERE order_id IS NOT NULL GROUP BY order_id HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'reviews: aynı siparişe birden fazla yorum var, reviews_order_id_unique oluşturulmadı';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_id_unique
      ON public.reviews (order_id) WHERE order_id IS NOT NULL;
  END IF;
END $$;

-- Satıcı puanı yorumlardan sunucuda hesaplanır.
CREATE OR REPLACE FUNCTION public.recompute_seller_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller uuid := coalesce(NEW.seller_id, OLD.seller_id);
BEGIN
  PERFORM set_config('app.internal', '1', true);
  UPDATE public.sellers s
     SET rating_avg = coalesce((SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r WHERE r.seller_id = v_seller), 0),
         rating_count = (SELECT count(*) FROM public.reviews r WHERE r.seller_id = v_seller)
   WHERE s.id = v_seller;
  PERFORM set_config('app.internal', '', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS reviews_rating_trg ON public.reviews;
CREATE TRIGGER reviews_rating_trg
  AFTER INSERT OR DELETE OR UPDATE OF rating ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recompute_seller_rating();

COMMIT;
