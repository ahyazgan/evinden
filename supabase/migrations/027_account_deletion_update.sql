-- 027: Hesap silme yeni tablolarla uyumlu
--
-- Yeni tablolar (sohbet, takip, ödeme hesabı, satıcı kuponu) silinen mağazada kalmamalı; satıcının açık
-- bakiyesi varsa önce hesap kesimi yapılmalı. Satış geçmişi olmayan mağazada kayıtlar CASCADE ile gider.

BEGIN;

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

  -- Açık bakiye silinirse ne satıcıya ödeme yapılabilir ne de komisyon tahsil edilebilir.
  -- Bakiye sıfır görünse de kesilmemiş sipariş veya açık iade talebi varsa sonradan tutar doğabilir.
  IF v_seller IS NOT NULL AND (
    (public.seller_open_totals(v_seller)).order_count > 0
    OR EXISTS (SELECT 1 FROM public.orders o
                WHERE o.seller_id = v_seller AND o.status = 'delivered' AND o.refund_status = 'requested')
  ) THEN
    RAISE EXCEPTION 'Bekleyen hesap kesiminiz var. Kesim tamamlandıktan sonra hesabınızı silebilirsiniz; destek ekibimize yazın.'
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
      DELETE FROM public.seller_follows WHERE seller_id = v_seller;
      DELETE FROM public.conversations WHERE seller_id = v_seller;
      DELETE FROM public.seller_payout_accounts WHERE seller_id = v_seller;
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

  -- public.users ve ona bağlı kayıtlar (favori, adres, bildirim, sadakat, referans) buradan silinir.
  DELETE FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hesap bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.internal', '', true);
  RETURN v_seller;
END $$;

COMMIT;
