-- 035: İşletme araçları: kullanım ölçümü, canlı sipariş izleme, sahtecilik ve kupon kötüye kullanımı kuralları.
--
-- Ölçüm: birinci taraf, üçüncü taraf SDK yok. Adres, telefon, mesaj metni, arama metni ve hassas konum tutulmaz.
-- Canlı izleme: siparişin mevcut durumda ne kadar beklediği için status_changed_at eklenir.
-- Kurallar: place_order yeniden yazılmadı; hepsi tetikleyicide, hata olursa işlem bütün olarak geri alınır
--   (kupon ve stok düşümü dahil). Eşikler app_config.fraud_rules içinde.

BEGIN;

-- ── 1. Kullanım ölçümü ─────────────────────────────────────────────────────

-- Yalnızca bilinen anahtarlar, ve boşluk içermeyen kısa değerler: adres ve mesaj metni buraya sığmaz.
-- lib/analytics-core.ts aynı kuralı uygular; test ikisini karşılaştırır.
CREATE OR REPLACE FUNCTION public.analytics_props_valid(p_props jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_props) <> 'object' OR octet_length(p_props::text) > 256 THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_props) AS e(key, value)
       WHERE e.key <> ALL (ARRAY['seller_id','method','fulfillment','scheduled','mode','length','reason'])
          OR NOT CASE jsonb_typeof(e.value)
               WHEN 'string' THEN (e.value #>> '{}') ~ '^[A-Za-z0-9_-]{1,64}$'
               WHEN 'number' THEN TRUE
               WHEN 'boolean' THEN TRUE
               ELSE FALSE
             END
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.analytics_props_valid(jsonb) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- Hesap silinince bağ kopar, olay anonim kalır.
  user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name       text NOT NULL CHECK (name IN (
    'app_open','view_home','view_restaurant','add_to_cart','view_cart','start_checkout',
    'order_placed','order_failed','payment_online_started','search'
  )),
  props      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.analytics_props_valid(props)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON public.analytics_events (created_at);
CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON public.analytics_events (name, created_at);

-- Politika yok: kimse doğrudan okuyamaz ve yazamaz. Yazma track_events, okuma admin_funnel üzerinden.
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM anon, authenticated;

-- Geçersiz olay atlanır, sayısı dönüş değerinden anlaşılır: tek bozuk olay partinin kalanını kaybettirmesin
-- (eski uygulama sürümü yeni bir olay adı göndermese de sunucu yenisinden habersiz olabilir).
-- Kurallar tablo kısıtlarında durur, burada tekrar yazılmaz. user_id ve zaman istemciden hiç okunmaz.
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
  -- Profil satırı olmayan oturum (silinmiş hesabın eski jetonu) anonim sayılır.
  SELECT id INTO v_user FROM public.users WHERE id = auth.uid();

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
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
REVOKE ALL ON FUNCTION public.track_events(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_events(jsonb) TO anon, authenticated;

-- Dönemde her adımı en az bir kez görmüş oturum sayısı. Sıra denetlenmez: bağlantıyla doğrudan restorana
-- gelen oturum da sayılır. Satıcı ve yönetici oturumları müşteri hunisini şişirmesin diye sayılmaz.
CREATE OR REPLACE FUNCTION public.admin_funnel(p_days integer)
RETURNS TABLE (step text, sessions bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Dönem geçersiz' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s.name, count(DISTINCT e.session_id)
      FROM unnest(ARRAY[
        'app_open','view_home','view_restaurant','add_to_cart','view_cart','start_checkout',
        'order_placed','order_failed','payment_online_started','search'
      ]) WITH ORDINALITY AS s(name, ord)
      LEFT JOIN public.analytics_events e
        ON e.name = s.name
       AND e.created_at >= now() - make_interval(days => p_days)
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.user_id AND u.role <> 'buyer')
     GROUP BY s.name, s.ord
     ORDER BY s.ord;
END $$;
REVOKE ALL ON FUNCTION public.admin_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel(integer) TO authenticated;

-- 034'teki görevle aynı; ek olarak 180 günden eski ölçüm olayları silinir. Görev zaten iki dakikada bir
-- çalışıyor (029), yeni zamanlama gerekmez; created_at dizinli olduğu için silecek bir şey yokken maliyeti yok.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer;
BEGIN
  DELETE FROM public.analytics_events WHERE created_at < now() - interval '180 days';

  FOR v_row IN
    SELECT o.id, s.user_id
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'pending'
       AND o.pending_reminded_at IS NULL
       AND CASE
         WHEN o.scheduled_for IS NULL THEN
               COALESCE(o.pending_since, o.created_at) < now() - make_interval(mins => p_remind_minutes)
           AND COALESCE(o.pending_since, o.created_at) >= now() - make_interval(mins => p_cancel_minutes)
         ELSE
               o.scheduled_for >= now() + interval '15 minutes'
           AND public.scheduled_reply_elapsed(o.seller_id, COALESCE(o.pending_since, o.created_at), p_remind_minutes)
           AND NOT public.scheduled_reply_elapsed(o.seller_id, COALESCE(o.pending_since, o.created_at), p_cancel_minutes)
       END
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

  FOR v_row IN
    SELECT o.id, s.user_id, o.scheduled_for
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'accepted'
       AND o.scheduled_reminded_at IS NULL
       AND o.scheduled_for > now()
       AND o.scheduled_for <= now() + interval '60 minutes'
  LOOP
    PERFORM public.notify_user(
      v_row.user_id,
      'Planlı sipariş yaklaşıyor',
      'Sipariş #' || left(v_row.id::text, 8) || ' saat '
        || to_char(v_row.scheduled_for AT TIME ZONE 'Europe/Istanbul', 'HH24:MI') || ' için planlı.',
      'order_status',
      jsonb_build_object('orderId', v_row.id)
    );
    UPDATE public.orders SET scheduled_reminded_at = now() WHERE id = v_row.id;
  END LOOP;

  UPDATE public.orders
     SET status = 'cancelled', cancel_reason = 'Satıcı zamanında yanıtlamadı', updated_at = now()
   WHERE status = 'pending'
     AND CASE
       WHEN scheduled_for IS NULL THEN
         COALESCE(pending_since, created_at) < now() - make_interval(mins => p_cancel_minutes)
       ELSE
            scheduled_for < now() + interval '15 minutes'
         OR public.scheduled_reply_elapsed(seller_id, COALESCE(pending_since, created_at), p_cancel_minutes)
     END;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.expire_pending_orders(integer, integer) FROM PUBLIC, anon, authenticated;

-- ── 2. Durum zamanı ve iptal kaydı ─────────────────────────────────────────

-- Eski siparişte ne zaman, kim tarafından iptal edildiği bilinmez: alanlar boş kalır ve iptal kuralında
-- sayılmaz. Müşteri geçmiş bir kayıt yüzünden kısıtlanmaz.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.orders ALTER COLUMN status_changed_at SET DEFAULT now();
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_from_status text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancelled_by_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cancelled_by_check
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'seller', 'admin', 'system'));

