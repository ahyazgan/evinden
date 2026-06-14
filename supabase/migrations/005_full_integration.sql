-- ═══ FAVORITES ═══
CREATE TABLE IF NOT EXISTS public.favorites (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seller_id  UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, seller_id)
);
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kullanıcı kendi favorilerini görebilir" ON public.favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Kullanıcı favori ekleyebilir" ON public.favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kullanıcı favori silebilir" ON public.favorites FOR DELETE USING (auth.uid() = user_id);

-- ═══ USER ADDRESSES ═══
CREATE TABLE IF NOT EXISTS public.user_addresses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL DEFAULT 'Ev',
  address    TEXT        NOT NULL,
  latitude   NUMERIC(9,6),
  longitude  NUMERIC(9,6),
  is_default BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kullanıcı kendi adreslerini görebilir" ON public.user_addresses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Kullanıcı adres ekleyebilir" ON public.user_addresses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kullanıcı adres güncelleyebilir" ON public.user_addresses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Kullanıcı adres silebilir" ON public.user_addresses FOR DELETE USING (auth.uid() = user_id);

-- ═══ REVIEWS ═══
CREATE TABLE IF NOT EXISTS public.reviews (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID        REFERENCES public.orders(id),
  seller_id    UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES public.users(id),
  rating       INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  photo_url    TEXT,
  menu_item_title TEXT,
  helpful_count INTEGER    NOT NULL DEFAULT 0,
  seller_reply  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Herkes yorumları görebilir" ON public.reviews FOR SELECT USING (TRUE);
CREATE POLICY "Müşteri yorum ekleyebilir" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Müşteri kendi yorumunu güncelleyebilir" ON public.reviews FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "Satıcı kendi yorumlarına cevap verebilir" ON public.reviews FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
);

-- ═══ LOYALTY ═══
CREATE TABLE IF NOT EXISTS public.loyalty (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID    NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  points          INTEGER NOT NULL DEFAULT 0,
  total_orders    INTEGER NOT NULL DEFAULT 0,
  total_spent     INTEGER NOT NULL DEFAULT 0,
  tier            TEXT    NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
  free_deliveries_earned INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.loyalty ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kullanıcı kendi sadakatini görebilir" ON public.loyalty FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Kullanıcı sadakat oluşturabilir" ON public.loyalty FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kullanıcı sadakat güncelleyebilir" ON public.loyalty FOR UPDATE USING (auth.uid() = user_id);

-- ═══ REFERRALS ═══
CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID    NOT NULL REFERENCES public.users(id),
  referred_id   UUID    REFERENCES public.users(id),
  code          TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  reward_cents  INTEGER NOT NULL DEFAULT 1500,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kullanıcı kendi referanslarını görebilir" ON public.referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Kullanıcı referans oluşturabilir" ON public.referrals FOR INSERT WITH CHECK (auth.uid() = referrer_id);
CREATE POLICY "Referans güncellenebilir" ON public.referrals FOR UPDATE USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- ═══ COUPONS ═══
CREATE TABLE IF NOT EXISTS public.coupons (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT    NOT NULL UNIQUE,
  discount_type   TEXT    NOT NULL CHECK (discount_type IN ('percent','fixed','free_delivery')),
  discount_value  INTEGER NOT NULL DEFAULT 0,
  min_order_cents INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER,
  used_count      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Herkes kuponları görebilir" ON public.coupons FOR SELECT USING (TRUE);

-- ═══ NOTIFICATIONS ═══
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  body       TEXT,
  type       TEXT        NOT NULL DEFAULT 'system',
  is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kullanıcı kendi bildirimlerini görebilir" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Kullanıcı bildirim güncelleyebilir" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- ═══ SELLER HOURS ═══
CREATE TABLE IF NOT EXISTS public.seller_hours (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID    NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time  TIME,
  close_time TIME,
  is_open    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(seller_id, day_of_week)
);
ALTER TABLE public.seller_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Herkes çalışma saatlerini görebilir" ON public.seller_hours FOR SELECT USING (TRUE);
CREATE POLICY "Satıcı kendi saatlerini ekleyebilir" ON public.seller_hours FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
);
CREATE POLICY "Satıcı kendi saatlerini güncelleyebilir" ON public.seller_hours FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid())
);

-- ═══ Menü items'a category kolonu (varsa skip) ═══
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS category TEXT;

-- ═══ Sipariş kalemi ekleyebilmesi için satıcı policy ═══
CREATE POLICY IF NOT EXISTS "Satıcı sipariş kalemlerini görebilir" ON public.order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.sellers s ON s.id = o.seller_id
    WHERE o.id = order_id AND s.user_id = auth.uid()
  )
);

-- ═══ Varsayılan kuponları ekle ═══
INSERT INTO public.coupons (code, discount_type, discount_value, min_order_cents, is_active) VALUES
  ('EVINDEN20', 'percent', 20, 10000, true),
  ('LEZZET10', 'fixed', 1000, 5000, true),
  ('UCRETSIZ', 'free_delivery', 0, 15000, true),
  ('TATLI15', 'percent', 15, 8000, true),
  ('KAHVALTI25', 'percent', 25, 12000, true)
ON CONFLICT (code) DO NOTHING;
