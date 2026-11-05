-- Canlı öncesi güvenlik denetiminden çıkan düzeltmeler.
--
-- 1. Sahte kapıda ödeme siparişiyle platformdan para ve puan üretilmesi kapatıldı.
-- 2. Telefon numarası ve kayıt tarihi istemciden serbestçe yazılamaz.
-- 3. Davet hakkı, hesap silinip yeniden açılınca geri gelmez; davet programı durdurulabilir.
-- 4. Askıdaki hesap kendini silip temiz başlayamaz; yorum ve oy veremez.
-- 5. Bildirim satırında yalnızca okundu bilgisi değişir.
-- 6. Satıcı, başka satıcının yemeğini haftalık menüsüne koyamaz; ödenmemiş siparişi göremez.
-- 7. Başvurusu onaylanmamış satıcının adresi herkese açık değildir; başvuruda tür seçilemez.
-- 8. Ödeme: sipariş başına tek ödeme sayfası, tek iade, mutabakat sırası, ödenmemiş sipariş sınırı.
-- 9. Ölçüm olaylarına genel sınır; hesap silinince satıcı belge kayıtları da silinir.

BEGIN;

-- ── 1. Platform destekli kapıda ödeme ───────────────────────────────────────
-- Kapıda ödenen paranın el değiştirdiği doğrulanamaz. Sahte siparişle platformdan alacak yazılmasın diye
-- platformun karşıladığı indirim, aynı müşteri ve restoran için 30 günde bir kez kapıda kullanılır.
UPDATE public.coupons SET max_uses_per_user = 1 WHERE code = 'UCRETSIZ' AND max_uses_per_user IS NULL;

CREATE OR REPLACE FUNCTION public.orders_door_subsidy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.customer_id IS NULL OR NEW.payment_method = 'online'
     OR (NEW.discount_cents <= NEW.seller_discount_cents AND NEW.platform_delivery_cents = 0) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.customer_id = NEW.customer_id AND o.seller_id = NEW.seller_id
       AND o.payment_method <> 'online' AND o.status <> 'cancelled'
       AND (o.discount_cents > o.seller_discount_cents OR o.platform_delivery_cents > 0)
       AND o.created_at > now() - interval '30 days'
  ) THEN
    RAISE EXCEPTION 'Bu restoranda kapıda ödemeli kupon hakkın doldu.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_door_subsidy_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_door_subsidy_guard_trg ON public.orders;
CREATE TRIGGER orders_door_subsidy_guard_trg BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_door_subsidy_guard();

