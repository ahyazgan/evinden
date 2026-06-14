-- Weekly menu calendar (optional per seller)
CREATE TABLE IF NOT EXISTS public.weekly_menu (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  menu_item_id  UUID        NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  day_of_week   INTEGER     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Pazartesi
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(seller_id, menu_item_id, day_of_week)
);
ALTER TABLE public.weekly_menu ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Herkes haftalık menüyü görebilir" ON public.weekly_menu FOR SELECT USING (true);
CREATE POLICY "Satıcı kendi menüsünü yönetir" ON public.weekly_menu FOR ALL USING (
  seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid())
);
CREATE POLICY "Admin haftalık menüyü yönetir" ON public.weekly_menu FOR ALL USING (public.is_admin());

-- Flag on sellers table to indicate if they use weekly menu
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS uses_weekly_menu BOOLEAN NOT NULL DEFAULT FALSE;