-- En yakın bilinen zaman. Bekleyen siparişte pending_since kesindir, diğerlerinde updated_at.
UPDATE public.orders
   SET status_changed_at = coalesce(CASE WHEN status = 'pending' THEN pending_since END, updated_at, created_at)
 WHERE status_changed_at IS NULL;

-- Alanları istemci yazamaz. auth.uid() boşken (sunucu, zamanlanmış görev, SQL) gönderilen değer korunur.
CREATE OR REPLACE FUNCTION public.orders_track_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := coalesce(NEW.status_changed_at, now());
    RETURN NEW;
  END IF;
  IF v_uid IS NOT NULL THEN
    NEW.status_changed_at := OLD.status_changed_at;
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancelled_from_status := OLD.cancelled_from_status;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    IF NEW.status = 'cancelled' THEN
      NEW.cancelled_from_status := OLD.status;
      NEW.cancelled_by := CASE
        WHEN v_uid IS NULL THEN 'system'
        WHEN public.is_admin() THEN 'admin'
        WHEN v_uid = NEW.customer_id THEN 'customer'
        WHEN EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = NEW.seller_id AND s.user_id = v_uid) THEN 'seller'
        ELSE 'system'
      END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_track_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_track_status_trg ON public.orders;
CREATE TRIGGER orders_track_status_trg
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_track_status();

