-- 038: Yeni sipariş alarmı için ayrı push kanalı ve kampanya bildirimi izni.
--
-- Alarm: satıcıya giden yeni sipariş bildirimi data.new_order bayrağını taşır, push bu bayrakla yüksek öncelikli
--   'new-orders' Android kanalına ve özel sese gider (kanal: lib/notifications.ts, ses dosyası: app.json).
--   Android'de kaynak adında tire geçersiz olduğu için dosya adı new_order.wav'dır, kanal adında tire sorun değil.
-- İzin: ticari ileti izne bağlıdır, sipariş ve hizmet bildirimi değildir. Kazanılan kuponun bildirimi (033, 021)
--   kullanıcının kendi hesabıyla ilgili hizmet iletisi sayıldığı için izin aramaz.

BEGIN;

-- ── 1. İzin kolonları ──────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz;

COMMENT ON COLUMN public.users.marketing_consent IS 'Kampanya bildirimi izni; yalnızca kullanıcının kendisi değiştirir.';
COMMENT ON COLUMN public.users.marketing_consent_at IS 'İzin değerinin son değiştiği an; tetikleyici yazar, istemci yazamaz.';

-- Kendi satırını güncelleme politikası (001) ve users_guard (013) bu kolonlara izin verir, RLS başkasının satırını kapatır.
-- Yöneticinin users güncelleme politikası (007) var: izin kişinin kendi beyanıdır, yönetici onun yerine değiştiremez.
CREATE OR REPLACE FUNCTION public.users_marketing_consent_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.marketing_consent_at := CASE WHEN NEW.marketing_consent THEN now() END;
    RETURN NEW;
  END IF;

  IF NEW.marketing_consent IS DISTINCT FROM OLD.marketing_consent THEN
    IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.id THEN
      RAISE EXCEPTION 'Kampanya iznini yalnızca kullanıcının kendisi değiştirebilir' USING ERRCODE = '42501';
    END IF;
    NEW.marketing_consent_at := now();
  ELSE
    NEW.marketing_consent_at := OLD.marketing_consent_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.users_marketing_consent_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_marketing_consent_guard_trg ON public.users;
CREATE TRIGGER users_marketing_consent_guard_trg
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_marketing_consent_guard();

-- ── 2. Takipçi duyurusu ────────────────────────────────────────────────────
-- 028 ile aynı; yalnızca izin veren takipçiye gider. Dönüş tipi void kalır, saatlik sınır değişmedi.

