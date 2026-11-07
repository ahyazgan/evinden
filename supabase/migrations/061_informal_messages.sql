-- 061: Veritabanından gelen hata ve bildirim metinleri "sen" diline çevrildi.
--
-- Uygulama "sen" diyor; bu fonksiyonların son sürümlerinde "siz" kalmıştı. Her fonksiyon son tanımlandığı
-- migration'daki hâliyle aynen alındı, yalnızca metinler değişti. Davranış ve yetkiler aynı kalır.

BEGIN;

-- redeem_reward(text) (son tanım: 018_operations.sql)
CREATE OR REPLACE FUNCTION public.redeem_reward(p_reward_id text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_cost  integer;
  v_type  text;
  v_value integer;
  v_title text;
  v_row   public.loyalty%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ödül için giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  CASE p_reward_id
    WHEN 'free_del' THEN v_cost := 50;  v_type := 'free_delivery'; v_value := 0;    v_title := 'Ücretsiz Teslimat';
    WHEN 'disc_10'  THEN v_cost := 80;  v_type := 'fixed';         v_value := 1000; v_title := '₺10 İndirim';
    WHEN 'disc_20'  THEN v_cost := 150; v_type := 'fixed';         v_value := 2000; v_title := '₺20 İndirim';
    WHEN 'disc_30'  THEN v_cost := 250; v_type := 'fixed';         v_value := 3000; v_title := '₺30 İndirim';
    ELSE RAISE EXCEPTION 'Ödül bulunamadı' USING ERRCODE = '22023';
  END CASE;

  SELECT * INTO v_row FROM public.loyalty WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_row.points < v_cost THEN
    RAISE EXCEPTION 'Yetersiz puan' USING ERRCODE = '55000';
  END IF;

  UPDATE public.loyalty SET points = points - v_cost, updated_at = now() WHERE user_id = v_uid;
  RETURN public.issue_personal_coupon(v_uid, v_type, v_value, v_title);
END $$;

-- apply_referral_code(text) (son tanım: 021_referrals.sql)
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_referrer FROM public.loyalty WHERE referral_code = v_code;
  IF v_referrer IS NULL THEN
    RAISE EXCEPTION 'Davet kodu geçersiz' USING ERRCODE = '55000';
  END IF;
  IF v_referrer = v_uid THEN
    RAISE EXCEPTION 'Kendi davet kodunu kullanamazsın' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN
    RAISE EXCEPTION 'Daha önce bir davet kodu kullandın' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE customer_id = v_uid AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'Davet kodu yalnızca ilk siparişten önce kullanılabilir' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.referrals WHERE referrer_id = v_referrer) >= 100 THEN
    RAISE EXCEPTION 'Bu davet kodunun kullanım sınırı doldu' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, code) VALUES (v_referrer, v_uid, v_code);
  RETURN public.issue_referral_coupon(v_uid, 'Davet İndirimi');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Daha önce bir davet kodu kullandın' USING ERRCODE = '55000';
END $$;