-- ── 3. Canlı sipariş izleme ────────────────────────────────────────────────

-- Süreler sunucuda hesaplanır, cihaz saati yanlış olsa da doğru görünür. Eşikler lib/live-orders.ts'te.
-- minutes_past_schedule: planlı siparişte seçilen saatten bu yana geçen dakika, saat gelmediyse eksi.
CREATE OR REPLACE FUNCTION public.admin_live_orders()
RETURNS TABLE (
  order_id uuid, restaurant_name text, status text, status_changed_at timestamptz,
  minutes_in_status integer, minutes_past_schedule integer, total_cents integer,
  payment_method text, fulfillment text, scheduled_for timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT o.id, s.display_name, o.status,
           coalesce(o.status_changed_at, o.updated_at, o.created_at),
           floor(extract(epoch FROM now() - coalesce(o.status_changed_at, o.updated_at, o.created_at)) / 60)::integer,
           CASE WHEN o.scheduled_for IS NULL THEN NULL
                ELSE floor(extract(epoch FROM now() - o.scheduled_for) / 60)::integer END,
           o.total_cents, o.payment_method, o.fulfillment, o.scheduled_for, o.created_at
      FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status NOT IN ('delivered', 'cancelled')
       AND NOT (o.status = 'awaiting_payment' AND o.created_at < now() - interval '1 day')
     ORDER BY o.created_at
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_live_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_live_orders() TO authenticated;

-- ── 4. Kural eşikleri ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fraud_rule_defaults()
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "door_active_limit": 2,
    "door_cancel_limit": 3,
    "door_cancel_days": 30,
    "flag_new_account_hours": 24,
    "flag_new_account_total_cents": 200000,
    "flag_burst_orders": 3,
    "flag_burst_minutes": 10
  }'::jsonb;
$$;
REVOKE ALL ON FUNCTION public.fraud_rule_defaults() FROM PUBLIC, anon, authenticated;

INSERT INTO public.app_config (key, value) VALUES ('fraud_rules', public.fraud_rule_defaults())
ON CONFLICT (key) DO NOTHING;

