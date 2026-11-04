-- 025: Müşteri-satıcı mesajlaşması
--
-- Yazma yalnızca fonksiyonlardan yapılır; kurallar (engel, hız sınırı, uzunluk) tek yerde kalır.
-- Yeni mesaj bildirim tablosuna yazılır, push 019'daki tetikleyiciyle gider.
-- Uygunsuz içerik: karşı taraf engellenebilir ve mesaj yöneticiye bildirilebilir (mağaza kuralları da bunu ister).

BEGIN;

CREATE TABLE IF NOT EXISTS public.conversations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seller_id            UUID        NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  last_message_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview TEXT,
  customer_unread      INTEGER     NOT NULL DEFAULT 0,
  seller_unread        INTEGER     NOT NULL DEFAULT 0,
  blocked_by           TEXT        CHECK (blocked_by IN ('customer', 'seller')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, seller_id)
);
CREATE INDEX IF NOT EXISTS conversations_seller_idx ON public.conversations (seller_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_customer_idx ON public.conversations (customer_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role     TEXT        NOT NULL CHECK (sender_role IN ('customer', 'seller')),
  body            TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON public.messages (sender_id, created_at DESC);

-- Bildirilen mesajın metni kopyalanır: sohbet silinse de yönetici inceleyebilir.
CREATE TABLE IF NOT EXISTS public.message_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID        REFERENCES public.messages(id) ON DELETE SET NULL,
  reporter_id   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  reported_user UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  body_snapshot TEXT        NOT NULL,
  reason        TEXT        NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, reporter_id)
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.conversations, public.messages, public.message_reports FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = p_conversation
       AND (c.customer_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = c.seller_id AND s.user_id = auth.uid()))
  );
$$;

DROP POLICY IF EXISTS "Taraflar sohbeti görür" ON public.conversations;
CREATE POLICY "Taraflar sohbeti görür" ON public.conversations FOR SELECT
  USING (public.is_conversation_member(id));
DROP POLICY IF EXISTS "Taraflar mesajları görür" ON public.messages;
CREATE POLICY "Taraflar mesajları görür" ON public.messages FOR SELECT
  USING (public.is_conversation_member(conversation_id));
DROP POLICY IF EXISTS "Yönetici bildirilen mesajları görür" ON public.message_reports;
CREATE POLICY "Yönetici bildirilen mesajları görür" ON public.message_reports FOR SELECT
  USING (public.is_admin());

-- ── Gönderim ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._post_message(p_conversation uuid, p_role text, p_body text)
RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_conv public.conversations%ROWTYPE;
  v_seller public.sellers%ROWTYPE;
  v_sender_name text;
  v_row public.messages%ROWTYPE;