-- 033 ile aynı; sipariş başına en çok ₺500 sayılır, kapıda ödemede günde bir sipariş puan kazandırır.
CREATE OR REPLACE FUNCTION public.orders_award_loyalty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.loyalty%ROWTYPE;
  v_mult   numeric;
  v_orders integer;
  v_code   text;
  v_spent  integer := least(NEW.total_cents - NEW.tip_cents, 50000);
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.loyalty (user_id) VALUES (NEW.customer_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.loyalty WHERE user_id = NEW.customer_id FOR UPDATE;

  IF NEW.payment_method <> 'online' AND v_row.last_order_date = now()::date THEN
    RETURN NEW;
  END IF;

  v_mult := CASE v_row.tier WHEN 'platinum' THEN 2 WHEN 'gold' THEN 1.5 WHEN 'silver' THEN 1.25 ELSE 1 END;
  v_orders := v_row.total_orders + 1;

  UPDATE public.loyalty
     SET points = points + floor(v_spent / 100.0 * v_mult)::integer,
         total_orders = v_orders,
         total_spent = total_spent + v_spent,
         tier = CASE WHEN v_orders >= 30 THEN 'platinum' WHEN v_orders >= 15 THEN 'gold'
                     WHEN v_orders >= 5 THEN 'silver' ELSE 'bronze' END,
         free_deliveries_earned = free_deliveries_earned + CASE WHEN v_orders % 10 = 0 THEN 1 ELSE 0 END,
         last_order_date = now(),
         updated_at = now()
   WHERE user_id = NEW.customer_id;

  IF v_orders % 10 = 0 THEN
    v_code := public.issue_personal_coupon(NEW.customer_id, 'free_delivery', 0, 'Ücretsiz Teslimat');
    PERFORM public.notify_user(NEW.customer_id, 'Ücretsiz teslimat kazandın 🎉',
      'Kupon kodun: ' || v_code, 'promo', jsonb_build_object('couponCode', v_code));
  END IF;
  RETURN NEW;
END $$;

-- ── 2. Kimlik alanları ──────────────────────────────────────────────────────
-- Başkasının numarasını yazarak o kişinin kaydını engellemek mümkün olmasın.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_phone_key;

CREATE OR REPLACE FUNCTION public.users_identity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_verified text;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;
  v_verified := public.verified_phone(NEW.id);
  IF v_verified IS NOT NULL THEN
    -- Doğrulama servisi numarayı + olmadan saklar; arama düğmesi ve fiş + ile bekler.
    NEW.phone := '+' || v_verified;
  END IF;
  NEW.created_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.created_at ELSE now() END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.users_identity_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_identity_guard_trg ON public.users;
CREATE TRIGGER users_identity_guard_trg BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_identity_guard();

-- ── 3. Davet ────────────────────────────────────────────────────────────────
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referred_phone_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_phone_hash_uniq
  ON public.referrals (referred_phone_hash) WHERE referred_phone_hash IS NOT NULL;
UPDATE public.referrals r
   SET referred_phone_hash = encode(sha256(convert_to('referral:' || public.verified_phone(r.referred_id), 'UTF8')), 'hex')
 WHERE r.referred_id IS NOT NULL AND public.verified_phone(r.referred_id) IS NOT NULL;

-- referral_program.paused: telefon doğrulama açılana kadar davet durdurulur, yoksa her e-posta yeni kupon demektir.
CREATE OR REPLACE FUNCTION public.referrals_phone_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := public.verified_phone(NEW.referred_id);
BEGIN
  IF (SELECT (value->>'paused')::boolean FROM public.app_config WHERE key = 'referral_program') IS TRUE THEN
    RAISE EXCEPTION 'Davet programı şu anda kapalı.' USING ERRCODE = '55000';
  END IF;
  IF v_phone = public.verified_phone(NEW.referrer_id) THEN
    RAISE EXCEPTION 'Aynı telefon numarasına bağlı hesaplar birbirini davet edemez' USING ERRCODE = '55000';
  END IF;
  NEW.referred_phone_hash := CASE WHEN v_phone IS NOT NULL
    THEN encode(sha256(convert_to('referral:' || v_phone, 'UTF8')), 'hex') END;
  RETURN NEW;
END $$;

-- ── 4. Askıdaki hesap ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.users_block_suspended_self_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_suspended AND auth.uid() = OLD.id THEN
    RAISE EXCEPTION 'Askıdaki hesap uygulamadan silinemez, destek ekibine yaz.' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.users_block_suspended_self_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_block_suspended_self_delete_trg ON public.users;
CREATE TRIGGER users_block_suspended_self_delete_trg BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_block_suspended_self_delete();

DROP TRIGGER IF EXISTS reviews_block_suspended_trg ON public.reviews;
CREATE TRIGGER reviews_block_suspended_trg BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_user();
DROP TRIGGER IF EXISTS review_helpful_block_suspended_trg ON public.review_helpful;
CREATE TRIGGER review_helpful_block_suspended_trg BEFORE INSERT ON public.review_helpful
  FOR EACH ROW EXECUTE FUNCTION public.block_suspended_user();

-- ── 5. Bildirimler ──────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- ── 6. Satıcı erişimi ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Satıcı kendi menüsünü yönetir" ON public.weekly_menu;
CREATE POLICY "Satıcı kendi menüsünü yönetir" ON public.weekly_menu FOR ALL
  USING (seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid()))
  WITH CHECK (
    seller_id IN (SELECT id FROM public.sellers WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_id AND mi.seller_id = weekly_menu.seller_id)
  );

DROP POLICY IF EXISTS "Satıcı kendi satışlarını görebilir" ON public.orders;
CREATE POLICY "Satıcı kendi satışlarını görebilir" ON public.orders FOR SELECT
  USING (status <> 'awaiting_payment'
         AND EXISTS (SELECT 1 FROM public.sellers WHERE id = seller_id AND user_id = auth.uid()));