-- Bozuk bir ayar sipariş almayı durdurmasın: okunamayan değer yerine varsayılan kullanılır.
CREATE OR REPLACE FUNCTION public.fraud_rule(p_key text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN coalesce(
    (SELECT (value->>p_key)::integer FROM public.app_config WHERE key = 'fraud_rules'),
    (public.fraud_rule_defaults()->>p_key)::integer
  );
EXCEPTION WHEN OTHERS THEN
  RETURN (public.fraud_rule_defaults()->>p_key)::integer;
END $$;
REVOKE ALL ON FUNCTION public.fraud_rule(text) FROM PUBLIC, anon, authenticated;

-- app_config herkese açık okunur; eşiği bilen, tam altında kalacak şekilde sipariş verebilir.
DROP POLICY IF EXISTS "Herkes app config okuyabilir" ON public.app_config;
CREATE POLICY "Herkes app config okuyabilir"
  ON public.app_config FOR SELECT USING (key <> 'fraud_rules' OR public.is_admin());

-- ── 5. Kapıda ödeme kuralları ──────────────────────────────────────────────

-- Doğrulanmış telefon; doğrulanmamışsa NULL.
CREATE OR REPLACE FUNCTION public.verified_phone(p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(btrim(u.phone), '') FROM auth.users u WHERE u.id = p_user AND u.phone_confirmed_at IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.verified_phone(uuid) FROM PUBLIC, anon, authenticated;

-- Tek tetikleyici, iki kural. Online ödeme hiçbirinden etkilenmez.
--
-- "Müşteri kapıda yoktu" diye bir kayıt yok. Sayılan: restoranın kabul ettikten SONRA iptal ettiği kapıda
-- ödemeli sipariş (cancelled_by + cancelled_from_status). Restoranın en baştan reddettiği, müşterinin kendisinin
-- veya yöneticinin iptal ettiği ya da süresi dolan sipariş sayılmaz. Restoran kendi sorunundan (malzeme bitti)
-- iptal ettiyse bu da sayılır, veriden ayrılamaz: bu yüzden yalnızca kapıda ödeme kapanır, sipariş kapanmaz.
CREATE OR REPLACE FUNCTION public.orders_fraud_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_online boolean;
BEGIN
  IF auth.uid() IS NULL OR NEW.customer_id IS NULL
     OR NEW.payment_method NOT IN ('cash', 'card_door', 'meal_card_door') THEN
    RETURN NEW;
  END IF;

  -- Aynı anda gönderilen iki sipariş sınırı aşamasın.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text, 35));
  v_online := public.online_payment_enabled();

  IF (
    SELECT count(*) FROM public.orders o
     WHERE o.customer_id = NEW.customer_id
       AND o.status = 'cancelled'
       AND o.payment_method IN ('cash', 'card_door', 'meal_card_door')
       AND o.cancelled_by = 'seller'
       AND o.cancelled_from_status IN ('accepted', 'preparing', 'ready', 'out_for_delivery')
       AND o.status_changed_at >= now() - make_interval(days => public.fraud_rule('door_cancel_days'))
  ) >= public.fraud_rule('door_cancel_limit') THEN
    RAISE EXCEPTION '%', CASE WHEN v_online
      THEN 'Son siparişlerinde teslimat sorunu yaşandığı için kapıda ödeme şu an kapalı. Online ödeyebilirsin.'
      ELSE 'Son siparişlerinde teslimat sorunu yaşandığı için kapıda ödeme şu an kapalı. Destek ekibimize yazabilirsin.'
    END USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*) FROM public.orders o
     WHERE o.customer_id = NEW.customer_id
       AND o.status IN ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery')
       AND o.payment_method IN ('cash', 'card_door', 'meal_card_door')
  ) >= public.fraud_rule('door_active_limit') THEN
    RAISE EXCEPTION '%', 'Aynı anda en çok ' || public.fraud_rule('door_active_limit') || ' kapıda ödemeli siparişin olabilir. '
      || CASE WHEN v_online THEN 'Online ödeyebilir ya da biri tamamlanınca tekrar deneyebilirsin.' ELSE 'Biri tamamlanınca tekrar dene.' END
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_fraud_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_fraud_guard_trg ON public.orders;
CREATE TRIGGER orders_fraud_guard_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_fraud_guard();

-- ── 6. Kupon ve davet: telefon başına hak ──────────────────────────────────

-- Şemada "ilk siparişe özel" kupon yok; hak sınırı max_uses_per_user ile tutulur. place_order hesabın kendi
-- kullanımını sayar, burada aynı doğrulanmış telefondaki diğer hesaplar da sayılır.
-- Kullanım anındaki telefon satıra yazılır: auth.users.phone tekil olduğu için numara hesaptan hesaba taşınarak
-- paylaşılır, salt güncel telefona bakan denetim bunu görmez. Kupon satırı place_order'da kilitli, yarış olmaz.
ALTER TABLE public.coupon_redemptions ADD COLUMN IF NOT EXISTS verified_phone text;

CREATE OR REPLACE FUNCTION public.coupon_redemptions_phone_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer;
  v_phone text := public.verified_phone(NEW.user_id);
BEGIN
  NEW.verified_phone := v_phone;
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT max_uses_per_user INTO v_limit FROM public.coupons WHERE id = NEW.coupon_id;
  IF v_limit IS NOT NULL AND (
    SELECT count(*) FROM public.coupon_redemptions r
     WHERE r.coupon_id = NEW.coupon_id
       AND (r.verified_phone = v_phone OR public.verified_phone(r.user_id) = v_phone)
  ) >= v_limit THEN
    RAISE EXCEPTION 'Bu kupon telefon numaran için kullanıldı, kuponu kaldırıp tekrar dene' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.coupon_redemptions_phone_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coupon_redemptions_phone_guard_trg ON public.coupon_redemptions;
