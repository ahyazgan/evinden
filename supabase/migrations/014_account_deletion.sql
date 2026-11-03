-- 014: Hesap silme
--
-- Çözülen sorun: uygulamanın istemciden yaptığı DELETE'ler RLS'e takılıp hata vermeden 0 satır
-- etkiliyordu; kullanıcı silinmiş sanılıyor ama hesap ve auth.users kaydı duruyordu.
--
-- Yeni davranış (delete_my_account):
--  - Açık siparişi olan hesap silinemez.
--  - Müşterinin yorumları, favorileri, adresleri, bildirimleri, sadakat ve referans kayıtları silinir.
--  - Geçmiş siparişler muhasebe için kalır; müşteri bağlantısı, adres ve metin alanları temizlenir.
--  - Satıcının satış geçmişi varsa mağaza kaydı anonimleştirilerek kalır (orders.seller_id bağı için),
--    menüsü silinir. Satış geçmişi yoksa mağaza tamamen silinir.
--  - auth.users kaydı silinir; böylece aynı e-posta ile giriş yapılamaz.

BEGIN;

-- ── 1. Bağlantılar: kullanıcı silindiğinde hangi kayıt ne olur ─────────────

ALTER TABLE public.orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_customer_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_customer_id_fkey;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_fkey;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_referrer_id_fkey
  FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_referred_id_fkey;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_referred_id_fkey
  FOREIGN KEY (referred_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- Sipariş kalemi ürünün adını ve fiyatını kendi üzerinde saklar; ürün silinince bağ boşalır.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_menu_item_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_menu_item_id_fkey
  FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;

-- Sahibi silinmiş mağaza yeniden açılamaz.
ALTER TABLE public.sellers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_deleted_not_active;
ALTER TABLE public.sellers
  ADD CONSTRAINT sellers_deleted_not_active CHECK (user_id IS NOT NULL OR NOT is_active);

-- ── 2. orders_guard: müşterisi silinmiş sipariş ────────────────────────────
-- customer_id artık boş olabilir. Eski karşılaştırma NULL üretiyor, iade kontrolündeki
-- NOT (NULL AND ...) da NULL'a dönüp hatayı atlıyordu; satıcı iade talebi açabilirdi.

CREATE OR REPLACE FUNCTION public.orders_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_seller boolean;
  v_is_customer boolean;
  v_status_ok boolean := FALSE;
BEGIN
  IF v_uid IS NULL OR public.is_admin() OR public._internal_call() THEN
    RETURN NEW;
  END IF;

  -- Para ve kimlik alanları kimse tarafından (admin hariç) değiştirilemez.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.delivery_fee_cents IS DISTINCT FROM OLD.delivery_fee_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.coupon_code IS DISTINCT FROM OLD.coupon_code
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.commission_cents IS DISTINCT FROM OLD.commission_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Sipariş tutarı ve temel bilgileri değiştirilemez' USING ERRCODE = '42501';
  END IF;

  v_is_customer := coalesce(OLD.customer_id = v_uid, FALSE);
  v_is_seller := EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = OLD.seller_id AND s.user_id = v_uid);

  -- Durum geçişi
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_is_seller THEN
      v_status_ok := CASE OLD.status
        WHEN 'pending'          THEN NEW.status IN ('accepted', 'cancelled')
        WHEN 'accepted'         THEN NEW.status IN ('preparing', 'cancelled')
        WHEN 'preparing'        THEN NEW.status IN ('ready', 'cancelled')
        WHEN 'ready'            THEN NEW.status IN ('out_for_delivery', 'delivered', 'cancelled')
        WHEN 'out_for_delivery' THEN NEW.status IN ('delivered', 'cancelled')
        ELSE FALSE
      END;
    END IF;
    IF NOT v_status_ok AND v_is_customer THEN
      v_status_ok := (NEW.status = 'cancelled' AND OLD.status IN ('pending', 'accepted'));
    END IF;
    IF NOT v_status_ok THEN
      RAISE EXCEPTION 'Geçersiz sipariş durumu değişikliği: % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Ödeme durumu: yalnızca satıcı, teslimde 'pending' -> 'paid' (nakit / kapıda kart tahsilatı)
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NOT (v_is_seller AND OLD.payment_status = 'pending' AND NEW.payment_status = 'paid'
            AND NEW.status = 'delivered') THEN
      RAISE EXCEPTION 'Ödeme durumu bu şekilde değiştirilemez' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- İade: müşteri yalnızca teslim edilmiş siparişte talep açabilir; onay / ret yöneticide.
  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status THEN
    IF NOT (v_is_customer AND coalesce(OLD.refund_status, 'none') = 'none'
            AND NEW.refund_status = 'requested' AND OLD.status = 'delivered') THEN
      RAISE EXCEPTION 'İade durumu bu şekilde değiştirilemez' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF length(coalesce(NEW.cancel_reason, '')) > 500 OR length(coalesce(NEW.refund_reason, '')) > 500 THEN
    RAISE EXCEPTION 'Açıklama çok uzun' USING ERRCODE = '22001';
  END IF;

  RETURN NEW;
END $$;

-- ── 3. delete_my_account ───────────────────────────────────────────────────
-- Parametre almaz: yalnızca çağıran kendi hesabını silebilir.
-- Silinen mağazanın kimliğini döndürür; istemci mağaza fotoğraflarını bununla temizler.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Hesap silmek için giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  -- Son yöneticinin kendini silip paneli sahipsiz bırakmasını önler.
  IF public.is_admin() THEN
    RAISE EXCEPTION 'Yönetici hesabı uygulamadan silinemez' USING ERRCODE = '55000';
  END IF;

  SELECT id INTO v_seller FROM public.sellers WHERE user_id = v_uid;

  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE (o.customer_id = v_uid OR o.seller_id = v_seller)
       AND o.status NOT IN ('delivered', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Devam eden siparişleriniz var. Tamamlandıktan veya iptal edildikten sonra hesabınızı silebilirsiniz.'
      USING ERRCODE = '55000';
  END IF;

  -- Önce yorumlar: puan tetikleyicisi bittiğinde app.internal işaretini temizler,
  -- bu yüzden işaret ancak bu adımdan sonra açılır.
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
      UPDATE public.sellers
         SET user_id = NULL, display_name = 'Silinmiş satıcı', bio = NULL, city = NULL, district = NULL,
             address_line = NULL, latitude = NULL, longitude = NULL, logo_url = NULL, cover_url = NULL,
             rating_avg = 0, rating_count = 0, is_active = FALSE, uses_weekly_menu = FALSE, updated_at = now()
       WHERE id = v_seller;
    ELSE
      DELETE FROM public.sellers WHERE id = v_seller;
    END IF;
  END IF;

  -- public.users ve ona bağlı kayıtlar (favori, adres, bildirim, sadakat, referans) buradan silinir.
  DELETE FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hesap bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.internal', '', true);
  RETURN v_seller;
END $$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMIT;
