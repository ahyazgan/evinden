-- ═══ ADMIN RLS POLICIES ═══
-- Admin users (role = 'admin' in public.users) can read/write all data

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ═══ USERS ═══
CREATE POLICY "Admin tüm kullanıcıları görebilir"
  ON public.users FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin kullanıcıları güncelleyebilir"
  ON public.users FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admin kullanıcı silebilir"
  ON public.users FOR DELETE USING (public.is_admin());

-- ═══ SELLERS ═══
CREATE POLICY "Admin tüm satıcıları görebilir"
  ON public.sellers FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin satıcı güncelleyebilir"
  ON public.sellers FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admin satıcı silebilir"
  ON public.sellers FOR DELETE USING (public.is_admin());

-- ═══ MENU ITEMS ═══
CREATE POLICY "Admin tüm menü öğelerini görebilir"
  ON public.menu_items FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin menü öğesi güncelleyebilir"
  ON public.menu_items FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admin menü öğesi silebilir"
  ON public.menu_items FOR DELETE USING (public.is_admin());

-- ═══ ORDERS ═══
CREATE POLICY "Admin tüm siparişleri görebilir"
  ON public.orders FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin sipariş güncelleyebilir"
  ON public.orders FOR UPDATE USING (public.is_admin());

-- ═══ ORDER ITEMS ═══
CREATE POLICY "Admin tüm sipariş kalemlerini görebilir"
  ON public.order_items FOR SELECT USING (public.is_admin());

-- ═══ REVIEWS ═══
CREATE POLICY "Admin tüm yorumları görebilir"
  ON public.reviews FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin yorum silebilir"
  ON public.reviews FOR DELETE USING (public.is_admin());

-- ═══ COUPONS ═══
CREATE POLICY "Admin tüm kuponları görebilir"
  ON public.coupons FOR SELECT USING (public.is_admin());
CREATE POLICY "Admin kupon ekleyebilir"
  ON public.coupons FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admin kupon güncelleyebilir"
  ON public.coupons FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admin kupon silebilir"
  ON public.coupons FOR DELETE USING (public.is_admin());

-- ═══ NOTIFICATIONS ═══
CREATE POLICY "Admin tüm bildirimleri görebilir"
  ON public.notifications FOR SELECT USING (public.is_admin());

-- ═══ FAVORITES ═══
CREATE POLICY "Admin tüm favorileri görebilir"
  ON public.favorites FOR SELECT USING (public.is_admin());
