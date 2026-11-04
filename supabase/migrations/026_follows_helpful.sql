-- 026: Kalıcı "Takip Et" ve "Faydalı"
--
-- Takip duyuru almak içindir; favori yalnızca kişisel listedir. Duyuruyu bu yüzden takipçiler alır.
-- Faydalı sayısı tetikleyiciyle tutulur: üye hesabını silse de sayı doğru kalır.

BEGIN;

CREATE TABLE IF NOT EXISTS public.seller_follows (
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seller_id  UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, seller_id)
);
CREATE INDEX IF NOT EXISTS seller_follows_seller_idx ON public.seller_follows (seller_id);
ALTER TABLE public.seller_follows ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE ON public.seller_follows FROM anon, authenticated;
REVOKE ALL ON public.seller_follows FROM anon;

DROP POLICY IF EXISTS "Kullanıcı takiplerini görür" ON public.seller_follows;
CREATE POLICY "Kullanıcı takiplerini görür" ON public.seller_follows FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Kullanıcı aktif satıcıyı takip eder" ON public.seller_follows;
CREATE POLICY "Kullanıcı aktif satıcıyı takip eder" ON public.seller_follows FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.is_active AND s.user_id IS DISTINCT FROM auth.uid())
  );
DROP POLICY IF EXISTS "Kullanıcı takibi bırakır" ON public.seller_follows;
CREATE POLICY "Kullanıcı takibi bırakır" ON public.seller_follows FOR DELETE USING (auth.uid() = user_id);

-- Takipçilerin kim olduğu gizli kalır, yalnızca sayı döner.
CREATE OR REPLACE FUNCTION public.get_seller_follow_state(p_seller uuid)
RETURNS TABLE (is_following boolean, follower_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(bool_or(f.user_id = auth.uid()), FALSE), count(*)::integer
    FROM public.seller_follows f WHERE f.seller_id = p_seller;
$$;
REVOKE ALL ON FUNCTION public.get_seller_follow_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_follow_state(uuid) TO anon, authenticated;

-- Menüye art arda yemek ekleyen satıcı takipçilerini boğmasın: saatte en çok bir duyuru.
CREATE OR REPLACE FUNCTION public.notify_my_followers(p_title text, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers%ROWTYPE;
BEGIN
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Yalnızca aktif satıcılar duyuru yapabilir' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_title, '')) NOT BETWEEN 1 AND 100 OR length(coalesce(p_body, '')) > 300 THEN
    RAISE EXCEPTION 'Duyuru metni geçersiz' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.type = 'seller_update' AND n.data->>'sellerId' = v_seller.id::text
       AND n.created_at > now() - interval '1 hour'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, data)
  SELECT f.user_id, p_title, p_body, 'seller_update', jsonb_build_object('sellerId', v_seller.id)
    FROM public.seller_follows f WHERE f.seller_id = v_seller.id;
END $$;

-- ── Faydalı ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_helpful (
  review_id  UUID        NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);
ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE ON public.review_helpful FROM anon, authenticated;
REVOKE ALL ON public.review_helpful FROM anon;

DROP POLICY IF EXISTS "Kullanıcı oylarını görür" ON public.review_helpful;
CREATE POLICY "Kullanıcı oylarını görür" ON public.review_helpful FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Kullanıcı başkasının yorumunu oylar" ON public.review_helpful;
CREATE POLICY "Kullanıcı başkasının yorumunu oylar" ON public.review_helpful FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id AND r.customer_id IS DISTINCT FROM auth.uid())
  );
DROP POLICY IF EXISTS "Kullanıcı oyunu geri alır" ON public.review_helpful;
CREATE POLICY "Kullanıcı oyunu geri alır" ON public.review_helpful FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.review_helpful_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.review_id ELSE NEW.review_id END;
  -- Hesap silme de bu işareti kullanır: tetikleyici işareti bulduğu gibi bırakmalı.
  v_flag text := coalesce(current_setting('app.internal', true), '');
BEGIN
  PERFORM set_config('app.internal', '1', true);
  -- Satır ayrı komutta kilitlenir: aynı anda gelen iki oyda ikinci sayım birincinin oyunu da görür.
  PERFORM 1 FROM public.reviews WHERE id = v_review FOR UPDATE;
  UPDATE public.reviews r
     SET helpful_count = (SELECT count(*) FROM public.review_helpful h WHERE h.review_id = v_review)
   WHERE r.id = v_review;
  PERFORM set_config('app.internal', v_flag, true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS review_helpful_count_trg ON public.review_helpful;
CREATE TRIGGER review_helpful_count_trg
  AFTER INSERT OR DELETE ON public.review_helpful
  FOR EACH ROW EXECUTE FUNCTION public.review_helpful_count();

COMMIT;
