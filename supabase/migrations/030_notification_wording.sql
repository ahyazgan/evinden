-- Sipariş bildirimleri "sen" diliyle ve emojisiz. Mantık aynı, yalnızca metinler değişti.

CREATE OR REPLACE FUNCTION public.orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller_user uuid;
  v_seller_name text;
  v_data  jsonb := jsonb_build_object('orderId', NEW.id);
  v_short text := left(NEW.id::text, 8);
  v_title text;
BEGIN
  SELECT user_id, display_name INTO v_seller_user, v_seller_name FROM public.sellers WHERE id = NEW.seller_id;

  -- Online sipariş satıcıya ödeme alındıktan sonra görünür.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'awaiting_payment' THEN
      PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', 'Sipariş #' || v_short || ' onayını bekliyor.', 'order_status', v_data);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'awaiting_payment' AND NEW.status = 'pending' THEN
    PERFORM public.notify_user(v_seller_user, 'Yeni sipariş', 'Sipariş #' || v_short || ' onayını bekliyor.', 'order_status', v_data);
    RETURN NEW;
  END IF;
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.notify_user(NEW.customer_id, 'Ödemen iade edildi', 'Sipariş #' || v_short, 'order_status', v_data);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_title := CASE NEW.status
      WHEN 'accepted'         THEN 'Siparişin kabul edildi'
      WHEN 'preparing'        THEN 'Siparişin hazırlanıyor'
      WHEN 'ready'            THEN 'Siparişin hazır'
      WHEN 'out_for_delivery' THEN 'Siparişin yolda'
      WHEN 'delivered'        THEN 'Siparişin teslim edildi'
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