-- get_my_referral_code() (son tanım: 021_referrals.sql)
CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.loyalty (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT referral_code INTO v_code FROM public.loyalty WHERE user_id = v_uid FOR UPDATE;
  WHILE v_code IS NULL LOOP
    v_code := 'EV' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    BEGIN
      UPDATE public.loyalty SET referral_code = v_code, updated_at = now() WHERE user_id = v_uid;
    EXCEPTION WHEN unique_violation THEN
      v_code := NULL;
    END;
  END LOOP;
  RETURN v_code;
END $$;

-- orders_complete_referral() (son tanım: 021_referrals.sql)
CREATE OR REPLACE FUNCTION public.orders_complete_referral()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer uuid;
  v_code     text;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.customer_id IS NULL OR NEW.subtotal_cents < 5000 THEN
    RETURN NEW;
  END IF;

  UPDATE public.referrals SET status = 'completed'
   WHERE referred_id = NEW.customer_id AND status = 'pending'
   RETURNING referrer_id INTO v_referrer;
  IF v_referrer IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.loyalty (user_id) VALUES (v_referrer) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.loyalty
     SET referral_count = referral_count + 1, referral_earnings = referral_earnings + 1500, updated_at = now()
   WHERE user_id = v_referrer;

  v_code := public.issue_referral_coupon(v_referrer, 'Davet Ödülü');
  PERFORM public.notify_user(v_referrer, 'Davet ödülün hazır',
    'Arkadaşın ilk siparişini aldı. Kupon kodun: ' || v_code, 'promo', jsonb_build_object('couponCode', v_code));
  RETURN NEW;
END $$;

-- admin_mark_refunded(uuid) (son tanım: 022_online_payments.sql)
CREATE OR REPLACE FUNCTION public.admin_mark_refunded(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  PERFORM public.mark_order_refunded(p_order);
END $$;

-- create_seller_coupon(text,text,text,integer,integer,integer,timestamptz,integer) (son tanım: 024_seller_campaigns_earnings.sql)
CREATE OR REPLACE FUNCTION public.create_seller_coupon(
  p_code text, p_title text, p_type text, p_value integer, p_min_order_cents integer,
  p_max_uses integer, p_expires_at timestamptz, p_max_discount_cents integer DEFAULT NULL
)
RETURNS public.coupons
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers%ROWTYPE;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_row public.coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Yalnızca aktif satıcılar kampanya açabilir' USING ERRCODE = '42501';
  END IF;
  IF v_code !~ '^[A-Z0-9]{4,20}$' THEN
    RAISE EXCEPTION 'Kod 4-20 karakter olmalı; Türkçe karakter ve boşluk kullanmayın' USING ERRCODE = '55000';
  END IF;
  IF length(v_title) NOT BETWEEN 3 AND 60 THEN
    RAISE EXCEPTION 'Kampanya adı 3-60 karakter olmalı' USING ERRCODE = '55000';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('percent', 'fixed', 'free_delivery') THEN
    RAISE EXCEPTION 'Kampanya türü geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_type = 'percent' AND coalesce(p_value, 0) NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'İndirim yüzdesi 1-90 arasında olmalı' USING ERRCODE = '55000';
  END IF;
  IF p_type = 'fixed' AND coalesce(p_value, 0) < 100 THEN
    RAISE EXCEPTION 'İndirim tutarı en az ₺1 olmalı' USING ERRCODE = '55000';
  END IF;
  IF coalesce(p_min_order_cents, 0) < 0 OR coalesce(p_max_discount_cents, 1) <= 0 THEN
    RAISE EXCEPTION 'Tutar sınırı geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Kullanım sınırı geçersiz' USING ERRCODE = '55000';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '180 days' THEN
    RAISE EXCEPTION 'Bitiş tarihi en fazla 180 gün sonrası olabilir' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.coupons c
       WHERE c.seller_id = v_seller.id AND c.is_active AND (c.expires_at IS NULL OR c.expires_at > now())) >= 20 THEN
    RAISE EXCEPTION 'En fazla 20 aktif kampanyanız olabilir' USING ERRCODE = '55000';
  END IF;

  BEGIN
    INSERT INTO public.coupons (
      code, title, discount_type, discount_value, min_order_cents, max_discount_cents,
      max_uses, max_uses_per_user, is_active, expires_at, seller_id, icon
    ) VALUES (
      v_code, v_title, p_type, CASE WHEN p_type = 'free_delivery' THEN 0 ELSE p_value END,
      coalesce(p_min_order_cents, 0), CASE WHEN p_type = 'percent' THEN p_max_discount_cents END,
      p_max_uses, 1, TRUE, p_expires_at, v_seller.id, '🏷️'
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Bu kod kullanılıyor, başka bir kod seç' USING ERRCODE = '55000';
  END;
  RETURN v_row;
END $$;

-- _post_message(uuid,text,text) (son tanım: 025_messaging.sql)
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
    RAISE EXCEPTION 'Çok hızlı mesaj gönderiyorsun, biraz bekle' USING ERRCODE = '55000';
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

-- report_message(uuid,text) (son tanım: 025_messaging.sql)
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
    RAISE EXCEPTION 'Kendi mesajını bildiremezsin' USING ERRCODE = '55000';
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

-- send_message_to_seller(uuid,text) (son tanım: 025_messaging.sql)
CREATE OR REPLACE FUNCTION public.send_message_to_seller(p_seller uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_seller public.sellers%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Mesaj göndermek için giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller;
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Bu satıcı şu anda mesaj alamıyor' USING ERRCODE = '55000';
  END IF;
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazana mesaj gönderemezsin' USING ERRCODE = '55000';
  END IF;

  SELECT id INTO v_id FROM public.conversations WHERE customer_id = v_uid AND seller_id = p_seller;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM public.conversations c
         WHERE c.customer_id = v_uid AND c.created_at > now() - interval '1 day') >= 30 THEN
      RAISE EXCEPTION 'Bugün çok fazla yeni sohbet başlattın' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.conversations (customer_id, seller_id) VALUES (v_uid, p_seller)
    ON CONFLICT (customer_id, seller_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._post_message(v_id, 'customer', p_body);
  RETURN v_id;
END $$;

-- admin_set_user_suspended(uuid,boolean) (son tanım: 028_contact_expiry_admin.sql)
CREATE OR REPLACE FUNCTION public.admin_set_user_suspended(p_user uuid, p_suspended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
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

-- open_order_conversation(uuid) (son tanım: 028_contact_expiry_admin.sql)
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
    RAISE EXCEPTION 'Bu siparişe erişemezsin' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_not_suspended();
  IF v_order.status = 'awaiting_payment' THEN
    RAISE EXCEPTION 'Bu siparişe erişemezsin' USING ERRCODE = '42501';
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

-- get_seller_order_contacts(uuid) (son tanım: 032_courier_location.sql)
CREATE OR REPLACE FUNCTION public.get_seller_order_contacts(p_seller uuid)
RETURNS TABLE (order_id uuid, customer_name text, customer_phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = p_seller AND s.user_id = auth.uid())
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Bu mağazanın siparişlerini göremezsin' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_not_suspended();
  RETURN QUERY
    SELECT o.id,
           u.name,
           CASE WHEN o.status IN ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery') THEN u.phone END
      FROM public.orders o
      LEFT JOIN public.users u ON u.id = o.customer_id
     WHERE o.seller_id = p_seller
       AND o.status <> 'awaiting_payment'; -- parası alınmamış sipariş satıcıya görünmez
END $$;

-- admin_broadcast(text,text,text,boolean) (son tanım: 038_alarm_consent.sql)
CREATE OR REPLACE FUNCTION public.admin_broadcast(p_title text, p_body text, p_audience text DEFAULT 'all', p_commercial boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(COALESCE(p_title, ''));
  v_body  text := btrim(COALESCE(p_body, ''));
  v_commercial boolean := COALESCE(p_commercial, true);
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
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

-- place_order(uuid,jsonb,text,text,text,text,integer,numeric,numeric,text,text,timestamptz,integer) (son tanım: 044_launch_commission.sql)
CREATE OR REPLACE FUNCTION public.place_order(
  p_seller_id        uuid,
  p_items            jsonb,
  p_delivery_address text,
  p_notes            text DEFAULT NULL,
  p_payment_method   text DEFAULT 'cash',
  p_coupon_code      text DEFAULT NULL,
  p_expected_total_cents integer DEFAULT NULL,
  p_delivery_lat     numeric DEFAULT NULL,
  p_delivery_lng     numeric DEFAULT NULL,
  p_terms_version    text DEFAULT NULL,
  p_fulfillment      text DEFAULT 'delivery',
  p_scheduled_for    timestamptz DEFAULT NULL,
  p_tip_cents        integer DEFAULT 0
) RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_cfg       jsonb;
  v_fee       integer;
  v_free_over integer;
  v_rate      numeric;
  v_override  numeric;
  v_min       integer;
  v_seller    public.sellers%ROWTYPE;
  v_el        jsonb;
  v_mi        public.menu_items%ROWTYPE;
  v_var       public.menu_item_variants%ROWTYPE;
  v_por       public.menu_item_portions%ROWTYPE;
  v_qty       integer;
  v_unit      integer;
  v_title     text;
  v_extra_ids uuid[];
  v_extras_n  integer;
  v_extras_sum integer;
  v_extras_lbl text;
  v_option_ids uuid[];
  v_grp       record;
  v_today     date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  -- Yemeğin servis edileceği gün: planlı siparişte seçilen gün, yoksa bugün.
  v_serve_date date := (coalesce(p_scheduled_for, now()) AT TIME ZONE 'Europe/Istanbul')::date;
  v_dow       integer := extract(isodow FROM (coalesce(p_scheduled_for, now()) AT TIME ZONE 'Europe/Istanbul'))::integer - 1;
  v_sold      integer;
  v_subtotal  integer := 0;
  v_delivery  integer;
  v_discount  integer := 0;
  v_total     integer;
  v_commission integer;
  v_seller_discount integer := 0;
  v_platform_delivery integer := 0;
  v_platform_fee integer;
  v_coupon    public.coupons%ROWTYPE;
  v_lines     jsonb := '[]'::jsonb;
  v_line      jsonb;
  v_order     public.orders;
  v_fulfillment text := coalesce(p_fulfillment, 'delivery');
  v_pickup    boolean := coalesce(p_fulfillment, 'delivery') = 'pickup';
  v_tip       integer := coalesce(p_tip_cents, 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sipariş için giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  IF p_payment_method NOT IN ('cash', 'card_door', 'meal_card_door', 'online') THEN
    RAISE EXCEPTION 'Bu ödeme yöntemi şu an desteklenmiyor' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'online' AND NOT public.online_payment_enabled() THEN
    RAISE EXCEPTION 'Online ödeme şu an kullanılamıyor' USING ERRCODE = '22023';
  END IF;
  IF v_fulfillment NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'Teslim şekli geçersiz' USING ERRCODE = '22023';
  END IF;
  IF v_tip < 0 OR v_tip > 50000 THEN
    RAISE EXCEPTION 'Bahşiş en çok ₺500 olabilir' USING ERRCODE = '22023';
  END IF;
  IF v_pickup AND v_tip > 0 THEN
    RAISE EXCEPTION 'Gelip alırken bahşiş eklenmez' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Sepet geçersiz' USING ERRCODE = '22023';
  END IF;
  -- Gelip almada istemcinin gönderdiği adres yok sayılır, aşağıda işaret metni yazılır.
  IF NOT v_pickup AND (p_delivery_address IS NULL OR length(btrim(p_delivery_address)) < 5 OR length(p_delivery_address) > 500) THEN
    RAISE EXCEPTION 'Teslimat adresi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_notes, '')) > 500 THEN
    RAISE EXCEPTION 'Sipariş notu çok uzun' USING ERRCODE = '22001';
  END IF;

  SELECT value INTO v_cfg FROM public.app_config WHERE key = 'order_pricing';
  v_cfg       := coalesce(v_cfg, '{}'::jsonb);
  v_fee       := coalesce((v_cfg->>'delivery_fee_cents')::integer, 1500);
  v_platform_fee := v_fee;
  v_free_over := coalesce((v_cfg->>'free_delivery_threshold_cents')::integer, 15000);
  v_rate      := coalesce((v_cfg->>'commission_rate_percent')::numeric, 8);
  v_min       := coalesce((v_cfg->>'min_order_cents')::integer, 0);

  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller_id;
  IF NOT FOUND OR NOT v_seller.is_active THEN
    RAISE EXCEPTION 'Bu satıcı şu an sipariş almıyor' USING ERRCODE = '22023';
  END IF;
  -- Geçici kapanan restoran planlı sipariş de almaz: onaylayacak kimse yok, sipariş boşuna iptal olur.
  IF v_seller.is_paused THEN
    RAISE EXCEPTION 'Bu satıcı şu an kapalı' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_for IS NULL THEN
    IF NOT public.seller_open_at(p_seller_id, now()) THEN
      RAISE EXCEPTION 'Bu satıcı şu an kapalı' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- Planlı siparişte önemli olan seçilen saat: restoran şu an kapalı olabilir. Onay süresi normal
    -- siparişle aynıdır (expire_pending_orders), restoran hemen kabul veya reddeder.
    IF NOT v_seller.accepts_scheduled THEN
      RAISE EXCEPTION 'Bu restoran ileri tarihli sipariş almıyor' USING ERRCODE = '22023';
    END IF;
    IF p_scheduled_for < now() + interval '45 minutes' THEN
      RAISE EXCEPTION 'En erken 45 dakika sonrasına sipariş verebilirsin' USING ERRCODE = '22023';
    END IF;
    IF p_scheduled_for > now() + interval '7 days' THEN
      RAISE EXCEPTION 'En çok 7 gün sonrasına sipariş verebilirsin' USING ERRCODE = '22023';
    END IF;
    IF NOT public.seller_open_at(p_seller_id, p_scheduled_for) THEN
      RAISE EXCEPTION 'Restoran seçtiğin saatte kapalı' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_seller.user_id = v_uid THEN
    RAISE EXCEPTION 'Kendi mağazandan sipariş veremezsin' USING ERRCODE = '22023';
  END IF;
  IF v_pickup AND NOT v_seller.pickup_enabled THEN
    RAISE EXCEPTION 'Bu restoranda gelip alma yok' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method = 'meal_card_door' AND cardinality(v_seller.meal_cards) = 0 THEN
    RAISE EXCEPTION 'Bu restoran yemek kartı kabul etmiyor' USING ERRCODE = '22023';
  END IF;
  IF v_seller.seller_type = 'restaurant' THEN
    v_rate := coalesce((v_cfg->>'restaurant_commission_rate_percent')::numeric, 1);
  END IF;
  -- Satıcıya özel oran (lansman, anlaşmalı oran) tür oranının yerine geçer.
  SELECT rate_percent INTO v_override FROM public.seller_commission_rates WHERE seller_id = p_seller_id;
  IF FOUND THEN
    v_rate := v_override;
  END IF;

  -- Satıcının kendi ayarı varsa platform varsayılanının yerine geçer.
  v_fee       := coalesce(v_seller.delivery_fee_cents, v_fee);
  v_free_over := coalesce(v_seller.free_delivery_threshold_cents, v_free_over);
  v_min       := greatest(v_min, v_seller.min_order_cents);

  -- Konumu bilinen satıcı yalnızca teslimat alanına sipariş alır. Gelip almada teslimat yok.
  IF NOT v_pickup AND v_seller.latitude IS NOT NULL AND v_seller.longitude IS NOT NULL THEN
    IF p_delivery_lat IS NULL OR p_delivery_lng IS NULL
       OR p_delivery_lat NOT BETWEEN -90 AND 90 OR p_delivery_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Teslimat konumu bulunamadı' USING ERRCODE = 'EVN02';
    END IF;
    IF public.distance_km(v_seller.latitude, v_seller.longitude, p_delivery_lat, p_delivery_lng) > v_seller.delivery_radius_km THEN
      RAISE EXCEPTION 'Bu adres satıcının teslimat alanının dışında' USING ERRCODE = 'EVN03';
    END IF;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_el->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 50 THEN
      RAISE EXCEPTION 'Adet geçersiz' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_mi FROM public.menu_items
     WHERE id = (v_el->>'menu_item_id')::uuid AND seller_id = p_seller_id
     FOR UPDATE;
    IF NOT FOUND OR NOT v_mi.is_available THEN
      RAISE EXCEPTION 'Ürün bu satıcıda mevcut değil' USING ERRCODE = '22023';
    END IF;
    -- Haftalık menüde bakılan gün, yemeğin servis edileceği gündür.
    IF v_seller.uses_weekly_menu AND NOT EXISTS (
      SELECT 1 FROM public.weekly_menu w
       WHERE w.menu_item_id = v_mi.id AND w.day_of_week = v_dow AND w.is_active
    ) THEN
      IF p_scheduled_for IS NULL THEN
        RAISE EXCEPTION '% bugünkü menüde yok', v_mi.title USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION '% seçtiğin günün menüsünde yok', v_mi.title USING ERRCODE = '22023';
    END IF;

    v_unit  := v_mi.price_cents;
    v_title := v_mi.title;

    IF coalesce(v_el->>'portion_id', '') <> '' THEN
      SELECT * INTO v_por FROM public.menu_item_portions
       WHERE id = (v_el->>'portion_id')::uuid AND menu_item_id = v_mi.id AND is_available;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Porsiyon seçeneği geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_por.price_cents;
      v_title := v_title || ' (' || v_por.label || ')';
    END IF;

    IF coalesce(v_el->>'variant_id', '') <> '' THEN
      SELECT * INTO v_var FROM public.menu_item_variants
       WHERE id = (v_el->>'variant_id')::uuid AND menu_item_id = v_mi.id AND is_available;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Seçenek geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_unit + v_var.price_diff_cents;
      v_title := v_title || ' (' || v_var.label || ')';
    END IF;

    v_extras_sum := 0;
    v_extras_lbl := NULL;
    IF jsonb_typeof(v_el->'extra_ids') = 'array' AND jsonb_array_length(v_el->'extra_ids') > 0 THEN
      SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_extra_ids
        FROM jsonb_array_elements_text(v_el->'extra_ids') AS x;
      SELECT count(*), coalesce(sum(price_cents), 0), string_agg(label, ', ' ORDER BY sort_order, label)
        INTO v_extras_n, v_extras_sum, v_extras_lbl
        FROM public.menu_item_extras
       WHERE id = ANY (v_extra_ids) AND menu_item_id = v_mi.id AND is_available;
      IF v_extras_n <> coalesce(array_length(v_extra_ids, 1), 0) THEN
        RAISE EXCEPTION 'Ek seçeneklerden biri geçersiz' USING ERRCODE = '22023';
      END IF;
      v_unit  := v_unit + v_extras_sum;
      v_title := v_title || ' + ' || v_extras_lbl;
    END IF;

    -- Seçim grupları: seçimler yalnızca bu ürüne ait açık seçeneklerden olur, her grubun kuralı
    -- burada denetlenir. Hiç seçim göndermeyen eski uygulama da zorunlu gruba takılır.
    v_option_ids := '{}';
    IF jsonb_typeof(v_el->'option_ids') = 'array' AND jsonb_array_length(v_el->'option_ids') > 0 THEN
      SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_option_ids
        FROM jsonb_array_elements_text(v_el->'option_ids') AS x;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(v_option_ids) AS sel(id)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.menu_options o
           JOIN public.menu_option_groups g ON g.id = o.group_id
          WHERE o.id = sel.id AND g.menu_item_id = v_mi.id AND o.is_available
       )
    ) THEN
      RAISE EXCEPTION '% için seçtiğin bir seçenek artık yok. Ürünü sepetten çıkarıp yeniden ekle.', v_mi.title USING ERRCODE = '22023';
    END IF;
    FOR v_grp IN
      SELECT g.title, g.min_select, g.max_select,
             count(o.id)::integer AS picked,
             coalesce(sum(o.price_cents), 0)::integer AS price,
             string_agg(o.label, ', ' ORDER BY o.sort_order, o.label) AS labels
        FROM public.menu_option_groups g
        LEFT JOIN public.menu_options o ON o.group_id = g.id AND o.id = ANY (v_option_ids)
       WHERE g.menu_item_id = v_mi.id
       GROUP BY g.id
       ORDER BY g.sort_order, g.title
    LOOP
      IF v_grp.picked < v_grp.min_select THEN
        RAISE EXCEPTION '% için % seçimi eksik', v_mi.title, v_grp.title USING ERRCODE = '22023';
      END IF;
      IF v_grp.max_select IS NOT NULL AND v_grp.picked > v_grp.max_select THEN
        RAISE EXCEPTION '% için % en fazla % seçilebilir', v_mi.title, v_grp.title, v_grp.max_select USING ERRCODE = '22023';
      END IF;
      IF v_grp.picked > 0 THEN
        v_unit  := v_unit + v_grp.price;
        v_title := v_title || ' · ' || v_grp.title || ': ' || v_grp.labels;
      END IF;
    END LOOP;

    -- Günlük stok (0 = sınırsız). Sayaç yalnızca bugünü tutar (sold_today + stock_reset_date), gelecek
    -- günlerin sayacı yoktur. Bu yüzden günlük adetle sınırlı ürün, başka bir güne planlanan siparişte
    -- reddedilir: bugünden düşülse o günün satışı gereksiz azalır, servis gününde de limit aşılırdı.
    -- Bugüne planlanan sipariş normal sipariş gibi bugünün sayacından düşer; iptalde orders_restock
    -- aynı sayaca geri verir. Limiti olmayan ürün her güne planlanabilir.
    IF v_mi.daily_limit > 0 THEN
      IF v_serve_date <> v_today THEN
        RAISE EXCEPTION '% günlük adetle sınırlı, yalnızca bugün için sipariş verebilirsin', v_mi.title USING ERRCODE = '22023';
      END IF;
      v_sold := CASE WHEN v_mi.stock_reset_date = v_today THEN v_mi.sold_today ELSE 0 END;
      IF v_sold + v_qty > v_mi.daily_limit THEN
        RAISE EXCEPTION 'Stok yetersiz: %', v_mi.title USING ERRCODE = '22023';
      END IF;
      UPDATE public.menu_items
         SET sold_today = v_sold + v_qty, stock_reset_date = v_today, updated_at = now()
       WHERE id = v_mi.id;
    END IF;

    v_subtotal := v_subtotal + v_unit * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_mi.id, 'title', v_title, 'unit', v_unit, 'qty', v_qty, 'line', v_unit * v_qty);
  END LOOP;

  IF v_subtotal < v_min THEN
    RAISE EXCEPTION 'Minimum sipariş tutarı: ₺%', to_char(v_min / 100.0, 'FM999990.##') USING ERRCODE = '22023';
  END IF;

  v_delivery := CASE WHEN v_pickup OR v_subtotal >= v_free_over THEN 0 ELSE v_fee END;

  IF coalesce(btrim(p_coupon_code), '') <> '' THEN
    SELECT * INTO v_coupon FROM public.coupons
     WHERE upper(code) = upper(btrim(p_coupon_code))
       AND is_active
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kupon geçersiz veya süresi dolmuş' USING ERRCODE = '22023';
    END IF;
    IF v_coupon.owner_id IS NOT NULL AND v_coupon.owner_id <> v_uid THEN
      RAISE EXCEPTION 'Kupon geçersiz veya süresi dolmuş' USING ERRCODE = '22023';
    END IF;
    IF v_coupon.seller_id IS NOT NULL AND v_coupon.seller_id <> p_seller_id THEN
      RAISE EXCEPTION 'Bu kupon yalnızca kuponu veren satıcıda geçerli' USING ERRCODE = '22023';
    END IF;
    IF v_subtotal < v_coupon.min_order_cents THEN
      RAISE EXCEPTION 'Kupon için minimum tutar karşılanmıyor' USING ERRCODE = '22023';
    END IF;
    IF v_pickup AND v_coupon.discount_type = 'free_delivery' THEN
      RAISE EXCEPTION 'Ücretsiz teslimat kuponu gelip almada geçerli değil' USING ERRCODE = '22023';
    END IF;
    -- Kupon satırı FOR UPDATE ile kilitli: aynı anda gelen iki sipariş hakkı aşamaz.
    IF v_coupon.max_uses_per_user IS NOT NULL AND (
      SELECT count(*) FROM public.coupon_redemptions r
       WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid
    ) >= v_coupon.max_uses_per_user THEN
      RAISE EXCEPTION 'Bu kuponu kullanım hakkın doldu' USING ERRCODE = '22023';
    END IF;
    IF v_coupon.discount_type = 'percent' THEN
      v_discount := floor(v_subtotal * v_coupon.discount_value / 100.0)::integer;
      IF v_coupon.max_discount_cents IS NOT NULL THEN
        v_discount := least(v_discount, v_coupon.max_discount_cents);
      END IF;
    ELSIF v_coupon.discount_type = 'fixed' THEN
      v_discount := least(v_coupon.discount_value, v_subtotal);
    ELSIF v_coupon.discount_type = 'free_delivery' THEN
      -- Platform kuponunda teslimat bedelini platform üstlenir, ama en çok kendi ücreti kadar:
      -- satıcı kendi ücretini yüksek girip platformdan para çekemesin, fazlası satıcıya kalır.
      IF v_coupon.seller_id IS NULL THEN
        v_platform_delivery := least(v_delivery, v_platform_fee);
      END IF;
      v_delivery := 0;
    END IF;
    IF v_coupon.seller_id IS NOT NULL THEN
      v_seller_discount := v_discount;
    END IF;
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
  END IF;

  -- Bahşiş indirime girmez: müşteri ne yazdıysa o kadar eklenir.
  v_total := greatest(v_subtotal + v_delivery - v_discount, 0) + v_tip;
  IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents <> v_total THEN
    RAISE EXCEPTION 'Sipariş tutarı değişti' USING ERRCODE = 'EVN01', DETAIL = v_total::text;
  END IF;
  -- Satıcının kendi indirimi satış tutarını düşürür; komisyon kalan tutardan alınır. Bahşiş komisyona girmez.
  v_commission := round((v_subtotal - v_seller_discount) * v_rate / 100.0)::integer;
  IF p_payment_method = 'online' AND v_total <= 0 THEN
    RAISE EXCEPTION 'Ödenecek tutar yok, kapıda ödemeyi seç' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (
    customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency,
    delivery_address, notes, payment_method, payment_status,
    commission_rate, commission_cents, discount_cents, coupon_code, seller_discount_cents, platform_delivery_cents,
    terms_version, terms_accepted_at, fulfillment, scheduled_for, tip_cents
  ) VALUES (
    v_uid, p_seller_id, CASE WHEN p_payment_method = 'online' THEN 'awaiting_payment' ELSE 'pending' END, v_subtotal, v_delivery, v_total, 'TRY',
    CASE WHEN v_pickup THEN 'Gelip alınacak' ELSE btrim(p_delivery_address) END, nullif(btrim(coalesce(p_notes, '')), ''), p_payment_method, 'pending',
    v_rate, v_commission, v_discount, CASE WHEN v_coupon.id IS NOT NULL THEN v_coupon.code END, v_seller_discount, v_platform_delivery,
    nullif(btrim(coalesce(p_terms_version, '')), ''), CASE WHEN nullif(btrim(coalesce(p_terms_version, '')), '') IS NOT NULL THEN now() END,
    v_fulfillment, p_scheduled_for, v_tip
  ) RETURNING * INTO v_order;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO public.order_items (order_id, menu_item_id, title_snapshot, unit_price_cents, quantity, line_total_cents)
    VALUES (v_order.id, (v_line->>'menu_item_id')::uuid, v_line->>'title',
            (v_line->>'unit')::integer, (v_line->>'qty')::integer, (v_line->>'line')::integer);
  END LOOP;

  IF v_coupon.id IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions (coupon_id, user_id, order_id)
    VALUES (v_coupon.id, v_uid, v_order.id);
  END IF;

  RETURN v_order;
END $$;

-- delete_my_account() (son tanım: 054_payout_schedule.sql)
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hesap silmek için giriş yapmalısın' USING ERRCODE = '42501';
  END IF;
  IF public.is_admin() THEN
    RAISE EXCEPTION 'Yönetici hesabı uygulamadan silinemez' USING ERRCODE = '55000';
  END IF;

  SELECT id INTO v_seller FROM public.sellers WHERE user_id = v_uid;

  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE (o.customer_id = v_uid OR o.seller_id = v_seller)
       AND o.status NOT IN ('delivered', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Devam eden siparişlerin var. Tamamlandıktan veya iptal edildikten sonra hesabını silebilirsin.'
      USING ERRCODE = '55000';
  END IF;

  IF v_seller IS NOT NULL AND (
    (public.seller_open_totals(v_seller)).order_count > 0
    OR EXISTS (SELECT 1 FROM public.orders o
                WHERE o.seller_id = v_seller AND o.status = 'delivered' AND o.refund_status = 'requested')
    OR EXISTS (SELECT 1 FROM public.payment_approvals a JOIN public.orders o ON o.id = a.order_id
                WHERE o.seller_id = v_seller AND a.status IN ('pending', 'failed'))
    OR EXISTS (SELECT 1 FROM public.seller_payouts p WHERE p.seller_id = v_seller AND p.status = 'pending')
  ) THEN
    RAISE EXCEPTION 'Bekleyen hesap kesimin var. Kesim tamamlandıktan sonra hesabını silebilirsin; destek ekibimize yaz.'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.reviews WHERE customer_id = v_uid OR seller_id = v_seller;

  PERFORM set_config('app.internal', '1', true);

  UPDATE public.orders
     SET customer_id = NULL, delivery_address = NULL, notes = NULL,
         cancel_reason = NULL, refund_reason = NULL, updated_at = now()
   WHERE customer_id = v_uid;

  IF v_seller IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.orders WHERE seller_id = v_seller) THEN
      DELETE FROM public.menu_items WHERE seller_id = v_seller;
      DELETE FROM public.seller_hours WHERE seller_id = v_seller;
      DELETE FROM public.favorites WHERE seller_id = v_seller;
      DELETE FROM public.seller_follows WHERE seller_id = v_seller;
      DELETE FROM public.conversations WHERE seller_id = v_seller;
      DELETE FROM public.seller_payout_accounts WHERE seller_id = v_seller;
      DELETE FROM public.seller_company_info WHERE seller_id = v_seller;
      UPDATE public.coupons SET is_active = FALSE WHERE seller_id = v_seller;
      UPDATE public.sellers
         SET user_id = NULL, display_name = 'Silinmiş satıcı', bio = NULL, city = NULL, district = NULL,
             address_line = NULL, latitude = NULL, longitude = NULL, logo_url = NULL, cover_url = NULL,
             rating_avg = 0, rating_count = 0, is_active = FALSE, uses_weekly_menu = FALSE, updated_at = now()
       WHERE id = v_seller;
    ELSE
      DELETE FROM public.sellers WHERE id = v_seller;
    END IF;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hesap bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.internal', '', true);
  RETURN v_seller;
END $$;

COMMIT;
