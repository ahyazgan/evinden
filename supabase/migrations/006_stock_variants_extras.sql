-- 006_stock_variants_extras.sql
-- Stock management, variants, extras, payment fields, coupon & loyalty columns

BEGIN;

-- 1. Stock columns on menu_items
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS sold_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS stock_reset_date DATE;

-- 2. Menu item variants
CREATE TABLE IF NOT EXISTS public.menu_item_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  price_diff_cents INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes varyantları görebilir"
  ON public.menu_item_variants FOR SELECT USING (TRUE);

CREATE POLICY "Satıcı varyant ekleyebilir"
  ON public.menu_item_variants FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Satıcı varyant güncelleyebilir"
  ON public.menu_item_variants FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Satıcı varyant silebilir"
  ON public.menu_item_variants FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

-- 3. Menu item extras
CREATE TABLE IF NOT EXISTS public.menu_item_extras (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.menu_item_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Herkes ekstraları görebilir"
  ON public.menu_item_extras FOR SELECT USING (TRUE);

CREATE POLICY "Satıcı ekstra ekleyebilir"
  ON public.menu_item_extras FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Satıcı ekstra güncelleyebilir"
  ON public.menu_item_extras FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Satıcı ekstra silebilir"
  ON public.menu_item_extras FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.sellers s ON mi.seller_id = s.id
      WHERE mi.id = menu_item_id AND s.user_id = auth.uid()
    )
  );

-- 4. Payment columns on orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (payment_status IN ('pending', 'paid', 'refunded'));

-- 5. Coupon columns
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_discount_cents INTEGER;

-- 6. Loyalty columns
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS free_deliveries_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS streak_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS referral_earnings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty ADD COLUMN IF NOT EXISTS last_order_date DATE;

COMMIT;
