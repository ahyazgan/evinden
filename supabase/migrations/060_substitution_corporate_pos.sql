-- 060: 050'de altyapısı olup ekranı olmayan üç özelliğin tamamlanması.
--
-- 1. Ürün değiştirme teklifi: yalnızca menüdeki aynı fiyatlı ürün önerilebilir (serbest metinle kalem
--    içeriği doğrulanamıyordu), bir kalem için en çok 3 teklif, red de restorana bildirilir, teklif canlı izlenir.
-- 2. Kurumsal hesap: onaylanan şirket bir katılım kodu alır, çalışanlar kodla katılır. Çalışan sepette
--    "şirket siparişi" seçerse sipariş şirketin aylık bütçesinden düşer, bütçe aşılırsa sipariş açılmaz.
--    Ödemeyi çalışan yapar; şirket harcamayı kişi bazında izler (şirketin ödemesi iyzico ve mali müşaviri bekliyor).
-- 3. POS bağlantısı: restoranın verdiği HTTPS adresine yeni sipariş ve durum değişikliği imzalı olarak gönderilir;
--    POS kendi API anahtarıyla menüyü okuyup ürünleri "bitti" yapabilir.
--
-- Çift sipariş koruması (place_order_idempotent) şirket alanıyla yeniden kurulur; uygulama artık bunu çağırır.

BEGIN;

