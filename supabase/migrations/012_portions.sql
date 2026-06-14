-- Portion sizes for menu items
CREATE TABLE IF NOT EXISTS public.menu_item_portions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID        NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,  -- '1 Kişilik', '2 Kişilik', 'Aile Boyu'
  price_cents   INTEGER     NOT NULL,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  is_available  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.menu_item_portions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Herkes porsiyon görebilir" ON public.menu_item_portions FOR SELECT USING (true);
CREATE POLICY "Satıcı kendi porsiyonlarını yönetir" ON public.menu_item_portions FOR ALL USING (
  menu_item_id IN (SELECT id FROM public.menu_items WHERE seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()))
);
CREATE POLICY "Admin porsiyon yönetir" ON public.menu_item_portions FOR ALL USING (public.is_admin());
