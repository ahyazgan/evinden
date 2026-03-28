-- evinden: marketplace tabloları
-- sellers, menu_items, orders, order_items, reviews

-- ─────────────────────────────────────────────
-- SELLERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sellers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio         TEXT,
  city        TEXT,
  district    TEXT,
  address_line TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  rating_avg  NUMERIC(3,2) DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sellers_user_id_idx  ON public.sellers (user_id);
CREATE INDEX IF NOT EXISTS sellers_city_idx     ON public.sellers (city);
CREATE INDEX IF NOT EXISTS sellers_active_idx   ON public.sellers (is_active);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

-- Herkes aktif satıcıları görebilir
CREATE POLICY "Aktif satıcılar herkese açık"
  ON public.sellers FOR SELECT
  USING (is_active = TRUE);

-- Satıcı kendi profilini güncelleyebilir
CREATE POLICY "Satıcı kendi profilini güncelleyebilir"
  ON public.sellers FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Satıcı kendi profilini oluşturabilir
CREATE POLICY "Satıcı kendi profilini oluşturabilir"
  ON public.sellers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- MENU ITEMS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    UUID NOT NULL REFERENCES public.sellers (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  price_cents  INT NOT NULL CHECK (price_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'TRY',
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_items_seller_idx     ON public.menu_items (seller_id);
CREATE INDEX IF NOT EXISTS menu_items_available_idx  ON public.menu_items (is_available);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- Herkes mevcut menü öğelerini görebilir
CREATE POLICY "Mevcut menü öğeleri herkese açık"
  ON public.menu_items FOR SELECT
  USING (is_available = TRUE);

-- Satıcı kendi menü öğelerini yönetebilir
CREATE POLICY "Satıcı kendi menüsünü yönetebilir"
  ON public.menu_items FOR ALL
  USING (
    seller_id IN (
      SELECT id FROM public.sellers WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES public.users (id),
  seller_id           UUID NOT NULL REFERENCES public.sellers (id),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending','accepted','preparing',
                          'ready','out_for_delivery','delivered','cancelled'
                        )),
  subtotal_cents      INT NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents  INT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents         INT NOT NULL CHECK (total_cents >= 0),
  currency            TEXT NOT NULL DEFAULT 'TRY',
  delivery_address    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_customer_idx  ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_seller_idx    ON public.orders (seller_id);
CREATE INDEX IF NOT EXISTS orders_status_idx    ON public.orders (status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Müşteri kendi siparişlerini görebilir
CREATE POLICY "Müşteri kendi siparişlerini görebilir"
  ON public.orders FOR SELECT
  USING (auth.uid() = customer_id);

-- Satıcı kendi siparişlerini görebilir
CREATE POLICY "Satıcı gelen siparişleri görebilir"
  ON public.orders FOR SELECT
  USING (
    seller_id IN (
      SELECT id FROM public.sellers WHERE user_id = auth.uid()
    )
  );

-- Müşteri sipariş oluşturabilir
CREATE POLICY "Müşteri sipariş oluşturabilir"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

-- Satıcı sipariş durumunu güncelleyebilir
CREATE POLICY "Satıcı sipariş durumunu güncelleyebilir"
  ON public.orders FOR UPDATE
  USING (
    seller_id IN (
      SELECT id FROM public.sellers WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- ORDER ITEMS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  menu_item_id     UUID NOT NULL REFERENCES public.menu_items (id),
  title_snapshot   TEXT NOT NULL,
  unit_price_cents INT NOT NULL CHECK (unit_price_cents > 0),
  quantity         INT NOT NULL CHECK (quantity > 0),
  line_total_cents INT NOT NULL CHECK (line_total_cents > 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Sipariş sahibi kendi sipariş kalemlerini görebilir
CREATE POLICY "Sipariş kalemlerine erişim"
  ON public.order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE customer_id = auth.uid()
         OR seller_id IN (
              SELECT id FROM public.sellers WHERE user_id = auth.uid()
            )
    )
  );

CREATE POLICY "Müşteri sipariş kalemi ekleyebilir"
  ON public.order_items FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders WHERE customer_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- REVIEWS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL UNIQUE REFERENCES public.orders (id),
  seller_id   UUID NOT NULL REFERENCES public.sellers (id),
  customer_id UUID NOT NULL REFERENCES public.users (id),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_seller_idx ON public.reviews (seller_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Herkes değerlendirmeleri görebilir
CREATE POLICY "Değerlendirmeler herkese açık"
  ON public.reviews FOR SELECT USING (TRUE);

-- Müşteri teslim edilmiş siparişe değerlendirme yazabilir
CREATE POLICY "Müşteri değerlendirme yazabilir"
  ON public.reviews FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND order_id IN (
      SELECT id FROM public.orders
      WHERE customer_id = auth.uid() AND status = 'delivered'
    )
  );

-- ─────────────────────────────────────────────
-- rating_avg'yi otomatik güncelle
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_seller_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.sellers
  SET
    rating_avg   = (SELECT AVG(rating) FROM public.reviews WHERE seller_id = NEW.seller_id),
    rating_count = (SELECT COUNT(*)    FROM public.reviews WHERE seller_id = NEW.seller_id),
    updated_at   = NOW()
  WHERE id = NEW.seller_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_seller_rating
  AFTER INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION update_seller_rating();
