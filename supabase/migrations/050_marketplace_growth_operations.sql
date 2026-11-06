-- 050: Pazar yeri operasyon güvenilirliği, büyüme raporları ve ölçek temelleri.
--
-- Güvenlik ilkesi:
-- - Para, kalem, destek, kampanya ve kurumsal alanlar doğrudan istemci yazımına kapalıdır.
-- - Değişiklikler RPC veya trigger üzerinden, kullanıcı/satıcı/yönetici bağlamı doğrulanarak yapılır.
-- - SLA cezası sipariş tutarını ve satıcı hakedişini değiştirmez; yalnızca kayıt ve takip içindir.

BEGIN;

-- ── 1. Operasyon alanları ──────────────────────────────────────────────────

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS eta_minutes INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS eta_updated_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'seller_courier';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_provider TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_tracking_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_mode_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_mode_check
      CHECK (delivery_mode IN ('seller_courier','platform_courier','hybrid'));
  END IF;
END $$;

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS marketplace_segment TEXT NOT NULL DEFAULT 'food';
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2);
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS quality_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sellers_marketplace_segment_check') THEN
    ALTER TABLE public.sellers ADD CONSTRAINT sellers_marketplace_segment_check
      CHECK (marketplace_segment IN ('food','market'));
  END IF;
END $$;

-- Yeni operasyon alanlarını istemci doğrudan yazamaz; yalnızca yönetici veya iç fonksiyonlar değiştirir.
CREATE OR REPLACE FUNCTION public.orders_lock_operation_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND NOT public._internal_call() THEN
    NEW.eta_minutes := OLD.eta_minutes;
    NEW.eta_updated_at := OLD.eta_updated_at;
    NEW.delivery_mode := OLD.delivery_mode;
    NEW.courier_provider := OLD.courier_provider;
    NEW.courier_tracking_code := OLD.courier_tracking_code;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_lock_operation_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_lock_operation_fields_trg ON public.orders;
CREATE TRIGGER orders_lock_operation_fields_trg BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_lock_operation_fields();

CREATE OR REPLACE FUNCTION public.sellers_lock_quality_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND NOT public._internal_call() THEN
    NEW.marketplace_segment := OLD.marketplace_segment;
    NEW.quality_score := OLD.quality_score;
    NEW.quality_updated_at := OLD.quality_updated_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sellers_lock_quality_fields() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sellers_lock_quality_fields_trg ON public.sellers;
CREATE TRIGGER sellers_lock_quality_fields_trg BEFORE UPDATE ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_lock_quality_fields();

-- ── 2. Ürün değiştirme onayı ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_item_substitutions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id         uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  original_title        text NOT NULL,
  replacement_title     text NOT NULL CHECK (length(btrim(replacement_title)) BETWEEN 2 AND 160),
  replacement_item_id   uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  reason                text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','rejected','expired')),
  customer_note         text CHECK (customer_note IS NULL OR length(customer_note) <= 300),
  expires_at            timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  responded_at          timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS order_item_substitutions_pending_unique
  ON public.order_item_substitutions(order_item_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS order_item_substitutions_order_idx
  ON public.order_item_substitutions(order_id, created_at DESC);

ALTER TABLE public.order_item_substitutions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.order_item_substitutions FROM anon, authenticated;
DROP POLICY IF EXISTS "order_item_substitutions_select" ON public.order_item_substitutions;
CREATE POLICY "order_item_substitutions_select" ON public.order_item_substitutions FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders o JOIN public.sellers s ON s.id = o.seller_id
                WHERE o.id = order_id AND s.user_id = auth.uid())
  );

-- ── 3. Destek konuşması, SLA ve ekler ─────────────────────────────────────

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  author_role text NOT NULL CHECK (author_role IN ('customer','admin','system')),
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 3000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON public.support_ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.support_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  message_id  uuid REFERENCES public.support_ticket_messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 3 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_attachments_ticket_idx ON public.support_attachments(ticket_id);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.support_ticket_messages, public.support_attachments FROM anon, authenticated;
DROP POLICY IF EXISTS "support_ticket_messages_select" ON public.support_ticket_messages;
CREATE POLICY "support_ticket_messages_select" ON public.support_ticket_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
                    AND (t.user_id = auth.uid() OR public.is_admin())));
DROP POLICY IF EXISTS "support_attachments_select" ON public.support_attachments;
CREATE POLICY "support_attachments_select" ON public.support_attachments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
                    AND (t.user_id = auth.uid() OR public.is_admin())));