BEGIN
  IF length(v_body) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Mesaj 1-1000 karakter olmalı' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  SELECT * INTO v_seller FROM public.sellers WHERE id = v_conv.seller_id;
  IF v_conv.blocked_by IS NOT NULL THEN
    RAISE EXCEPTION 'Bu sohbette mesaj gönderilemiyor' USING ERRCODE = '55000';
  END IF;
  IF NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Bu satıcı şu anda mesaj alamıyor' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.messages m
       WHERE m.sender_id = v_uid AND m.created_at > now() - interval '1 minute') >= 20 THEN
    RAISE EXCEPTION 'Çok hızlı mesaj gönderiyorsunuz, biraz bekleyin' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, sender_role, body)
  VALUES (p_conversation, v_uid, p_role, v_body)
  RETURNING * INTO v_row;

  UPDATE public.conversations
     SET last_message_at = v_row.created_at,
         last_message_preview = left(v_body, 120),
         customer_unread = customer_unread + CASE WHEN p_role = 'seller' THEN 1 ELSE 0 END,
         seller_unread = seller_unread + CASE WHEN p_role = 'customer' THEN 1 ELSE 0 END
   WHERE id = p_conversation;

  IF p_role = 'customer' THEN
    SELECT coalesce(nullif(btrim(name), ''), 'Müşteri') INTO v_sender_name FROM public.users WHERE id = v_uid;
    PERFORM public.notify_user(v_seller.user_id, '💬 ' || v_sender_name, left(v_body, 120), 'message',
      jsonb_build_object('conversationId', p_conversation));
  ELSE
    PERFORM public.notify_user(v_conv.customer_id, '💬 ' || v_seller.display_name, left(v_body, 120), 'message',
      jsonb_build_object('conversationId', p_conversation));
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public._post_message(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Müşterinin ilk mesajı: sohbet yoksa açar. Sohbet kimliğini döndürür.
CREATE OR REPLACE FUNCTION public.send_message_to_seller(p_seller uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_seller public.sellers%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Mesaj göndermek için giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller;
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Bu satıcı şu anda mesaj alamıyor' USING ERRCODE = '55000';
  END IF;
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazanıza mesaj gönderemezsiniz' USING ERRCODE = '55000';
  END IF;

  SELECT id INTO v_id FROM public.conversations WHERE customer_id = v_uid AND seller_id = p_seller;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM public.conversations c
         WHERE c.customer_id = v_uid AND c.created_at > now() - interval '1 day') >= 30 THEN
      RAISE EXCEPTION 'Bugün çok fazla yeni sohbet başlattınız' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.conversations (customer_id, seller_id) VALUES (v_uid, p_seller)
    ON CONFLICT (customer_id, seller_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._post_message(v_id, 'customer', p_body);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.send_message_to_seller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message_to_seller(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public._conversation_role(p_conversation uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN c.customer_id = auth.uid() THEN 'customer'
    WHEN EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = c.seller_id AND s.user_id = auth.uid()) THEN 'seller'
  END
  FROM public.conversations c WHERE c.id = p_conversation;
$$;
REVOKE ALL ON FUNCTION public._conversation_role(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_message(p_conversation uuid, p_body text)
RETURNS public.messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := public._conversation_role(p_conversation);
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sohbet bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  RETURN public._post_message(p_conversation, v_role, p_body);
END $$;
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;

-- ── Okuma ──────────────────────────────────────────────────────────────────

-- users tablosunu istemciye açmadan karşı tarafın adını verir.
CREATE OR REPLACE FUNCTION public.get_my_conversations(p_as text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, my_role text, seller_id uuid, other_name text, other_image text,
  last_message_at timestamptz, last_message_preview text, unread_count integer, blocked_by text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, r.role, c.seller_id,
         CASE r.role WHEN 'customer' THEN s.display_name ELSE coalesce(nullif(btrim(u.name), ''), 'Müşteri') END,
         CASE r.role WHEN 'customer' THEN s.logo_url END,
         c.last_message_at, c.last_message_preview,
         CASE r.role WHEN 'customer' THEN c.customer_unread ELSE c.seller_unread END,
         c.blocked_by
    FROM public.conversations c
    JOIN public.sellers s ON s.id = c.seller_id
    JOIN public.users u ON u.id = c.customer_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.customer_id = auth.uid() THEN 'customer'
                  WHEN s.user_id = auth.uid() THEN 'seller' END AS role
    ) r
   WHERE r.role IS NOT NULL
     AND (p_as IS NULL OR r.role = p_as)
     AND (p_id IS NULL OR c.id = p_id)
   ORDER BY c.last_message_at DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.get_my_conversations(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := public._conversation_role(p_conversation);
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sohbet bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.conversations
     SET customer_unread = CASE WHEN v_role = 'customer' THEN 0 ELSE customer_unread END,
         seller_unread = CASE WHEN v_role = 'seller' THEN 0 ELSE seller_unread END
   WHERE id = p_conversation;
END $$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- ── Engelleme ve bildirme ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_conversation_blocked(p_conversation uuid, p_blocked boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text := public._conversation_role(p_conversation);
  v_current text;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sohbet bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  SELECT blocked_by INTO v_current FROM public.conversations WHERE id = p_conversation FOR UPDATE;
  -- Engeli yalnızca koyan taraf kaldırır; karşı taraf engelin üstüne yazamaz.
  IF v_current IS NOT NULL AND v_current <> v_role THEN
    RAISE EXCEPTION 'Bu sohbetin engeli size ait değil' USING ERRCODE = '55000';
  END IF;
  UPDATE public.conversations SET blocked_by = CASE WHEN p_blocked THEN v_role END WHERE id = p_conversation;
END $$;
REVOKE ALL ON FUNCTION public.set_conversation_blocked(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_blocked(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.report_message(p_message uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_msg public.messages%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  SELECT * INTO v_msg FROM public.messages WHERE id = p_message;
  IF NOT FOUND OR public._conversation_role(v_msg.conversation_id) IS NULL THEN
    RAISE EXCEPTION 'Mesaj bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.sender_id = auth.uid() THEN
    RAISE EXCEPTION 'Kendi mesajınızı bildiremezsiniz' USING ERRCODE = '55000';
  END IF;
  IF length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Bildirim nedeni 3-300 karakter olmalı' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.message_reports (message_id, reporter_id, reported_user, body_snapshot, reason)
  VALUES (p_message, auth.uid(), v_msg.sender_id, v_msg.body, v_reason)
  ON CONFLICT (message_id, reporter_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.notifications (user_id, title, body, type, data)
    SELECT u.id, 'Bildirilen mesaj', left(v_reason, 120), 'message_report', jsonb_build_object('messageId', p_message)
      FROM public.users u WHERE u.role = 'admin';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_close_report(p_report uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  UPDATE public.message_reports SET status = 'closed' WHERE id = p_report;
END $$;
REVOKE ALL ON FUNCTION public.admin_close_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_report(uuid) TO authenticated;

-- ── Canlı güncelleme ───────────────────────────────────────────────────────
-- orders da eklenir: uygulama sipariş değişikliğini dinliyordu ama tablo yayında hiç yoktu.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['orders', 'messages', 'conversations'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

COMMIT;
