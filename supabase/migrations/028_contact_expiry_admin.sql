-- 028: Satıcının müşteriye ulaşması, cevapsız sipariş, hesap askıya alma, toplu duyuru, bildirim silme
--
-- Telefon yalnızca sipariş sürerken görünür; teslim veya iptalden sonra satıcıya kapanır.
-- Cevapsız sipariş kuralı 029'daki zamanlanmış görevle çalışır.

BEGIN;

-- ── 1. Satıcı siparişteki müşteriyi görür ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_seller_order_contacts(p_seller uuid)
RETURNS TABLE (order_id uuid, customer_name text, customer_phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = p_seller AND s.user_id = auth.uid())
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Bu mağazanın siparişlerini göremezsiniz' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT o.id,
           u.name,
           CASE WHEN o.status IN ('pending', 'accepted', 'preparing', 'ready') THEN u.phone END
      FROM public.orders o
      LEFT JOIN public.users u ON u.id = o.customer_id
     WHERE o.seller_id = p_seller;
END $$;
REVOKE ALL ON FUNCTION public.get_seller_order_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_order_contacts(uuid) TO authenticated;

-- Satıcı siparişten sohbet açar. Sipariş sürüyorsa ya da son 7 gün içindeyse.
CREATE OR REPLACE FUNCTION public.open_order_conversation(p_order uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = v_order.seller_id AND s.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Bu siparişe erişemezsiniz' USING ERRCODE = '42501';
  END IF;
  IF v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'Müşteri hesabını silmiş' USING ERRCODE = '55000';
  END IF;
  IF v_order.status IN ('delivered', 'cancelled') AND v_order.created_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Bu sipariş için mesajlaşma süresi doldu' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.conversations (customer_id, seller_id)
  VALUES (v_order.customer_id, v_order.seller_id)
  ON CONFLICT (customer_id, seller_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.open_order_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_order_conversation(uuid) TO authenticated;

-- ── 2. Cevapsız sipariş ───────────────────────────────────────────────────────

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pending_reminded_at TIMESTAMPTZ;

-- Online siparişte süre ödeme alınınca başlar, oluşturulunca değil.
CREATE OR REPLACE FUNCTION public.orders_pending_since()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    NEW.pending_since := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_pending_since_trg ON public.orders;
CREATE TRIGGER orders_pending_since_trg
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_pending_since();

-- Önce satıcıya hatırlatır, süre dolunca iptal eder. Müşteriye bildirim orders_notify ile gider;
-- ödemesi alınmış siparişte iade 022'deki kuralla başlar.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer;
BEGIN
  FOR v_row IN
    SELECT o.id, s.user_id
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'pending'
       AND o.pending_reminded_at IS NULL
       AND COALESCE(o.pending_since, o.created_at) < now() - make_interval(mins => p_remind_minutes)
       AND COALESCE(o.pending_since, o.created_at) >= now() - make_interval(mins => p_cancel_minutes)
  LOOP
    PERFORM public.notify_user(
      v_row.user_id,
      'Bekleyen siparişin var',
      'Yanıtlamazsan sipariş iptal edilecek.',
      'order_status',
      jsonb_build_object('orderId', v_row.id)
    );
    UPDATE public.orders SET pending_reminded_at = now() WHERE id = v_row.id;
  END LOOP;

  UPDATE public.orders
     SET status = 'cancelled', cancel_reason = 'Satıcı zamanında yanıtlamadı', updated_at = now()
   WHERE status = 'pending'
     AND COALESCE(pending_since, created_at) < now() - make_interval(mins => p_cancel_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.expire_pending_orders(integer, integer) FROM PUBLIC, anon, authenticated;

-- ── 3. Hesap askıya alma ──────────────────────────────────────────────────────

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.users_suspend_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.is_suspended := OLD.is_suspended;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_suspend_guard_trg ON public.users;
CREATE TRIGGER users_suspend_guard_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_suspend_guard();

CREATE OR REPLACE FUNCTION public.admin_set_user_suspended(p_user uuid, p_suspended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkiniz yok' USING ERRCODE = '42501';
  END IF;
  IF p_suspended AND EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND role = 'admin') THEN
    RAISE EXCEPTION 'Yönetici hesabı askıya alınamaz' USING ERRCODE = '55000';
  END IF;
  UPDATE public.users SET is_suspended = p_suspended WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı' USING ERRCODE = '55000';
  END IF;
  -- Askıdaki satıcı sipariş alamaz; açılınca mağazayı kendisi yeniden başlatır.
  IF p_suspended THEN
    UPDATE public.sellers SET is_paused = TRUE WHERE user_id = p_user;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_user_suspended(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_suspended(uuid, boolean) TO authenticated;

-- Askıdaki hesap sipariş veremez, mesaj atamaz.
CREATE OR REPLACE FUNCTION public.block_suspended_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_suspended) THEN
    RAISE EXCEPTION 'Hesabın askıya alındı. Destek için destek@evinden.app' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_block_suspended_trg ON public.orders;
CREATE TRIGGER orders_block_suspended_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_user();

DROP TRIGGER IF EXISTS messages_block_suspended_trg ON public.messages;
CREATE TRIGGER messages_block_suspended_trg
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_user();

-- ── 4. Toplu duyuru ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_broadcast(p_title text, p_body text, p_audience text DEFAULT 'all')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_body  text := btrim(COALESCE(p_body, ''));
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkiniz yok' USING ERRCODE = '42501';
  END IF;
  IF p_audience NOT IN ('all', 'buyer', 'seller') THEN
    RAISE EXCEPTION 'Geçersiz hedef kitle' USING ERRCODE = '22023';
  END IF;
  IF length(v_title) = 0 OR length(v_title) > 80 THEN
    RAISE EXCEPTION 'Başlık 1-80 karakter olmalı' USING ERRCODE = '22023';
  END IF;
  IF length(v_body) = 0 OR length(v_body) > 300 THEN
    RAISE EXCEPTION 'Metin 1-300 karakter olmalı' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, data)
  SELECT u.id, v_title, v_body, 'promo', '{}'::jsonb
    FROM public.users u
   WHERE NOT u.is_suspended
     AND u.role <> 'admin'
     AND (p_audience = 'all' OR u.role = p_audience);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.admin_broadcast(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast(text, text, text) TO authenticated;

-- ── 5. Kullanıcı kendi bildirimini silebilir ──────────────────────────────────

DROP POLICY IF EXISTS "Kullanıcı kendi bildirimini silebilir" ON public.notifications;
CREATE POLICY "Kullanıcı kendi bildirimini silebilir" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

COMMIT;