-- ── 4. Fotoğraflı iade kanıtı ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refund_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 3 AND 500),
  description  text CHECK (description IS NULL OR length(description) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_evidence_order_idx ON public.refund_evidence(order_id);

ALTER TABLE public.refund_evidence ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.refund_evidence FROM anon, authenticated;
DROP POLICY IF EXISTS "refund_evidence_select" ON public.refund_evidence;
CREATE POLICY "refund_evidence_select" ON public.refund_evidence FOR SELECT
  USING (customer_id = auth.uid() OR public.is_admin());

-- Özel depolama kovası yalnızca gerçek Supabase'de bulunur; PGlite uyumlu kalmak için koşullu.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('support-evidence', 'support-evidence', false)
    ON CONFLICT (id) DO NOTHING;
    IF to_regclass('storage.objects') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'support evidence upload') THEN
        CREATE POLICY "support evidence upload" ON storage.objects FOR INSERT TO authenticated
          WITH CHECK (bucket_id = 'support-evidence'
            AND (storage.foldername(name))[1] = auth.uid()::text);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'support evidence owner read') THEN
        CREATE POLICY "support evidence owner read" ON storage.objects FOR SELECT TO authenticated
          USING (bucket_id = 'support-evidence' AND owner_id = auth.uid()::text);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'support evidence admin read') THEN
        CREATE POLICY "support evidence admin read" ON storage.objects FOR SELECT TO authenticated
          USING (bucket_id = 'support-evidence' AND public.is_admin());
      END IF;
    END IF;
  END IF;
END $$;

-- ── 6. Kampanya kârlılığı, kalite skoru ve birim ekonomi ───────────────────