-- ── 1. Ürün değiştirme teklifi ─────────────────────────────────────────────

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sipariş kalemi bulunamadı' USING ERRCODE = 'P0002'; END IF;
  -- Aynı siparişe iki teklif aynı anda yazılmasın.
  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = v_order.seller_id AND s.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('accepted','preparing') THEN
    RAISE EXCEPTION 'Ürün değişikliği yalnızca kabul edilen ve hazırlanan siparişte önerilebilir' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Nedeni 3 ile 500 karakter arasında yaz' USING ERRCODE = '22023';
  END IF;
  IF p_replacement_item IS NULL THEN
    RAISE EXCEPTION 'Menünden bir ürün seç' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_replacement FROM public.menu_items WHERE id = p_replacement_item;
  IF NOT FOUND OR v_replacement.seller_id <> v_order.seller_id OR NOT v_replacement.is_available
     OR (v_replacement.daily_limit > 0 AND v_replacement.daily_limit <= CASE
           WHEN v_replacement.stock_reset_date = (now() AT TIME ZONE 'Europe/Istanbul')::date THEN v_replacement.sold_today ELSE 0 END) THEN
    RAISE EXCEPTION 'Önerdiğin ürün menünde satışta değil' USING ERRCODE = '22023';
  END IF;
  IF v_replacement.id IS NOT DISTINCT FROM v_item.menu_item_id THEN
    RAISE EXCEPTION 'Aynı ürünü öneremezsin' USING ERRCODE = '22023';
  END IF;
  IF v_replacement.price_cents <> v_item.unit_price_cents THEN
    RAISE EXCEPTION 'Yalnızca aynı fiyatlı ürün önerebilirsin' USING ERRCODE = '22023';
  END IF;
  -- Porsiyon, çeşit, ekstra ya da seçim içeren kalemde müşterinin seçimleri yeni ürüne taşınamaz.
  IF v_item.title_snapshot IS DISTINCT FROM (SELECT title FROM public.menu_items WHERE id = v_item.menu_item_id) THEN
    RAISE EXCEPTION 'Seçimli ürünlerde değişiklik önerilemez; müşteriyle mesajlaş' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_option_groups g WHERE g.menu_item_id = v_replacement.id AND g.min_select > 0) THEN
    RAISE EXCEPTION 'Zorunlu seçimi olan ürün önerilemez' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_item_substitutions WHERE order_item_id = v_item.id AND status = 'pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Bu ürün için yanıt bekleyen bir teklifin var' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.order_item_substitutions WHERE order_item_id = v_item.id) >= 3 THEN
    RAISE EXCEPTION 'Bu ürün için en çok 3 teklif gönderebilirsin' USING ERRCODE = '55000';
  END IF;
  -- Süresi dolmuş ama yanıtlanmamış teklif kapanır; benzersiz dizin yenisine yer açar.
  UPDATE public.order_item_substitutions SET status = 'expired', responded_at = now()
   WHERE order_item_id = v_item.id AND status = 'pending';

  INSERT INTO public.order_item_substitutions (
    order_id, order_item_id, original_title, replacement_title, replacement_item_id, reason, expires_at
  ) VALUES (
    v_order.id, v_item.id, v_item.title_snapshot, left(v_replacement.title, 160), v_replacement.id,
    left(btrim(p_reason), 500),
    now() + make_interval(mins => greatest(5, least(30, coalesce(p_expires_minutes, 15))))
  ) RETURNING * INTO v_row;
  PERFORM public.notify_user(v_order.customer_id, 'Ürün değişikliği önerisi',
    v_row.original_title || ' yerine ' || v_row.replacement_title || ' olur mu? ' || v_row.reason, 'order_status',
    jsonb_build_object('orderId', v_order.id, 'substitutionId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_item_substitution(uuid, uuid, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_item_substitution(
  p_substitution uuid, p_accept boolean, p_note text DEFAULT NULL
) RETURNS public.order_item_substitutions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.order_item_substitutions;
  v_order public.orders;
  v_seller_user uuid;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_item public.order_items;
  v_rep public.menu_items;
  v_today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_sold integer;
  v_pos uuid;
BEGIN
  SELECT * INTO v_row FROM public.order_item_substitutions WHERE id = p_substitution FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Değişiklik teklifi bulunamadı' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_row.order_id;
  IF v_order.customer_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Bu teklifi göremezsin' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Bu teklif zaten yanıtlandı' USING ERRCODE = '22023';
  END IF;
  SELECT user_id INTO v_seller_user FROM public.sellers WHERE id = v_order.seller_id;
  IF v_row.expires_at <= now() OR v_order.status NOT IN ('accepted','preparing') THEN
    UPDATE public.order_item_substitutions SET status = 'expired', responded_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  IF p_accept THEN
    SELECT * INTO v_item FROM public.order_items WHERE id = v_row.order_item_id;
    SELECT * INTO v_rep FROM public.menu_items WHERE id = v_row.replacement_item_id FOR UPDATE;
    v_sold := CASE WHEN v_rep.stock_reset_date = v_today THEN v_rep.sold_today ELSE 0 END;
    -- Öneriden sonra ürün bittiyse kabul edilemez; restoran başka öneri yapabilir.
    IF v_rep.id IS NULL OR NOT v_rep.is_available OR (v_rep.daily_limit > 0 AND v_sold + v_item.quantity > v_rep.daily_limit) THEN
      UPDATE public.order_item_substitutions SET status = 'expired', customer_note = v_note, responded_at = now()
       WHERE id = v_row.id RETURNING * INTO v_row;
      PERFORM public.notify_user(v_seller_user, 'Ürün değişikliği geçersiz',
        v_row.replacement_title || ' artık satışta olmadığı için önerin geçersiz oldu. Başka bir ürün önerebilirsin.',
        'order_status', jsonb_build_object('orderId', v_order.id));
      RETURN v_row;
    END IF;
    -- Günlük adet: yeni üründen düşülür, eski ürüne iade edilir (iptalde orders_restock yeni ürüne geri verir).
    IF v_rep.daily_limit > 0 THEN
      UPDATE public.menu_items SET sold_today = v_sold + v_item.quantity, stock_reset_date = v_today WHERE id = v_rep.id;
    END IF;
    UPDATE public.menu_items SET sold_today = greatest(sold_today - v_item.quantity, 0)
     WHERE id = v_item.menu_item_id AND daily_limit > 0
       AND stock_reset_date = (v_order.created_at AT TIME ZONE 'Europe/Istanbul')::date;
  END IF;
  UPDATE public.order_item_substitutions
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END, customer_note = v_note, responded_at = now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  IF p_accept THEN
    UPDATE public.order_items SET title_snapshot = v_row.replacement_title, menu_item_id = v_row.replacement_item_id
     WHERE id = v_row.order_item_id;
    -- Mutfak fişi POS'ta da güncellensin.
    SELECT id INTO v_pos FROM public.seller_integrations
     WHERE seller_id = v_order.seller_id AND provider = 'pos' AND status = 'active' LIMIT 1;
    IF v_pos IS NOT NULL THEN
      PERFORM public._pos_send(v_pos, 'order.updated', v_order.id,
        public._pos_order_payload((SELECT o FROM public.orders o WHERE o.id = v_order.id)));
    END IF;
    PERFORM public.notify_user(v_seller_user, 'Ürün değişikliği onaylandı',
      v_row.replacement_title || ' hazırlanacak.', 'order_status', jsonb_build_object('orderId', v_order.id));
  ELSE
    PERFORM public.notify_user(v_seller_user, 'Ürün değişikliği reddedildi',
      v_row.original_title || ' için önerin kabul edilmedi.' || coalesce(' Not: ' || v_note, '')
        || ' Müşteriyle yazışabilir ya da siparişi iptal edebilirsin.',
      'order_status', jsonb_build_object('orderId', v_order.id));
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.respond_item_substitution(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_item_substitution(uuid, boolean, text) TO authenticated;

-- ── 2. Kurumsal hesap ──────────────────────────────────────────────────────

ALTER TABLE public.corporate_workspaces ADD COLUMN IF NOT EXISTS join_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS corporate_workspaces_join_code_unique
  ON public.corporate_workspaces(join_code) WHERE join_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.corporate_workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.corporate_workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  PRIMARY KEY (workspace_id, user_id)
);
-- Bir kişi aynı anda tek şirkette etkin üyedir: sepette hangi bütçenin düşeceği belirsiz kalmaz.
CREATE UNIQUE INDEX IF NOT EXISTS corporate_workspace_members_one_active
  ON public.corporate_workspace_members(user_id) WHERE status = 'active';
ALTER TABLE public.corporate_workspace_members ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.corporate_workspace_members FROM anon, authenticated;
DROP POLICY IF EXISTS "corporate_workspace_members_select" ON public.corporate_workspace_members;
CREATE POLICY "corporate_workspace_members_select" ON public.corporate_workspace_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- Kod denemesi sınırı: 8 karakterlik kod tahminle bulunamasın.
CREATE TABLE IF NOT EXISTS public.corporate_join_attempts (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corporate_join_attempts_user_idx ON public.corporate_join_attempts(user_id, created_at DESC);
ALTER TABLE public.corporate_join_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corporate_join_attempts FROM anon, authenticated;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS corporate_workspace_id uuid
  REFERENCES public.corporate_workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_corporate_workspace_idx
  ON public.orders(corporate_workspace_id, created_at DESC) WHERE corporate_workspace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.orders_lock_corporate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND NOT public._internal_call() THEN
    NEW.corporate_workspace_id := OLD.corporate_workspace_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_lock_corporate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_lock_corporate_trg ON public.orders;
CREATE TRIGGER orders_lock_corporate_trg BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_lock_corporate();

CREATE OR REPLACE FUNCTION public._corporate_month_start()
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
$$;
REVOKE ALL ON FUNCTION public._corporate_month_start() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._corporate_spent_cents(p_workspace uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(total_cents), 0)::integer FROM public.orders
   WHERE corporate_workspace_id = p_workspace AND status <> 'cancelled'
     AND created_at >= p_from AND created_at < p_to
$$;
REVOKE ALL ON FUNCTION public._corporate_spent_cents(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._corporate_new_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash bytea;
  v_code text;
  i integer;
BEGIN
  LOOP
    -- gen_random_uuid kriptografik rastgeleliktir; random() tahmin edilebilir.
    v_hash := sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'));
    v_code := '';
    FOR i IN 0..7 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_hash, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.corporate_workspaces WHERE join_code = v_code);
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public._corporate_new_code() FROM PUBLIC, anon, authenticated;

-- Talep: aynı anda tek bekleyen talep, günde en çok 3; başka şirkette üyeyken talep açılmaz.
CREATE OR REPLACE FUNCTION public.request_corporate_workspace(p_name text, p_budget_cents integer DEFAULT NULL)
RETURNS public.corporate_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.corporate_workspaces;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Şirket adını 2 ile 120 karakter arasında yaz' USING ERRCODE = '22023';
  END IF;
  IF p_budget_cents IS NOT NULL AND p_budget_cents NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Aylık bütçe 0 ile 1.000.000 TL arasında olmalı' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_workspace_members WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Zaten bir şirket hesabındasın; önce oradan ayrıl' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_workspaces WHERE owner_id = auth.uid() AND status = 'pending') THEN
    RAISE EXCEPTION 'Onay bekleyen bir talebin zaten var' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.corporate_workspaces WHERE owner_id = auth.uid() AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'Bugün çok fazla talep açtın, yarın tekrar dene' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.corporate_workspaces (owner_id, name, monthly_budget_cents)
  VALUES (auth.uid(), btrim(p_name), p_budget_cents) RETURNING * INTO v_row;
  PERFORM public.notify_user(u.id, 'Kurumsal hesap talebi', v_row.name || ' onay bekliyor.', 'system',
    jsonb_build_object('workspaceId', v_row.id)) FROM public.users u WHERE u.role = 'admin';
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_corporate_workspace(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_corporate_workspace(text, integer) TO authenticated;

-- Onayda katılım kodu üretilir ve talep sahibi yönetici üye olur. Askıya almada şirket siparişi kapanır.
CREATE OR REPLACE FUNCTION public.admin_approve_corporate_workspace(p_workspace uuid, p_approve boolean)
RETURNS public.corporate_workspaces LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.corporate_workspaces;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.corporate_workspaces WHERE id = p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kurumsal hesap bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF p_approve THEN
    IF EXISTS (SELECT 1 FROM public.corporate_workspace_members
                WHERE user_id = v_row.owner_id AND status = 'active' AND workspace_id <> v_row.id) THEN
      RAISE EXCEPTION 'Talep sahibi başka bir şirket hesabında üye' USING ERRCODE = '55000';
    END IF;
    UPDATE public.corporate_workspaces
       SET status = 'active', join_code = coalesce(join_code, public._corporate_new_code()), updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
    INSERT INTO public.corporate_workspace_members (workspace_id, user_id, role, status)
    VALUES (v_row.id, v_row.owner_id, 'owner', 'active')
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner', status = 'active', removed_at = NULL;
  ELSE
    UPDATE public.corporate_workspaces SET status = 'suspended', updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  PERFORM public.notify_user(v_row.owner_id, 'Kurumsal hesap',
    CASE WHEN p_approve THEN v_row.name || ' onaylandı. Çalışanların katılım koduyla katılabilir.'
         ELSE v_row.name || ' askıya alındı; şirket siparişi verilemez.' END,
    'system', jsonb_build_object('workspaceId', v_row.id));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_approve_corporate_workspace(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_corporate_workspace(uuid, boolean) TO authenticated;

-- Kişinin kurumsal durumu: etkin üyeliği varsa o şirket, yoksa kendi son talebi.
CREATE OR REPLACE FUNCTION public.my_corporate_workspace()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws public.corporate_workspaces;
  v_member public.corporate_workspace_members;
  v_start timestamptz := public._corporate_month_start();
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_member FROM public.corporate_workspace_members WHERE user_id = auth.uid() AND status = 'active';
  IF FOUND THEN
    SELECT * INTO v_ws FROM public.corporate_workspaces WHERE id = v_member.workspace_id;
  ELSE
    SELECT * INTO v_ws FROM public.corporate_workspaces WHERE owner_id = auth.uid() ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object(
    'id', v_ws.id, 'name', v_ws.name, 'status', v_ws.status,
    'monthly_budget_cents', v_ws.monthly_budget_cents,
    'role', CASE WHEN v_member.user_id IS NOT NULL THEN v_member.role WHEN v_ws.owner_id = auth.uid() THEN 'owner' END,
    'member_status', v_member.status,
    'join_code', CASE WHEN v_ws.owner_id = auth.uid() THEN v_ws.join_code END,
    'month_spent_cents', CASE WHEN v_member.user_id IS NOT NULL
      THEN public._corporate_spent_cents(v_ws.id, v_start, now() + interval '1 day') ELSE 0 END,
    'my_month_spent_cents', CASE WHEN v_member.user_id IS NOT NULL THEN (
      SELECT coalesce(sum(total_cents), 0)::integer FROM public.orders
       WHERE corporate_workspace_id = v_ws.id AND customer_id = auth.uid() AND status <> 'cancelled' AND created_at >= v_start
    ) ELSE 0 END,
    'created_at', v_ws.created_at
  );
END $$;
REVOKE ALL ON FUNCTION public.my_corporate_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_corporate_workspace() TO authenticated;

CREATE OR REPLACE FUNCTION public.join_corporate_workspace(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws public.corporate_workspaces;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('corporate-join:' || auth.uid()::text, 60));
  IF (SELECT count(*) FROM public.corporate_join_attempts
       WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Çok fazla deneme yaptın, bir saat sonra tekrar dene' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_workspace_members WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Zaten bir şirket hesabındasın; önce oradan ayrıl' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_workspaces WHERE owner_id = auth.uid() AND status = 'pending') THEN
    RAISE EXCEPTION 'Onay bekleyen kendi şirket talebin var' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_ws FROM public.corporate_workspaces WHERE join_code = v_code AND status = 'active';
  IF NOT FOUND THEN
    -- Başarısız deneme kaydı işlemle birlikte geri alınmasın diye hata yerine sonuç döner.
    INSERT INTO public.corporate_join_attempts (user_id) VALUES (auth.uid());
    RETURN jsonb_build_object('ok', false);
  END IF;
  INSERT INTO public.corporate_workspace_members (workspace_id, user_id, role, status)
  VALUES (v_ws.id, auth.uid(), 'member', 'active')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET status = 'active', removed_at = NULL, joined_at = now(),
        role = CASE WHEN corporate_workspace_members.role = 'owner' THEN 'owner' ELSE 'member' END;
  PERFORM public.notify_user(v_ws.owner_id, 'Şirket hesabına katılım',
    coalesce((SELECT nullif(btrim(name), '') FROM public.users WHERE id = auth.uid()), 'Bir çalışan') || ' ' || v_ws.name || ' hesabına katıldı.',
    'system', jsonb_build_object('workspaceId', v_ws.id));
  RETURN jsonb_build_object('ok', true, 'workspace_id', v_ws.id, 'name', v_ws.name);
END $$;
REVOKE ALL ON FUNCTION public.join_corporate_workspace(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_corporate_workspace(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_corporate_workspace()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_member public.corporate_workspace_members;
BEGIN
  SELECT * INTO v_member FROM public.corporate_workspace_members WHERE user_id = auth.uid() AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bir şirket hesabında değilsin' USING ERRCODE = 'P0002'; END IF;
  IF v_member.role = 'owner'
     AND (SELECT status FROM public.corporate_workspaces WHERE id = v_member.workspace_id) = 'active' THEN
    RAISE EXCEPTION 'Etkin şirket hesabının sahibi ayrılamaz; kapatmak için destekle yazış' USING ERRCODE = '55000';
  END IF;
  UPDATE public.corporate_workspace_members SET status = 'removed', removed_at = now()
   WHERE workspace_id = v_member.workspace_id AND user_id = v_member.user_id;
END $$;
REVOKE ALL ON FUNCTION public.leave_corporate_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_corporate_workspace() TO authenticated;

-- Sahibin yetkisi: yalnızca kendi etkin şirketi.
CREATE OR REPLACE FUNCTION public._corporate_owned_workspace()
RETURNS public.corporate_workspaces LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ws public.corporate_workspaces;
BEGIN
  SELECT w.* INTO v_ws FROM public.corporate_workspaces w
    JOIN public.corporate_workspace_members m ON m.workspace_id = w.id
   WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.role = 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bir şirket hesabının sahibi değilsin' USING ERRCODE = '42501'; END IF;
  RETURN v_ws;
END $$;
REVOKE ALL ON FUNCTION public._corporate_owned_workspace() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.corporate_remove_member(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ws public.corporate_workspaces := public._corporate_owned_workspace();
BEGIN
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'Kendini çıkaramazsın' USING ERRCODE = '55000'; END IF;
  UPDATE public.corporate_workspace_members SET status = 'removed', removed_at = now()
   WHERE workspace_id = v_ws.id AND user_id = p_user AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bu kişi şirket hesabında değil' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.notify_user(p_user, 'Şirket hesabı', v_ws.name || ' hesabından çıkarıldın; şirket siparişi veremezsin.',
    'system', jsonb_build_object('workspaceId', v_ws.id));
END $$;
REVOKE ALL ON FUNCTION public.corporate_remove_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_remove_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_regenerate_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ws public.corporate_workspaces := public._corporate_owned_workspace(); v_code text;
BEGIN
  IF v_ws.status <> 'active' THEN RAISE EXCEPTION 'Şirket hesabı etkin değil' USING ERRCODE = '55000'; END IF;
  v_code := public._corporate_new_code();
  UPDATE public.corporate_workspaces SET join_code = v_code, updated_at = now() WHERE id = v_ws.id;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.corporate_regenerate_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_regenerate_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_update_budget(p_budget_cents integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ws public.corporate_workspaces := public._corporate_owned_workspace();
BEGIN
  IF p_budget_cents IS NOT NULL AND p_budget_cents NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Aylık bütçe 0 ile 1.000.000 TL arasında olmalı' USING ERRCODE = '22023';
  END IF;
  UPDATE public.corporate_workspaces SET monthly_budget_cents = p_budget_cents, updated_at = now() WHERE id = v_ws.id;
END $$;
REVOKE ALL ON FUNCTION public.corporate_update_budget(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_update_budget(integer) TO authenticated;

-- Sahibin aylık raporu: üyeler, kişi başı harcama ve şirket siparişleri. Adres ve sipariş notu gösterilmez.
CREATE OR REPLACE FUNCTION public.corporate_workspace_report(p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws public.corporate_workspaces := public._corporate_owned_workspace();
  v_from timestamptz := CASE WHEN p_month IS NULL THEN public._corporate_month_start()
    ELSE date_trunc('month', p_month)::timestamp AT TIME ZONE 'Europe/Istanbul' END;
  v_to timestamptz := ((v_from AT TIME ZONE 'Europe/Istanbul') + interval '1 month') AT TIME ZONE 'Europe/Istanbul';
BEGIN
  RETURN jsonb_build_object(
    'month', (v_from AT TIME ZONE 'Europe/Istanbul')::date,
    'spent_cents', public._corporate_spent_cents(v_ws.id, v_from, v_to),
    'monthly_budget_cents', v_ws.monthly_budget_cents,
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(nullif(btrim(u.name), ''), 'İsimsiz'), 'role', m.role,
        'joined_at', m.joined_at,
        'spent_cents', (SELECT coalesce(sum(o.total_cents), 0)::integer FROM public.orders o
                         WHERE o.corporate_workspace_id = v_ws.id AND o.customer_id = m.user_id
                           AND o.status <> 'cancelled' AND o.created_at >= v_from AND o.created_at < v_to),
        'order_count', (SELECT count(*)::integer FROM public.orders o
                         WHERE o.corporate_workspace_id = v_ws.id AND o.customer_id = m.user_id
                           AND o.status <> 'cancelled' AND o.created_at >= v_from AND o.created_at < v_to)
      ) ORDER BY m.role = 'owner' DESC, m.joined_at)
        FROM public.corporate_workspace_members m JOIN public.users u ON u.id = m.user_id
       WHERE m.workspace_id = v_ws.id AND m.status = 'active'
    ), '[]'::jsonb),
    'orders', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total_cents', o.total_cents,
        'member_name', coalesce(nullif(btrim(u.name), ''), 'İsimsiz'), 'restaurant_name', s.display_name
      ) ORDER BY o.created_at DESC)
        FROM public.orders o JOIN public.users u ON u.id = o.customer_id JOIN public.sellers s ON s.id = o.seller_id
       WHERE o.corporate_workspace_id = v_ws.id AND o.created_at >= v_from AND o.created_at < v_to
    ), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.corporate_workspace_report(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_workspace_report(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_corporate_workspaces()
RETURNS TABLE (id uuid, name text, status text, owner_name text, monthly_budget_cents integer,
               member_count integer, month_spent_cents integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT w.id, w.name, w.status, coalesce(nullif(btrim(u.name), ''), 'İsimsiz'), w.monthly_budget_cents,
         (SELECT count(*)::integer FROM public.corporate_workspace_members m WHERE m.workspace_id = w.id AND m.status = 'active'),
         public._corporate_spent_cents(w.id, public._corporate_month_start(), now() + interval '1 day'),
         w.created_at
    FROM public.corporate_workspaces w JOIN public.users u ON u.id = w.owner_id
   ORDER BY w.status = 'pending' DESC, w.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_corporate_workspaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_corporate_workspaces() TO authenticated;

-- ── 3. Çift sipariş koruması + şirket siparişi ─────────────────────────────

DROP FUNCTION IF EXISTS public.place_order_idempotent(uuid, uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.place_order_idempotent(
  p_request_key uuid,
  p_seller_id uuid, p_items jsonb, p_delivery_address text, p_notes text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash', p_coupon_code text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL, p_delivery_lat numeric DEFAULT NULL,
  p_delivery_lng numeric DEFAULT NULL, p_terms_version text DEFAULT NULL,
  p_fulfillment text DEFAULT 'delivery', p_scheduled_for timestamptz DEFAULT NULL,
  p_tip_cents integer DEFAULT 0, p_corporate_workspace uuid DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_ws public.corporate_workspaces;
  v_spent integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'İstek anahtarı gerekli' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_key::text, 42));
  SELECT o.* INTO v_order FROM public.order_request_keys k JOIN public.orders o ON o.id = k.order_id
   WHERE k.customer_id = auth.uid() AND k.request_key = p_request_key;
  IF FOUND THEN RETURN v_order; END IF;

  IF p_corporate_workspace IS NOT NULL THEN
    -- Aynı şirketin eşzamanlı siparişleri sırayla bütçeye bakar.
    SELECT * INTO v_ws FROM public.corporate_workspaces WHERE id = p_corporate_workspace FOR UPDATE;
    IF NOT FOUND OR v_ws.status <> 'active' OR NOT EXISTS (
      SELECT 1 FROM public.corporate_workspace_members
       WHERE workspace_id = v_ws.id AND user_id = auth.uid() AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Bu şirket hesabıyla sipariş veremezsin' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_order := public.place_order(
    p_seller_id, p_items, p_delivery_address, p_notes, p_payment_method, p_coupon_code,
    p_expected_total_cents, p_delivery_lat, p_delivery_lng, p_terms_version,
    p_fulfillment, p_scheduled_for, p_tip_cents
  );

  IF v_ws.id IS NOT NULL THEN
    v_spent := public._corporate_spent_cents(v_ws.id, public._corporate_month_start(), now() + interval '1 day');
    -- Yeni sipariş de toplamda: bütçeyi aşarsa sipariş açılmaz (işlem geri alınır).
    IF v_ws.monthly_budget_cents IS NOT NULL AND v_spent + v_order.total_cents > v_ws.monthly_budget_cents THEN
      RAISE EXCEPTION 'Şirketin bu ayki bütçesi yetmiyor' USING ERRCODE = 'EVN06',
        DETAIL = greatest(v_ws.monthly_budget_cents - v_spent, 0)::text;
    END IF;
    PERFORM set_config('app.internal', '1', true);
    UPDATE public.orders SET corporate_workspace_id = v_ws.id WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM set_config('app.internal', '', true);
  END IF;

  INSERT INTO public.order_request_keys (customer_id, request_key, order_id)
  VALUES (auth.uid(), p_request_key, v_order.id);
  RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION public.place_order_idempotent(uuid, uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_idempotent(uuid, uuid, jsonb, text, text, text, text, integer, numeric, numeric, text, text, timestamptz, integer, uuid) TO authenticated;

-- ── 4. POS bağlantısı ──────────────────────────────────────────────────────

-- İmza anahtarı ve API anahtarının özeti istemciye hiç açılmaz.
CREATE TABLE IF NOT EXISTS public.seller_integration_secrets (
  integration_id uuid PRIMARY KEY REFERENCES public.seller_integrations(id) ON DELETE CASCADE,
  signing_secret text NOT NULL,
  api_key_hash   text NOT NULL UNIQUE,
  api_key_hint   text NOT NULL,
  rotated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_integration_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_integration_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.pos_webhook_deliveries (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES public.seller_integrations(id) ON DELETE CASCADE,
  order_id       uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  event          text NOT NULL,
  request_id     bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_webhook_deliveries_integration_idx ON public.pos_webhook_deliveries(integration_id, created_at DESC);
ALTER TABLE public.pos_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_webhook_deliveries FROM anon, authenticated;

-- HMAC-SHA256 (RFC 2104), pgcrypto'ya bağlı kalmadan.
CREATE OR REPLACE FUNCTION public._hmac_sha256_hex(p_key text, p_message text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_key bytea := convert_to(p_key, 'UTF8');
  v_ipad bytea;
  v_opad bytea;
  i integer;
BEGIN
  IF length(v_key) > 64 THEN v_key := sha256(v_key); END IF;
  v_key := v_key || decode(repeat('00', 64 - length(v_key)), 'hex');
  v_ipad := v_key;
  v_opad := v_key;
  FOR i IN 0..63 LOOP
    v_ipad := set_byte(v_ipad, i, get_byte(v_key, i) # 54);
    v_opad := set_byte(v_opad, i, get_byte(v_key, i) # 92);
  END LOOP;
  RETURN encode(sha256(v_opad || sha256(v_ipad || convert_to(p_message, 'UTF8'))), 'hex');
END $$;
REVOKE ALL ON FUNCTION public._hmac_sha256_hex(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._random_hex64()
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public._random_hex64() FROM PUBLIC, anon, authenticated;

-- Veritabanı sunucusundan istek gider: iç ağa ve IP adreslerine gönderim kapalı.
CREATE OR REPLACE FUNCTION public._pos_webhook_url_ok(p_url text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_host text;
BEGIN
  IF p_url IS NULL OR length(p_url) > 500 OR p_url !~ '^https://[^/?#\s]+(/[^\s]*)?$' THEN RETURN false; END IF;
  v_host := lower(substring(p_url FROM '^https://([^/?#]+)'));
  IF v_host ~ '@' OR v_host ~ ':' THEN RETURN false; END IF;               -- kullanıcı bilgisi ve özel port yok
  IF v_host ~ '^[0-9.]+$' OR v_host ~ '^\[' THEN RETURN false; END IF;      -- IP adresi yok
  IF v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN RETURN false; END IF;
  IF v_host = 'localhost' OR v_host ~ '\.(localhost|local|internal|lan|home|corp|intranet)$'
     OR v_host ~ '(^|\.)supabase\.(co|in)$' THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._pos_webhook_url_ok(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._seller_of_current_user()
RETURNS public.sellers LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller public.sellers;
BEGIN
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restoran hesabın yok' USING ERRCODE = '42501'; END IF;
  RETURN v_seller;
END $$;
REVOKE ALL ON FUNCTION public._seller_of_current_user() FROM PUBLIC, anon, authenticated;

-- Restoranın POS bağlantısı (tek kayıt). İlk kayıtta anahtarlar üretilir ve bir kez gösterilir.
CREATE OR REPLACE FUNCTION public.save_pos_integration(p_webhook_url text, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers := public._seller_of_current_user();
  v_row public.seller_integrations;
  v_url text := nullif(btrim(coalesce(p_webhook_url, '')), '');
  v_secret text;
  v_key text;
  v_new boolean := false;
BEGIN
  IF v_url IS NOT NULL AND NOT public._pos_webhook_url_ok(v_url) THEN
    RAISE EXCEPTION 'Adres https:// ile başlayan geçerli bir alan adı olmalı (IP adresi ve özel port olmaz)' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_enabled, false) AND v_url IS NULL THEN
    RAISE EXCEPTION 'Açmak için sipariş bildirim adresini yaz' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.seller_integrations WHERE seller_id = v_seller.id AND provider = 'pos'
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.seller_integrations (seller_id, provider, external_id, status, config)
    VALUES (v_seller.id, 'pos', 'webhook', CASE WHEN p_enabled THEN 'active' ELSE 'disabled' END,
            jsonb_build_object('webhook_url', v_url))
    RETURNING * INTO v_row;
    v_new := true;
  ELSE
    UPDATE public.seller_integrations
       SET config = config || jsonb_build_object('webhook_url', v_url),
           status = CASE WHEN p_enabled THEN 'active' ELSE 'disabled' END,
           last_error = CASE WHEN p_enabled THEN last_error END,
           updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  IF v_new OR NOT EXISTS (SELECT 1 FROM public.seller_integration_secrets WHERE integration_id = v_row.id) THEN
    v_secret := 'whsec_' || public._random_hex64();
    v_key := 'afy_' || public._random_hex64();
    INSERT INTO public.seller_integration_secrets (integration_id, signing_secret, api_key_hash, api_key_hint)
    VALUES (v_row.id, v_secret, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), right(v_key, 4));
  END IF;
  RETURN jsonb_build_object('integration', to_jsonb(v_row), 'signing_secret', v_secret, 'api_key', v_key);
END $$;
REVOKE ALL ON FUNCTION public.save_pos_integration(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pos_integration(text, boolean) TO authenticated;

-- Anahtarlar sızdıysa yenilenir; eskiler hemen geçersiz olur.
CREATE OR REPLACE FUNCTION public.rotate_pos_credentials()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers := public._seller_of_current_user();
  v_row public.seller_integrations;
  v_secret text := 'whsec_' || public._random_hex64();
  v_key text := 'afy_' || public._random_hex64();
BEGIN
  SELECT * INTO v_row FROM public.seller_integrations WHERE seller_id = v_seller.id AND provider = 'pos'
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Önce POS bağlantısını kaydet' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.seller_integration_secrets (integration_id, signing_secret, api_key_hash, api_key_hint)
  VALUES (v_row.id, v_secret, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), right(v_key, 4))
  ON CONFLICT (integration_id) DO UPDATE
    SET signing_secret = EXCLUDED.signing_secret, api_key_hash = EXCLUDED.api_key_hash,
        api_key_hint = EXCLUDED.api_key_hint, rotated_at = now();
  RETURN jsonb_build_object('signing_secret', v_secret, 'api_key', v_key);
END $$;
REVOKE ALL ON FUNCTION public.rotate_pos_credentials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_pos_credentials() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_pos_integration()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller public.sellers := public._seller_of_current_user();
BEGIN
  DELETE FROM public.seller_integrations WHERE seller_id = v_seller.id AND provider = 'pos';
END $$;
REVOKE ALL ON FUNCTION public.delete_pos_integration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_pos_integration() TO authenticated;

CREATE OR REPLACE FUNCTION public._pos_order_payload(p_order public.orders)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', p_order.id, 'code', upper(left(p_order.id::text, 8)), 'status', p_order.status,
    'fulfillment', p_order.fulfillment, 'scheduled_for', p_order.scheduled_for, 'created_at', p_order.created_at,
    'customer_name', (SELECT nullif(btrim(name), '') FROM public.users WHERE id = p_order.customer_id),
    'delivery_address', p_order.delivery_address, 'notes', p_order.notes,
    'payment_method', p_order.payment_method, 'currency', p_order.currency,
    'subtotal_cents', p_order.subtotal_cents, 'delivery_fee_cents', p_order.delivery_fee_cents,
    'discount_cents', p_order.discount_cents, 'tip_cents', p_order.tip_cents, 'total_cents', p_order.total_cents,
    'prep_minutes', p_order.prep_minutes, 'cancel_reason', p_order.cancel_reason,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'menu_item_id', oi.menu_item_id, 'title', oi.title_snapshot, 'quantity', oi.quantity,
        'unit_price_cents', oi.unit_price_cents, 'line_total_cents', oi.line_total_cents) ORDER BY oi.id)
      FROM public.order_items oi WHERE oi.order_id = p_order.id), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public._pos_order_payload(public.orders) FROM PUBLIC, anon, authenticated;

-- İmzalı gönderim. pg_net yoksa (yerel test) yalnızca kayıt düşülür; gönderim hatası siparişi asla durdurmaz.
CREATE OR REPLACE FUNCTION public._pos_send(p_integration uuid, p_event text, p_order uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_int public.seller_integrations;
  v_secret text;
  v_body jsonb;
  v_ts text := extract(epoch FROM now())::bigint::text;
  v_request bigint;
BEGIN
  SELECT * INTO v_int FROM public.seller_integrations WHERE id = p_integration;
  SELECT signing_secret INTO v_secret FROM public.seller_integration_secrets WHERE integration_id = p_integration;
  IF v_int.id IS NULL OR v_secret IS NULL OR NOT public._pos_webhook_url_ok(v_int.config->>'webhook_url') THEN RETURN; END IF;
  v_body := jsonb_build_object('event', p_event, 'sent_at', now(), 'data', p_data);
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL THEN
    EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
      INTO v_request
      USING v_int.config->>'webhook_url', v_body,
            jsonb_build_object('Content-Type', 'application/json', 'X-Afiyetli-Event', p_event,
              'X-Afiyetli-Timestamp', v_ts,
              'X-Afiyetli-Signature', 'sha256=' || public._hmac_sha256_hex(v_secret, v_ts || '.' || v_body::text));
  END IF;
  INSERT INTO public.pos_webhook_deliveries (integration_id, order_id, event, request_id)
  VALUES (p_integration, p_order, p_event, v_request);
  UPDATE public.seller_integrations SET last_sync_at = now() WHERE id = p_integration;
  -- Kayıt şişmesin: restoran başına son 200 gönderim tutulur.
  DELETE FROM public.pos_webhook_deliveries d
   WHERE d.integration_id = p_integration
     AND d.id < (SELECT min(x.id) FROM (SELECT id FROM public.pos_webhook_deliveries
                   WHERE integration_id = p_integration ORDER BY id DESC LIMIT 200) x);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'POS bildirimi gönderilemedi: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public._pos_send(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_pos_webhook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_int uuid;
  v_current public.orders;
BEGIN
  -- Ödemesi beklenen sipariş restorana henüz düşmemiştir.
  IF NEW.status = 'awaiting_payment' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'awaiting_payment' AND NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT id INTO v_int FROM public.seller_integrations
   WHERE seller_id = NEW.seller_id AND provider = 'pos' AND status = 'active';
  IF v_int IS NULL THEN RETURN NEW; END IF;
  -- İşlem sonunda çalışır: kalemler yazılmış, şirket alanı işlenmiş olur. Durum o anki kayıttan okunur.
  SELECT * INTO v_current FROM public.orders WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM public._pos_send(v_int,
    CASE WHEN NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status = 'awaiting_payment')
         THEN 'order.created' ELSE 'order.status_changed' END,
    NEW.id, public._pos_order_payload(v_current) || jsonb_build_object('status', NEW.status));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'POS bildirimi hazırlanamadı: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_pos_webhook() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_pos_webhook_trg ON public.orders;
-- Ertelenmiş: sipariş satırı kalemlerden önce yazıldığı için bildirim işlem bitince gider.
CREATE CONSTRAINT TRIGGER orders_pos_webhook_trg AFTER INSERT OR UPDATE OF status ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.orders_pos_webhook();

CREATE OR REPLACE FUNCTION public.test_pos_webhook()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers := public._seller_of_current_user();
  v_int public.seller_integrations;
BEGIN
  SELECT * INTO v_int FROM public.seller_integrations WHERE seller_id = v_seller.id AND provider = 'pos';
  IF NOT FOUND OR nullif(v_int.config->>'webhook_url', '') IS NULL THEN
    RAISE EXCEPTION 'Önce sipariş bildirim adresini kaydet' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.pos_webhook_deliveries
       WHERE integration_id = v_int.id AND event = 'ping' AND created_at > now() - interval '1 minute') >= 5 THEN
    RAISE EXCEPTION 'Bir dakika bekleyip tekrar dene' USING ERRCODE = '55000';
  END IF;
  PERFORM public._pos_send(v_int.id, 'ping', NULL, jsonb_build_object('restaurant', v_seller.display_name));
END $$;
REVOKE ALL ON FUNCTION public.test_pos_webhook() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_pos_webhook() TO authenticated;

-- Son gönderimler ve sonuçları (pg_net yanıtları birkaç saat tutulur, sonra "bilinmiyor" görünür).
CREATE OR REPLACE FUNCTION public.pos_delivery_log()
RETURNS TABLE (id bigint, event text, order_id uuid, created_at timestamptz, status_code integer, error text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller public.sellers := public._seller_of_current_user();
BEGIN
  IF to_regclass('net._http_response') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT d.id, d.event, d.order_id, d.created_at, r.status_code::integer,
              CASE WHEN r.timed_out THEN ''Zaman aşımı'' WHEN r.error_msg IS NOT NULL THEN ''Adrese ulaşılamadı'' END
         FROM public.pos_webhook_deliveries d
         JOIN public.seller_integrations i ON i.id = d.integration_id
         LEFT JOIN net._http_response r ON r.id = d.request_id
        WHERE i.seller_id = $1
        ORDER BY d.id DESC LIMIT 20' USING v_seller.id;
  ELSE
    RETURN QUERY
      SELECT d.id, d.event, d.order_id, d.created_at, NULL::integer, NULL::text
        FROM public.pos_webhook_deliveries d JOIN public.seller_integrations i ON i.id = d.integration_id
       WHERE i.seller_id = v_seller.id ORDER BY d.id DESC LIMIT 20;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.pos_delivery_log() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_delivery_log() TO authenticated;

-- POS'un çağırdığı uçlar: oturum yok, restoranın API anahtarıyla çalışır. Anahtar özetiyle aranır.
CREATE OR REPLACE FUNCTION public._pos_integration_for_key(p_api_key text)
RETURNS public.seller_integrations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_int public.seller_integrations;
BEGIN
  IF p_api_key IS NULL OR p_api_key !~ '^afy_[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'API anahtarı geçersiz' USING ERRCODE = '42501';
  END IF;
  SELECT i.* INTO v_int FROM public.seller_integration_secrets s JOIN public.seller_integrations i ON i.id = s.integration_id
   WHERE s.api_key_hash = encode(sha256(convert_to(p_api_key, 'UTF8')), 'hex') AND i.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'API anahtarı geçersiz' USING ERRCODE = '42501'; END IF;
  RETURN v_int;
END $$;
REVOKE ALL ON FUNCTION public._pos_integration_for_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_menu(p_api_key text)
RETURNS TABLE (id uuid, title text, price_cents integer, is_available boolean, daily_limit integer, sold_today integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_int public.seller_integrations := public._pos_integration_for_key(p_api_key);
BEGIN
  RETURN QUERY SELECT m.id, m.title, m.price_cents, m.is_available, m.daily_limit,
      CASE WHEN m.stock_reset_date = (now() AT TIME ZONE 'Europe/Istanbul')::date THEN m.sold_today ELSE 0 END
    FROM public.menu_items m WHERE m.seller_id = v_int.seller_id ORDER BY m.title;
END $$;
REVOKE ALL ON FUNCTION public.pos_menu(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_menu(text) TO anon, authenticated;

-- [{"id": "<menü ürünü>", "available": false, "daily_limit": 20}] ; daily_limit 0 = sınırsız; en çok 200 satır.
CREATE OR REPLACE FUNCTION public.pos_set_availability(p_api_key text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_int public.seller_integrations := public._pos_integration_for_key(p_api_key);
  v_row jsonb;
  v_id uuid;
  v_updated integer := 0;
  v_unknown integer := 0;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'items en çok 200 satırlık bir liste olmalı' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN v_unknown := v_unknown + 1; CONTINUE; END IF;
    BEGIN
      v_id := (v_row->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_unknown := v_unknown + 1; CONTINUE;
    END;
    IF v_row ? 'daily_limit' AND jsonb_typeof(v_row->'daily_limit') <> 'number' THEN
      RAISE EXCEPTION 'daily_limit sayı olmalı (0 = sınırsız)' USING ERRCODE = '22023';
    END IF;
    IF v_row ? 'available' AND jsonb_typeof(v_row->'available') <> 'boolean' THEN
      RAISE EXCEPTION 'available true ya da false olmalı' USING ERRCODE = '22023';
    END IF;
    UPDATE public.menu_items m
       SET is_available = CASE WHEN v_row ? 'available' THEN (v_row->>'available')::boolean ELSE m.is_available END,
           daily_limit = CASE WHEN v_row ? 'daily_limit'
             THEN greatest(0, least(9999, round((v_row->>'daily_limit')::numeric)))::integer ELSE m.daily_limit END,
           updated_at = now()
     WHERE m.id = v_id AND m.seller_id = v_int.seller_id;
    IF FOUND THEN v_updated := v_updated + 1; ELSE v_unknown := v_unknown + 1; END IF;
  END LOOP;
  UPDATE public.seller_integrations SET last_sync_at = now(), last_error = NULL WHERE id = v_int.id;
  RETURN jsonb_build_object('updated', v_updated, 'unknown', v_unknown);
END $$;
REVOKE ALL ON FUNCTION public.pos_set_availability(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_set_availability(text, jsonb) TO anon, authenticated;

-- ── 5. Canlı izleme ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_item_substitutions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_item_substitutions;
  END IF;
END $$;

COMMIT;