-- ── 7. Başvurular ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.customer_has_order_from(p_seller uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.orders o WHERE o.seller_id = p_seller AND o.customer_id = auth.uid());
$$;
-- anon da çalıştırır: aşağıdaki kural anon için de işler. Yalnızca çağıranın kendisi için cevap verir.
REVOKE ALL ON FUNCTION public.customer_has_order_from(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_has_order_from(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Herkes satıcıları görebilir" ON public.sellers;
CREATE POLICY "Herkes satıcıları görebilir" ON public.sellers FOR SELECT
  USING (is_active OR user_id = auth.uid() OR public.customer_has_order_from(id));

-- Ev aşçıları askıdayken başvuru türü seçilemez. Yeniden açılınca bu tetikleyici kaldırılır.
CREATE OR REPLACE FUNCTION public.sellers_force_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.seller_type := 'restaurant';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sellers_force_type() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sellers_force_type_trg ON public.sellers;
CREATE TRIGGER sellers_force_type_trg BEFORE INSERT ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_force_type();

-- ── 8. Ödeme ────────────────────────────────────────────────────────────────
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS refund_started_at timestamptz;
CREATE INDEX IF NOT EXISTS order_payments_open_check_idx
  ON public.order_payments (last_checked_at NULLS FIRST) WHERE paid_at IS NULL AND closed_at IS NULL;

-- İkinci ödeme sayfası açılırsa token ezilir, ilk sayfada çekilen para kayda geçmezdi.
CREATE OR REPLACE FUNCTION public.claim_payment_init(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.order_payments (order_id) VALUES (p_order) ON CONFLICT (order_id) DO NOTHING;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.release_payment_init(p_order uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.order_payments WHERE order_id = p_order AND token IS NULL AND paid_at IS NULL;
$$;

-- Sonucu belirsiz kalan iade 10 dakika sonra yeniden denenebilir.
CREATE OR REPLACE FUNCTION public.claim_payment_refund(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.order_payments
     SET refund_started_at = now()
   WHERE order_id = p_order AND refunded_at IS NULL
     AND (refund_started_at IS NULL OR refund_started_at < now() - interval '10 minutes');
  RETURN FOUND;
END $$;

-- Kesin reddedilen iade hemen yeniden denenebilir; sonucu belirsiz olanda bu çağrılmaz.
CREATE OR REPLACE FUNCTION public.release_payment_refund(p_order uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.order_payments SET refund_started_at = NULL WHERE order_id = p_order;
$$;

REVOKE ALL ON FUNCTION public.release_payment_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_payment_refund(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_payment_init(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_payment_init(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_payment_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_init(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_payment_init(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_refund(uuid) TO service_role;

-- Ödenmemiş siparişler stok ve kupon tutar.
CREATE OR REPLACE FUNCTION public.orders_unpaid_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.status = 'awaiting_payment' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text, 36));
    IF (SELECT count(*) FROM public.orders o
         WHERE o.customer_id = NEW.customer_id AND o.status = 'awaiting_payment') >= 2 THEN
      RAISE EXCEPTION 'Ödenmemiş siparişlerin var, önce onları tamamla.' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_unpaid_limit_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_unpaid_limit_guard_trg ON public.orders;
CREATE TRIGGER orders_unpaid_limit_guard_trg BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_unpaid_limit_guard();

-- ── 9. Ölçüm ve belgeler ────────────────────────────────────────────────────
-- 036 ile aynı; oturum kimliğini değiştirerek tabloyu şişirmek dakikada genel sınıra takılır.
CREATE OR REPLACE FUNCTION public.track_events(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_event jsonb;
  v_count integer := 0;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 20 THEN
    RAISE EXCEPTION 'Olay listesi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.analytics_events e WHERE e.created_at > now() - interval '1 minute') >= 5000 THEN
    RETURN 0;
  END IF;
  SELECT id INTO v_user FROM public.users WHERE id = auth.uid();

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    IF (SELECT count(*) FROM public.analytics_events e
         WHERE e.session_id = v_event->>'session_id' AND e.created_at > now() - interval '1 day') >= 500 THEN
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.analytics_events (session_id, user_id, name, props)
      VALUES (v_event->>'session_id', v_user, v_event->>'name', coalesce(v_event->'props', '{}'::jsonb));
      v_count := v_count + 1;
    EXCEPTION WHEN check_violation OR not_null_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN v_count;
END $$;

-- Hesap silinince siparişi olan satıcının satırı kalır; kim olduğunu gösteren belge kayıtları kalmaz.
CREATE OR REPLACE FUNCTION public.sellers_drop_documents_on_anonymize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL THEN
    DELETE FROM public.seller_documents WHERE seller_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sellers_drop_documents_on_anonymize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sellers_drop_documents_trg ON public.sellers;
CREATE TRIGGER sellers_drop_documents_trg AFTER UPDATE OF user_id ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_drop_documents_on_anonymize();

COMMIT;