INSERT INTO public.app_config (key, value) VALUES
  ('unit_economics', '{"delivery_cost_cents":2500,"support_cost_cents":500,"payment_fee_bps":290,"acquisition_cost_cents":0}'::jsonb),
  ('seller_quality', '{"review_weight":40,"cancellation_weight":25,"refund_weight":20,"sla_weight":15,"minimum_orders":5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_campaign_performance(p_days integer DEFAULT 30)
RETURNS TABLE (
  coupon_id uuid, code text, title text, seller_id uuid, seller_name text,
  redemptions integer, gross_cents integer, discount_cents integer, refunds integer,
  commission_cents integer, delivery_cost_cents integer, support_cost_cents integer,
  contribution_cents integer, margin_bps integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_econ jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'unit_economics'), '{}'::jsonb);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT c.id, c.code, coalesce(c.title, c.code), c.seller_id, s.display_name,
    count(o.id)::integer,
    coalesce(sum(o.subtotal_cents), 0)::integer,
    coalesce(sum(o.discount_cents), 0)::integer,
    count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer,
    coalesce(sum(o.commission_cents), 0)::integer,
    (count(o.id) * coalesce((v_econ->>'delivery_cost_cents')::integer, 0))::integer,
    (count(o.id) * coalesce((v_econ->>'support_cost_cents')::integer, 0))::integer,
    (coalesce(sum(o.commission_cents), 0)
      - coalesce(sum(CASE WHEN c.seller_id IS NULL THEN o.discount_cents ELSE 0 END), 0)
      - count(o.id) * (coalesce((v_econ->>'delivery_cost_cents')::integer, 0)
      + coalesce((v_econ->>'support_cost_cents')::integer, 0)))::integer,
    CASE WHEN coalesce(sum(o.subtotal_cents), 0) = 0 THEN 0 ELSE
      round(10000.0 * (coalesce(sum(o.commission_cents), 0)
      - coalesce(sum(CASE WHEN c.seller_id IS NULL THEN o.discount_cents ELSE 0 END), 0)
      - count(o.id) * (coalesce((v_econ->>'delivery_cost_cents')::integer, 0)
      + coalesce((v_econ->>'support_cost_cents')::integer, 0)))
      / coalesce(sum(o.subtotal_cents), 0))::integer END
  FROM public.coupons c
  LEFT JOIN public.orders o ON o.coupon_code = c.code AND o.created_at >= v_from
  LEFT JOIN public.sellers s ON s.id = c.seller_id
  WHERE c.created_at >= v_from - interval '30 days' OR o.id IS NOT NULL
  GROUP BY c.id, c.code, c.title, c.seller_id, s.display_name
  ORDER BY contribution_cents DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_campaign_performance(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_campaign_performance(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_campaign_performance(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_campaign_performance(integer) TO authenticated;

-- ── 7. Dinamik ETA ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.order_eta(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_seller public.sellers;
  v_uid uuid := auth.uid();
  v_prep integer;
  v_queue integer := 0;
  v_elapsed integer := 0;
  v_eta integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_uid IS NOT NULL AND NOT public.is_admin()
     AND v_uid IS DISTINCT FROM v_order.customer_id
     AND NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_order.seller_id AND s.user_id = v_uid) THEN
    RAISE EXCEPTION 'Bu siparişi göremezsin' USING ERRCODE = '42501';
  END IF;
  IF v_order.status IN ('delivered','cancelled') THEN
    RETURN jsonb_build_object('status', v_order.status, 'eta_minutes', NULL, 'eta_at', NULL, 'confidence', 'finished');
  END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = v_order.seller_id;
  v_prep := greatest(5, least(180, coalesce(v_seller.delivery_time_min, 20)));
  IF v_order.status IN ('pending','accepted','preparing') THEN
    SELECT count(*)::integer INTO v_queue FROM public.orders q
     WHERE q.seller_id = v_order.seller_id AND q.status IN ('pending','accepted','preparing')
       AND q.created_at < v_order.created_at;
    v_elapsed := floor(extract(epoch FROM (now() - coalesce(v_order.accepted_at, v_order.created_at))) / 60)::integer;
  END IF;
  IF v_order.status = 'pending' THEN
    v_eta := v_prep + least(45, v_queue * 5);
  ELSIF v_order.status = 'accepted' THEN
    v_eta := greatest(5, v_prep - v_elapsed) + least(30, v_queue * 3);
  ELSIF v_order.status = 'preparing' THEN
    v_eta := greatest(5, v_prep - v_elapsed) + 5;
  ELSIF v_order.status = 'ready' THEN
    v_eta := 10 + least(20, v_queue * 2);
  ELSE
    v_eta := 12;
  END IF;
  v_eta := greatest(5, least(240, v_eta));
  RETURN jsonb_build_object(
    'status', v_order.status, 'eta_minutes', v_eta,
    'eta_at', now() + make_interval(mins => v_eta),
    'confidence', CASE WHEN v_order.status = 'pending' THEN 'estimated' ELSE 'live' END,
    'queue_ahead', v_queue
  );
END $$;
REVOKE ALL ON FUNCTION public.order_eta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_eta(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.order_eta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_eta(uuid) TO authenticated;

-- ── 8. Ürün değiştirme teklif akışı ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.propose_item_substitution(
  p_order_item uuid, p_replacement_item uuid, p_replacement_title text,
  p_reason text, p_expires_minutes integer DEFAULT 15
) RETURNS public.order_item_substitutions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.order_items;
  v_order public.orders;
  v_replacement public.menu_items;
  v_row public.order_item_substitutions;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item;
  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = v_order.seller_id AND s.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501'; END IF;
  IF v_order.status NOT IN ('accepted','preparing') THEN
    RAISE EXCEPTION 'Ürün değişikliği yalnızca sipariş kabul edildikten sonra yapılabilir' USING ERRCODE = '22023';
  END IF;
  IF p_replacement_item IS NOT NULL THEN
    SELECT * INTO v_replacement FROM public.menu_items WHERE id = p_replacement_item;
    IF NOT FOUND OR v_replacement.seller_id <> v_order.seller_id OR NOT v_replacement.is_available THEN
      RAISE EXCEPTION 'Değişiklik ürünü mağazanda satışta değil' USING ERRCODE = '22023';
    END IF;
    IF v_replacement.price_cents <> v_item.unit_price_cents THEN
      RAISE EXCEPTION 'Pilot akışında yalnızca aynı fiyatlı ürün değişimi yapılabilir' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.order_item_substitutions (
    order_id, order_item_id, original_title, replacement_title, replacement_item_id, reason, expires_at
  ) VALUES (
    v_order.id, v_item.id, v_item.title_snapshot,
    left(btrim(coalesce(p_replacement_title, v_replacement.title)), 160),
    coalesce(p_replacement_item, v_replacement.id), left(btrim(p_reason), 500),
    now() + make_interval(mins => greatest(5, least(30, coalesce(p_expires_minutes, 15))))
  ) RETURNING * INTO v_row;
  PERFORM public.notify_user(v_order.customer_id, 'Ürün değişikliği önerildi',
    v_row.replacement_title || ' ürününe değiştirmemizi onaylıyor musun?', 'order_status',
    jsonb_build_object('orderId', v_order.id, 'substitutionId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) TO authenticated;


REVOKE ALL ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_item_substitution(
  p_substitution uuid, p_accept boolean, p_note text DEFAULT NULL
) RETURNS public.order_item_substitutions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.order_item_substitutions;
  v_order public.orders;
BEGIN
  SELECT * INTO v_row FROM public.order_item_substitutions WHERE id = p_substitution FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Değişiklik teklifi bulunamadı' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_row.order_id;
  IF v_order.customer_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Bu teklifi göremezsin' USING ERRCODE = '42501';
  END IF;
  -- Yanıtlanmış teklif yeniden yanıtlanamaz; önceki karar korunur.
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu teklif zaten yanıtlandı' USING ERRCODE = '22023';
  END IF;
  -- Süresi dolan ya da artık hazırlanmayan siparişteki teklif kapanır, kalem değişmez.
  IF v_row.expires_at <= now() OR v_order.status NOT IN ('accepted','preparing') THEN
    UPDATE public.order_item_substitutions SET status = 'expired', responded_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  UPDATE public.order_item_substitutions SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
    customer_note = left(coalesce(p_note, ''), 300), responded_at = now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  IF p_accept THEN
    UPDATE public.order_items SET title_snapshot = v_row.replacement_title, menu_item_id = v_row.replacement_item_id WHERE id = v_row.order_item_id;
    PERFORM public.notify_user((SELECT user_id FROM public.sellers WHERE id = v_order.seller_id),
      'Ürün değişikliği onaylandı', v_row.replacement_title || ' hazırlanacak.', 'order_status',
      jsonb_build_object('orderId', v_order.id));
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.respond_item_substitution(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_item_substitution(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.respond_item_substitution(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_item_substitution(uuid, boolean, text) TO authenticated;

-- ── 9. Destek SLA ve konuşma geçmişi ───────────────────────────────────────

INSERT INTO public.app_config (key, value) VALUES
  ('support_sla', '{"first_response_minutes":30,"resolution_minutes":1440,"breach_enabled":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_category text, p_message text, p_order uuid DEFAULT NULL
) RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.support_tickets;
  v_sla jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'support_sla'), '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Destek talebi için giriş yap' USING ERRCODE = '42501'; END IF;
  IF p_order IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders o LEFT JOIN public.sellers s ON s.id = o.seller_id
    WHERE o.id = p_order AND (o.customer_id = v_uid OR s.user_id = v_uid)
  ) THEN RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.support_tickets WHERE user_id = v_uid AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'Bugün çok fazla talep açtın, yarın tekrar dene' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.support_tickets (
    user_id, order_id, category, message, first_response_due_at
  ) VALUES (
    v_uid, p_order, p_category, btrim(p_message),
    now() + make_interval(mins => greatest(5, least(240, coalesce((v_sla->>'first_response_minutes')::integer, 30))))
  ) RETURNING * INTO v_row;
  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body)
  VALUES (v_row.id, v_uid, 'customer', v_row.message);
  PERFORM public.notify_user(u.id, 'Yeni destek talebi', left(v_row.message, 80), 'support',
                             jsonb_build_object('ticketId', v_row.id))
    FROM public.users u WHERE u.role = 'admin';
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_answer_support_ticket(p_ticket uuid, p_reply text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.support_tickets;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(coalesce(p_reply, '')), '') IS NULL THEN RAISE EXCEPTION 'Yanıt boş olamaz' USING ERRCODE = '55000'; END IF;
  UPDATE public.support_tickets SET reply = btrim(p_reply), replied_at = now(), status = 'answered',
    first_response_at = coalesce(first_response_at, now()) WHERE id = p_ticket RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Talep bulunamadı' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body)
  VALUES (v_row.id, auth.uid(), 'admin', left(v_row.reply, 3000));
  PERFORM public.notify_user(v_row.user_id, 'Destek talebin yanıtlandı', left(v_row.reply, 80), 'support',
                             jsonb_build_object('ticketId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_answer_support_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_answer_support_ticket(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_answer_support_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_answer_support_ticket(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(p_ticket uuid, p_message text)
RETURNS public.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.support_tickets;
BEGIN
  SELECT * INTO v_row FROM public.support_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND OR v_row.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Talep bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status = 'closed' THEN RAISE EXCEPTION 'Kapalı talep yanıtlanamaz' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body)
  VALUES (v_row.id, auth.uid(), 'customer', left(btrim(p_message), 3000));
  UPDATE public.support_tickets SET status = 'open' WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM public.notify_user(u.id, 'Destek talebine yeni mesaj', left(btrim(p_message), 80), 'support',
                             jsonb_build_object('ticketId', v_row.id)) FROM public.users u WHERE u.role = 'admin';
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.reply_support_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_ticket_history(p_ticket uuid)
RETURNS TABLE (id uuid, author_role text, body text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = p_ticket
                    AND (t.user_id = auth.uid() OR public.is_admin())) THEN
    RAISE EXCEPTION 'Talep bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT m.id, m.author_role, m.body, m.created_at
    FROM public.support_ticket_messages m WHERE m.ticket_id = p_ticket ORDER BY m.created_at;
END $$;
REVOKE ALL ON FUNCTION public.support_ticket_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_history(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.support_ticket_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_history(uuid) TO authenticated;

-- ── 10. Fotoğraflı iade talebi ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.request_refund_with_evidence(
  p_order uuid, p_reason text, p_evidence_paths jsonb DEFAULT '[]'::jsonb
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_path text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'delivered' THEN RAISE EXCEPTION 'İade yalnızca teslim edilmiş sipariş için istenebilir' USING ERRCODE = '22023'; END IF;
  IF coalesce(v_order.refund_status, 'none') <> 'none' THEN RAISE EXCEPTION 'Bu sipariş için iade talebi zaten var' USING ERRCODE = '23505'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'İade nedeni çok kısa' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_evidence_paths) <> 'array' OR jsonb_array_length(p_evidence_paths) > 5 THEN
    RAISE EXCEPTION 'En fazla 5 fotoğraf eklenebilir' USING ERRCODE = '22023';
  END IF;
  FOR v_path IN SELECT jsonb_array_elements_text(p_evidence_paths) LOOP
    -- Yol, depolama kuralıyla aynı biçimde müşterinin kendi klasöründe olmalı.
    IF v_path !~ '^[^/]+/.+/[^/]+$' OR split_part(v_path, '/', 1) <> auth.uid()::text THEN
      RAISE EXCEPTION 'Geçersiz fotoğraf yolu' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.refund_evidence (order_id, customer_id, storage_path)
    VALUES (p_order, auth.uid(), v_path);
  END LOOP;
  UPDATE public.orders SET refund_status = 'requested', refund_reason = left(btrim(p_reason), 500), updated_at = now()
   WHERE id = p_order RETURNING * INTO v_order;
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.request_refund_with_evidence(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_refund_with_evidence(uuid, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.request_refund_with_evidence(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_refund_with_evidence(uuid, text, jsonb) TO authenticated;

-- ── 12. Restoran kalite skoru ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_seller_quality(p_seller uuid)
RETURNS numeric LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_score numeric;
  v_orders integer;
  v_cancelled integer;
  v_refunded integer;
  v_sla integer;
  v_rating numeric;
  v_cfg jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'seller_quality'), '{}'::jsonb);
BEGIN
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.sellers s WHERE s.id = p_seller AND s.user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer,
    count(*) FILTER (WHERE o.status = 'cancelled')::integer,
    count(*) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer
    INTO v_orders, v_cancelled, v_refunded
    FROM public.orders o WHERE o.seller_id = p_seller AND o.created_at >= now() - interval '90 days';
  SELECT count(*)::integer INTO v_sla FROM public.sla_violations
    WHERE seller_id = p_seller AND occurred_at >= now() - interval '90 days' AND status <> 'waived';
  SELECT coalesce(s.rating_avg, 0) INTO v_rating FROM public.sellers s WHERE s.id = p_seller;
  IF v_orders < greatest(1, coalesce((v_cfg->>'minimum_orders')::integer, 5)) THEN
    v_score := 50;
  ELSE
    v_score := greatest(0, least(100,
      v_rating / 5.0 * coalesce((v_cfg->>'review_weight')::integer, 40)
      + (1.0 - v_cancelled::numeric / v_orders) * coalesce((v_cfg->>'cancellation_weight')::integer, 25)
      + (1.0 - v_refunded::numeric / v_orders) * coalesce((v_cfg->>'refund_weight')::integer, 20)
      + (1.0 - least(1.0, v_sla::numeric / v_orders)) * coalesce((v_cfg->>'sla_weight')::integer, 15)
    ));
  END IF;
  PERFORM set_config('app.internal', '1', true);
  UPDATE public.sellers SET quality_score = round(v_score, 2), quality_updated_at = now() WHERE id = p_seller;
  PERFORM set_config('app.internal', '', true);
  RETURN round(v_score, 2);
END $$;
REVOKE ALL ON FUNCTION public.refresh_seller_quality(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_seller_quality(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_seller_quality(p_days integer DEFAULT 90)
RETURNS TABLE (seller_id uuid, display_name text, score numeric, orders integer, cancelled integer, refunds integer, sla_violations integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.id, s.display_name, coalesce(s.quality_score, 0)::numeric,
    count(o.id)::integer,
    count(o.id) FILTER (WHERE o.status = 'cancelled')::integer,
    count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer,
    count(v.id)::integer
  FROM public.sellers s
  LEFT JOIN public.orders o ON o.seller_id = s.id AND o.created_at >= now() - make_interval(days => greatest(1, least(365, p_days)))
  LEFT JOIN public.sla_violations v ON v.seller_id = s.id AND v.occurred_at >= now() - make_interval(days => greatest(1, least(365, p_days))) AND v.status <> 'waived'
  GROUP BY s.id, s.display_name, s.quality_score
  ORDER BY coalesce(s.quality_score, 0) DESC, s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_seller_quality(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seller_quality(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_seller_quality(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seller_quality(integer) TO authenticated;

-- ── 13. Sipariş oluşturma idempotency'si ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_request_keys (
  customer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, request_key)
);
ALTER TABLE public.order_request_keys ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.order_request_keys FROM anon, authenticated;
DROP POLICY IF EXISTS "order_request_keys_select" ON public.order_request_keys;
CREATE POLICY "order_request_keys_select" ON public.order_request_keys FOR SELECT
  USING (customer_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.place_order_idempotent(
  p_request_key uuid,
  p_seller_id uuid, p_items jsonb, p_delivery_address text, p_notes text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash', p_coupon_code text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL, p_delivery_lat numeric DEFAULT NULL,
  p_delivery_lng numeric DEFAULT NULL, p_terms_version text DEFAULT NULL,
  p_fulfillment text DEFAULT 'delivery', p_scheduled_for timestamptz DEFAULT NULL,
  p_tip_cents integer DEFAULT 0
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders;
BEGIN
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'İstek anahtarı gerekli' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_key::text, 42));
  SELECT o.* INTO v_order FROM public.order_request_keys k JOIN public.orders o ON o.id = k.order_id
   WHERE k.customer_id = auth.uid() AND k.request_key = p_request_key;
  IF FOUND THEN RETURN v_order; END IF;
  v_order := public.place_order(
    p_seller_id, p_items, p_delivery_address, p_notes, p_payment_method, p_coupon_code,
    p_expected_total_cents, p_delivery_lat, p_delivery_lng, p_terms_version,
    p_fulfillment, p_scheduled_for, p_tip_cents
  );
  INSERT INTO public.order_request_keys (customer_id, request_key, order_id)
  VALUES (auth.uid(), p_request_key, v_order.id);
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.place_order_idempotent(uuid, uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_idempotent(uuid, uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer) TO authenticated;

-- Ödemesi başlatılmış ama uzun süredir sonuçlanmamış siparişler. Bunlar iptal edilmez; mutabakat sorgulanır.
CREATE OR REPLACE FUNCTION public.admin_unknown_payments(p_minutes integer DEFAULT 15)
RETURNS TABLE (order_id uuid, customer_name text, restaurant_name text, total_cents integer, payment_id text, last_error text, waiting_minutes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT o.id, u.name, s.display_name, o.total_cents, p.payment_id, p.last_error,
    floor(extract(epoch FROM (now() - coalesce(p.last_checked_at, o.created_at))) / 60)::integer
  FROM public.orders o
  JOIN public.order_payments p ON p.order_id = o.id
  LEFT JOIN public.users u ON u.id = o.customer_id
  JOIN public.sellers s ON s.id = o.seller_id
  WHERE o.payment_method = 'online' AND o.payment_status = 'pending' AND p.paid_at IS NULL
    AND p.closed_at IS NULL AND o.created_at <= now() - make_interval(mins => greatest(5, least(1440, p_minutes)))
  ORDER BY o.created_at LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_unknown_payments(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unknown_payments(integer) TO authenticated;

-- ── 14. Geri kazanım, birim ekonomi ve operasyon panosu ────────────────────

CREATE OR REPLACE FUNCTION public.admin_winback_customers(p_days integer DEFAULT 90)
RETURNS TABLE (customer_id uuid, customer_name text, last_order_at timestamptz, orders integer, spend_cents integer, days_since integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT u.id, u.name, max(o.created_at), count(o.id)::integer,
    coalesce(sum(o.total_cents), 0)::integer,
    floor(extract(epoch FROM (now() - max(o.created_at))) / 86400)::integer
  FROM public.users u JOIN public.orders o ON o.customer_id = u.id
  WHERE o.status = 'delivered' AND u.role = 'buyer'
  GROUP BY u.id, u.name
  HAVING max(o.created_at) <= now() - make_interval(days => greatest(14, least(365, p_days)))
     AND max(o.created_at) >= now() - interval '365 days'
  ORDER BY max(o.created_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_winback_customers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_winback_customers(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unit_economics(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_econ jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'unit_economics'), '{}'::jsonb);
  v_orders integer; v_gross integer; v_commission integer; v_discount integer;
  v_refunds integer; v_delivery_cost integer; v_support_cost integer; v_acquisition integer; v_payment_fee integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer, coalesce(sum(o.subtotal_cents), 0)::integer,
    coalesce(sum(o.commission_cents), 0)::integer, coalesce(sum(o.discount_cents), 0)::integer,
    count(o.id) FILTER (WHERE o.refund_status IN ('requested','approved'))::integer
    INTO v_orders, v_gross, v_commission, v_discount, v_refunds
    FROM public.orders o WHERE o.created_at >= v_from AND o.status <> 'cancelled';
  v_delivery_cost := v_orders * coalesce((v_econ->>'delivery_cost_cents')::integer, 0);
  v_support_cost := v_orders * coalesce((v_econ->>'support_cost_cents')::integer, 0);
  v_acquisition := v_orders * coalesce((v_econ->>'acquisition_cost_cents')::integer, 0);
  v_payment_fee := round(v_gross * coalesce((v_econ->>'payment_fee_bps')::numeric, 0) / 10000.0)::integer;
  RETURN jsonb_build_object(
    'days', v_days, 'orders', v_orders, 'gross_cents', v_gross, 'commission_cents', v_commission,
    'discount_cents', v_discount, 'refunds', v_refunds, 'delivery_cost_cents', v_delivery_cost,
    'support_cost_cents', v_support_cost, 'acquisition_cost_cents', v_acquisition, 'payment_fee_cents', v_payment_fee,
    'contribution_cents', v_commission - v_discount - v_delivery_cost - v_support_cost - v_acquisition - v_payment_fee,
    'contribution_per_order_cents', CASE WHEN v_orders = 0 THEN 0 ELSE
      round((v_commission - v_discount - v_delivery_cost - v_support_cost - v_acquisition - v_payment_fee)::numeric / v_orders)::integer END,
    'margin_bps', CASE WHEN v_gross = 0 THEN 0 ELSE
      round(10000.0 * (v_commission - v_discount - v_delivery_cost - v_support_cost - v_acquisition - v_payment_fee) / v_gross)::integer END
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_unit_economics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unit_economics(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_operations_pulse()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pending integer; v_late integer; v_sla integer; v_substitutions integer; v_unknown integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer INTO v_pending FROM public.orders WHERE status = 'pending';
  SELECT count(*)::integer INTO v_late FROM public.orders
   WHERE status IN ('pending','accepted','preparing') AND status_changed_at < now() - interval '30 minutes';
  SELECT count(*)::integer INTO v_sla FROM public.sla_violations WHERE status = 'open';
  SELECT count(*)::integer INTO v_substitutions FROM public.order_item_substitutions WHERE status = 'pending';
  SELECT count(*)::integer INTO v_unknown FROM public.orders o JOIN public.order_payments p ON p.order_id = o.id
   WHERE o.payment_method = 'online' AND o.payment_status = 'pending' AND p.paid_at IS NULL AND p.closed_at IS NULL
     AND o.created_at < now() - interval '15 minutes';
  RETURN jsonb_build_object('pending_orders', v_pending, 'late_orders', v_late, 'open_sla', v_sla,
    'pending_substitutions', v_substitutions, 'unknown_payments', v_unknown);
END $$;
REVOKE ALL ON FUNCTION public.admin_operations_pulse() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_pulse() TO authenticated;

-- ── 15. Market/POS entegrasyon ve kurumsal çalışma alanı temelleri ────────

CREATE TABLE IF NOT EXISTS public.seller_integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('pos','menu_feed','courier')),
  external_id text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error','disabled')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, provider, external_id)
);
ALTER TABLE public.seller_integrations ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.seller_integrations FROM anon, authenticated;
DROP POLICY IF EXISTS "seller_integrations_select" ON public.seller_integrations;
CREATE POLICY "seller_integrations_select" ON public.seller_integrations FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.corporate_workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  monthly_budget_cents integer CHECK (monthly_budget_cents IS NULL OR monthly_budget_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.corporate_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.corporate_workspaces FROM anon, authenticated;
DROP POLICY IF EXISTS "corporate_workspaces_owner_select" ON public.corporate_workspaces;
CREATE POLICY "corporate_workspaces_owner_select" ON public.corporate_workspaces FOR SELECT
  USING (owner_id = auth.uid() OR public.is_admin());


CREATE OR REPLACE FUNCTION public.request_corporate_workspace(p_name text, p_budget_cents integer DEFAULT NULL)
RETURNS public.corporate_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.corporate_workspaces;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısınız' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.corporate_workspaces (owner_id, name, monthly_budget_cents)
  VALUES (auth.uid(), left(btrim(p_name), 120), p_budget_cents) RETURNING * INTO v_row;
  PERFORM public.notify_user(u.id, 'Kurumsal çalışma alanı talebi', v_row.name || ' onay bekliyor.', 'system',
    jsonb_build_object('workspaceId', v_row.id)) FROM public.users u WHERE u.role = 'admin';
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_corporate_workspace(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_corporate_workspace(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_approve_corporate_workspace(p_workspace uuid, p_approve boolean)
RETURNS public.corporate_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.corporate_workspaces;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  UPDATE public.corporate_workspaces SET status = CASE WHEN p_approve THEN 'active' ELSE 'suspended' END, updated_at = now()
   WHERE id = p_workspace RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Çalışma alanı bulunamadı' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.notify_user(v_row.owner_id, 'Kurumsal çalışma alanı durumu',
    CASE WHEN p_approve THEN 'Çalışma alanın onaylandı.' ELSE 'Çalışma alanın askıya alındı.' END,
    'system', jsonb_build_object('workspaceId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_approve_corporate_workspace(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_corporate_workspace(uuid, boolean) TO authenticated;

-- Canlıya alma kapısı: uygulama ayarları ve kritik dış bağımlılıklar tek raporda görünür.
CREATE OR REPLACE FUNCTION public.admin_launch_readiness()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_legal jsonb := coalesce((SELECT value FROM public.app_config WHERE key = 'platform_legal'), '{}'::jsonb);
  v_sms boolean; v_phone boolean; v_iyzico boolean; v_einvoice boolean;
  v_pending_sellers integer; v_pending_orders integer;
  v_legal_complete boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT coalesce((value->>'required')::boolean, false) INTO v_phone FROM public.app_config WHERE key = 'phone_verification';
  SELECT coalesce((value->>'enabled')::boolean, false) INTO v_sms FROM public.app_config WHERE key = 'sms_provider';
  SELECT coalesce((value->>'enabled')::boolean, false) INTO v_iyzico FROM public.app_config WHERE key = 'iyzico_marketplace';
  SELECT coalesce((value->>'enabled')::boolean, false) INTO v_einvoice FROM public.app_config WHERE key = 'einvoice_policy';
  SELECT count(*)::integer INTO v_pending_sellers FROM public.sellers WHERE NOT is_active;
  SELECT count(*)::integer INTO v_pending_orders FROM public.orders WHERE status = 'pending';
  v_legal_complete := coalesce(nullif(btrim(v_legal->>'title'), ''), '') <> ''
    AND coalesce(nullif(btrim(v_legal->>'address'), ''), '') <> ''
    AND coalesce(nullif(btrim(v_legal->>'tax_number'), ''), '') <> '';
  RETURN jsonb_build_object(
    'legal_complete', v_legal_complete, 'sms_ready', v_sms, 'phone_verification_enabled', v_phone,
    'iyzico_marketplace_enabled', v_iyzico, 'einvoice_enabled', v_einvoice,
    'pending_sellers', v_pending_sellers, 'pending_orders', v_pending_orders,
    'ready', v_legal_complete AND v_pending_orders = 0
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_launch_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_launch_readiness() TO authenticated;

COMMIT;