CREATE OR REPLACE FUNCTION public.notify_my_followers(p_title text, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers%ROWTYPE;
BEGIN
  PERFORM public._assert_not_suspended();
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
    FROM public.seller_follows f
    JOIN public.users u ON u.id = f.user_id
   WHERE f.seller_id = v_seller.id
     AND u.marketing_consent;
END $$;

-- ── 3. Toplu duyuru ────────────────────────────────────────────────────────
-- Kampanya (varsayılan) yalnızca izin verene gider. p_commercial=false hizmet duyurusudur, herkese gider ve
-- türü 'system' olur: kampanya sekmesinde görünmez, dokununca kampanya ekranını açmaz.

DROP FUNCTION IF EXISTS public.admin_broadcast(text, text, text);
CREATE FUNCTION public.admin_broadcast(p_title text, p_body text, p_audience text DEFAULT 'all', p_commercial boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_body  text := btrim(COALESCE(p_body, ''));
  v_commercial boolean := COALESCE(p_commercial, true);
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
  SELECT u.id, v_title, v_body, CASE WHEN v_commercial THEN 'promo' ELSE 'system' END, '{}'::jsonb
    FROM public.users u
   WHERE NOT u.is_suspended
     AND u.role <> 'admin'
     AND (p_audience = 'all' OR u.role = p_audience)
     AND (NOT v_commercial OR u.marketing_consent);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.admin_broadcast(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_broadcast(text, text, text, boolean) TO authenticated;

-- ── 4. Yeni sipariş bildirimi ──────────────────────────────────────────────
-- 033 ile aynı; satıcıya giden iki yeni sipariş bildirimi new_order bayrağını taşır.

CREATE OR REPLACE FUNCTION public.orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_user uuid;
  v_seller_name text;
  v_data  jsonb := jsonb_build_object('orderId', NEW.id);
  v_new_data jsonb := jsonb_build_object('orderId', NEW.id, 'new_order', true);
  v_short text := left(NEW.id::text, 8);
  v_title text;
  v_new_body text;
BEGIN
  SELECT user_id, display_name INTO v_seller_user, v_seller_name FROM public.sellers WHERE id = NEW.seller_id;

  v_new_body := 'Sipariş #' || v_short
    || CASE WHEN NEW.scheduled_for IS NOT NULL
         THEN ' (' || to_char(NEW.scheduled_for AT TIME ZONE 'Europe/Istanbul', 'DD.MM HH24:MI') || ' için planlı)'
         ELSE '' END
    || ' onayını bekliyor.';

  -- Online sipariş satıcıya ödeme alındıktan sonra görünür.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'awaiting_payment' THEN
      PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_new_data);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'pending' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', v_new_body, 'order_status', v_new_data);
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.notify_user(NEW.customer_id, 'Ödemen iade edildi', 'Sipariş #' || v_short, 'order_status', v_data);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := CASE NEW.status
      WHEN 'accepted'         THEN 'Siparişin kabul edildi'
      WHEN 'preparing'        THEN 'Siparişin hazırlanıyor'
      WHEN 'ready'            THEN CASE WHEN NEW.fulfillment = 'pickup' THEN 'Siparişin hazır, gelip alabilirsin' ELSE 'Siparişin hazır' END
      WHEN 'out_for_delivery' THEN 'Siparişin yolda'
      WHEN 'delivered'        THEN CASE WHEN NEW.fulfillment = 'pickup' THEN 'Siparişini teslim aldın' ELSE 'Siparişin teslim edildi' END
      WHEN 'cancelled'        THEN 'Siparişin iptal edildi'
    END;
    IF v_title IS NOT NULL AND NEW.customer_id IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(NEW.customer_id, v_title, v_seller_name || ' · Sipariş #' || v_short, 'order_status', v_data);
    END IF;
    IF NEW.status = 'cancelled' AND OLD.status <> 'awaiting_payment' AND v_seller_user IS DISTINCT FROM auth.uid() THEN
      PERFORM public.notify_user(v_seller_user, 'Sipariş iptal edildi', 'Sipariş #' || v_short || ' iptal edildi.', 'order_status', v_data);
    END IF;
  END IF;

  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status THEN
    IF NEW.refund_status = 'requested' THEN
      PERFORM public.notify_user(v_seller_user, 'İade talebi', 'Sipariş #' || v_short || ' için iade talep edildi.', 'order_status', v_data);
    ELSIF NEW.refund_status IN ('approved', 'rejected') THEN
      PERFORM public.notify_user(
        NEW.customer_id,
        CASE NEW.refund_status WHEN 'approved' THEN 'İade talebin onaylandı' ELSE 'İade talebin reddedildi' END,
        'Sipariş #' || v_short, 'order_status', v_data);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── 5. Push gönderimi ──────────────────────────────────────────────────────
-- 019 ile aynı; new_order bayrağı olan bildirim 'new-orders' kanalına ve özel sese gider. Android'de sesi kanal
-- belirler, 'sound' alanı iOS içindir. pg_net Supabase'e özgüdür, test ortamında bu fonksiyon tetikleyicisiz durur.

CREATE OR REPLACE FUNCTION public.notifications_send_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
  v_new_order boolean := COALESCE(NEW.data->>'new_order', '') = 'true';
BEGIN
  SELECT push_token INTO v_token FROM public.users WHERE id = NEW.user_id;
  IF v_token IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'to', v_token,
        'title', NEW.title,
        'body', NEW.body,
        'sound', CASE WHEN v_new_order THEN 'new_order.wav' ELSE 'default' END,
        'channelId', CASE WHEN v_new_order THEN 'new-orders' WHEN NEW.type = 'order_status' THEN 'orders' ELSE 'system' END,
        'priority', CASE WHEN v_new_order THEN 'high' ELSE 'default' END,
        'data', coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object('type', NEW.type)
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push gönderilemedi: %', SQLERRM;
  RETURN NEW;
END $$;

COMMIT;