CREATE TRIGGER coupon_redemptions_phone_guard_trg
  BEFORE INSERT ON public.coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.coupon_redemptions_phone_guard();

-- apply_referral_code kendi kendini davet etmeyi engelliyor; aynı telefondaki ikinci hesabı burada yakalanır.
CREATE OR REPLACE FUNCTION public.referrals_phone_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.verified_phone(NEW.referred_id) = public.verified_phone(NEW.referrer_id) THEN
    RAISE EXCEPTION 'Aynı telefon numarasına bağlı hesaplar birbirini davet edemez' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.referrals_phone_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS referrals_phone_guard_trg ON public.referrals;
CREATE TRIGGER referrals_phone_guard_trg
  BEFORE INSERT ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.referrals_phone_guard();

-- ── 7. İşaretleme: engellemez, yöneticiye gösterir ─────────────────────────

CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('new_account_large_total', 'order_burst')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (order_id, reason)
);
CREATE INDEX IF NOT EXISTS fraud_flags_reviewed_idx ON public.fraud_flags (reviewed_at, created_at DESC);

ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fraud_flags FROM anon, authenticated;
GRANT SELECT ON public.fraud_flags TO authenticated;

DROP POLICY IF EXISTS "fraud_flags_admin_select" ON public.fraud_flags;
CREATE POLICY "fraud_flags_admin_select" ON public.fraud_flags FOR SELECT USING (public.is_admin());

-- İşaretleme ne olursa olsun siparişi durdurmaz: hata yutulur.
CREATE OR REPLACE FUNCTION public.orders_flag_unusual()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF NEW.total_cents > public.fraud_rule('flag_new_account_total_cents') AND EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.id = NEW.customer_id
         AND u.created_at > now() - make_interval(hours => public.fraud_rule('flag_new_account_hours'))
    ) THEN
      INSERT INTO public.fraud_flags (order_id, user_id, reason)
      VALUES (NEW.id, NEW.customer_id, 'new_account_large_total')
      ON CONFLICT (order_id, reason) DO NOTHING;
    END IF;

    -- Bu sipariş de sayıma dahil: AFTER tetikleyici, satır yazıldı.
    IF (
      SELECT count(*) FROM public.orders o
       WHERE o.customer_id = NEW.customer_id
         AND o.created_at > now() - make_interval(mins => public.fraud_rule('flag_burst_minutes'))
    ) > public.fraud_rule('flag_burst_orders') THEN
      INSERT INTO public.fraud_flags (order_id, user_id, reason)
      VALUES (NEW.id, NEW.customer_id, 'order_burst')
      ON CONFLICT (order_id, reason) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'orders_flag_unusual: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_flag_unusual() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_flag_unusual_trg ON public.orders;
CREATE TRIGGER orders_flag_unusual_trg
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_flag_unusual();

CREATE OR REPLACE FUNCTION public.admin_list_fraud_flags(p_reviewed boolean DEFAULT FALSE)
RETURNS TABLE (
  id uuid, order_id uuid, user_id uuid, user_name text, restaurant_name text, total_cents integer,
  payment_method text, reason text, created_at timestamptz, reviewed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT f.id, f.order_id, f.user_id, u.name, s.display_name, o.total_cents,
           o.payment_method, f.reason, f.created_at, f.reviewed_at
      FROM public.fraud_flags f
      JOIN public.orders o ON o.id = f.order_id
      JOIN public.sellers s ON s.id = o.seller_id
      LEFT JOIN public.users u ON u.id = f.user_id
     WHERE (f.reviewed_at IS NOT NULL) = coalesce(p_reviewed, FALSE)
     ORDER BY f.created_at DESC
     LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_fraud_flags(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_fraud_flags(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_fraud_flag(p_flag uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  UPDATE public.fraud_flags SET reviewed_at = coalesce(reviewed_at, now()) WHERE id = p_flag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kayıt bulunamadı' USING ERRCODE = 'P0002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_review_fraud_flag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_fraud_flag(uuid) TO authenticated;

COMMIT;
