-- evinden: satıcılar, menü öğeleri, siparişler ve sipariş kalemleri
-- Supabase SQL Editor veya CLI ile çalıştırın.

-- ── SATICILAR ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sellers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  display_name   TEXT        NOT NULL,
  bio            TEXT,
  city           TEXT,
  district       TEXT,
  address_line   TEXT,
  latitude       NUMERIC(9,6),
  longitude      NUMERIC(9,6),
  rating_avg     NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count   INTEGER      NOT NULL DEFAULT 0,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sellers_user_id_idx ON public.sellers (user_id);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes satıcıları görebilir"
  ON public.sellers FOR SELECT USING (TRUE);

CREATE POLICY "Satıcı kendi profilini ekleyebilir"
  ON public.sellers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Satıcı kendi profilini güncelleyebilir"
  ON public.sellers FOR UPDATE
  USING (auth.uid() = user_id);

-- ── MENÜ ÖĞELERİ ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.menu_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  price_cents  INTEGER     NOT NULL CHECK (price_cents >= 0),
  currency     TEXT        NOT NULL DEFAULT 'TRY',
  image_url    TEXT,
  is_available BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_items_seller_id_idx ON public.menu_items (seller_id);

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes menü öğelerini görebilir"
  ON public.menu_items FOR SELECT USING (TRUE);

CREATE POLICY "Satıcı menü öğesi ekleyebilir"
  ON public.menu_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
  );

CREATE POLICY "Satıcı menü öğesi güncelleyebilir"
  ON public.menu_items FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
  );

CREATE POLICY "Satıcı menü öğesi silebilir"
  ON public.menu_items FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
  );

-- ── SİPARİŞLER ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID        NOT NULL REFERENCES public.users(id),
  seller_id           UUID        NOT NULL REFERENCES public.sellers(id),
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','preparing','ready','out_for_delivery','delivered','cancelled')),
  subtotal_cents      INTEGER     NOT NULL DEFAULT 0,
  delivery_fee_cents  INTEGER     NOT NULL DEFAULT 0,
  total_cents         INTEGER     NOT NULL DEFAULT 0,
  currency            TEXT        NOT NULL DEFAULT 'TRY',
  delivery_address    TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_seller_id_idx   ON public.orders (seller_id);
CREATE INDEX IF NOT EXISTS orders_status_idx      ON public.orders (status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Müşteri kendi siparişlerini görebilir"
  ON public.orders FOR SELECT
  USING (auth.uid() = customer_id);

CREATE POLICY "Satıcı kendi satışlarını görebilir"
  ON public.orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
  );

CREATE POLICY "Müşteri sipariş oluşturabilir"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = customer_id);

CREATE POLICY "Satıcı sipariş durumunu güncelleyebilir"
  ON public.orders FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
  );

-- ── SİPARİŞ KALEMLERİ ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_items (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID    NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id     UUID    REFERENCES public.menu_items(id),
  title_snapshot   TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items (order_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sipariş sahibi ve satıcı kalemleri görebilir"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.orders WHERE id = order_id AND customer_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
      WHERE o.id = order_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Müşteri sipariş kalemi ekleyebilir"
  ON public.order_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders WHERE id = order_id AND customer_id = auth.uid())
  );
