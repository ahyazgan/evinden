-- 016: Restoran desteği
--
--  1. sellers.seller_type: ev aşçısı veya restoran. Mevcut satıcılar ev aşçısı sayılır.
--     Satıcı kendi türünü değiştiremez; yoksa düşük komisyona kendi kendine geçebilirdi.
--  2. Komisyon türe göre app_config.order_pricing'den okunur ve yönetici panelinden değişir.
--     Siparişe yazılan oran sabit kalır, oran değişimi eski siparişleri etkilemez.
--  3. seller_documents: restoranın yüklediği belgeler. Dosyalar gizli depoda durur (017).
--     Belgeleri eksik restoran yönetici tarafından bile aktif edilemez.

BEGIN;

-- ── 1. Satıcı türü ─────────────────────────────────────────────────────────

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS seller_type TEXT NOT NULL DEFAULT 'home';
ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_seller_type_check;
ALTER TABLE public.sellers
  ADD CONSTRAINT sellers_seller_type_check CHECK (seller_type IN ('home', 'restaurant'));
CREATE INDEX IF NOT EXISTS sellers_seller_type_idx ON public.sellers (seller_type);

CREATE OR REPLACE FUNCTION public.sellers_type_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;
  IF NEW.seller_type IS DISTINCT FROM OLD.seller_type THEN
    RAISE EXCEPTION 'Satıcı türü yalnızca yönetici tarafından değiştirilebilir' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sellers_type_guard_trg ON public.sellers;
CREATE TRIGGER sellers_type_guard_trg
  BEFORE UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_type_guard();

-- ── 2. Türe göre komisyon ──────────────────────────────────────────────────

UPDATE public.app_config
   SET value = value || '{"restaurant_commission_rate_percent": 1}'::jsonb, updated_at = now()
 WHERE key = 'order_pricing' AND NOT value ? 'restaurant_commission_rate_percent';

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

-- ── 3. Restoran belgeleri ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seller_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  doc_type     TEXT        NOT NULL CHECK (doc_type IN ('tax_certificate', 'business_license')),
  storage_path TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (seller_id, doc_type)
);
ALTER TABLE public.seller_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Başvuran kendi belgelerini görebilir" ON public.seller_documents;
CREATE POLICY "Başvuran kendi belgelerini görebilir"
  ON public.seller_documents FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admin belgeleri görebilir" ON public.seller_documents;
CREATE POLICY "Admin belgeleri görebilir"
  ON public.seller_documents FOR SELECT USING (public.is_admin());

-- Belge yalnızca onaydan önce eklenir ve yol başvuranın kendi klasöründe olmalıdır;
-- böylece yönetici başkasının dosyasına yönlendirilemez.
DROP POLICY IF EXISTS "Başvuran onay öncesi belge ekleyebilir" ON public.seller_documents;
CREATE POLICY "Başvuran onay öncesi belge ekleyebilir"
  ON public.seller_documents FOR INSERT
  WITH CHECK (
    split_part(storage_path, '/', 1) = auth.uid()::text
    AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid() AND NOT s.is_active)
  );

DROP POLICY IF EXISTS "Başvuran onay öncesi belge değiştirebilir" ON public.seller_documents;
CREATE POLICY "Başvuran onay öncesi belge değiştirebilir"
  ON public.seller_documents FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid() AND NOT s.is_active))
  WITH CHECK (
    split_part(storage_path, '/', 1) = auth.uid()::text
    AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid() AND NOT s.is_active)
  );

-- Belgesi eksik restoran açılamaz. is_admin kontrolü yok: kural yönetici için de geçerli.
CREATE OR REPLACE FUNCTION public.sellers_require_documents()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.is_active AND NOT OLD.is_active AND NEW.seller_type = 'restaurant'
     AND (SELECT count(*) FROM public.seller_documents d WHERE d.seller_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'Restoran onayı için vergi levhası ve işletme belgesi gerekir' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sellers_require_documents_trg ON public.sellers;
CREATE TRIGGER sellers_require_documents_trg
  BEFORE UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_require_documents();

-- Hesabı silinen satıcının mağaza kaydı anonim kalır (014); belgeleri kalmaz.
CREATE OR REPLACE FUNCTION public.sellers_clear_documents()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.seller_documents WHERE seller_id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sellers_clear_documents_trg ON public.sellers;
CREATE TRIGGER sellers_clear_documents_trg
  AFTER UPDATE OF user_id ON public.sellers
  FOR EACH ROW WHEN (NEW.user_id IS NULL AND OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION public.sellers_clear_documents();

COMMIT;
