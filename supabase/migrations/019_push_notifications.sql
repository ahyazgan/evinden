-- 019: Bildirimleri telefona push olarak gönder
--
-- notifications tablosuna yazılan her kayıt, kullanıcının push_token'ı varsa Expo Push API'ye iletilir.
-- pg_net isteği işlem bittikten sonra arka planda gönderir. Gönderim hatası siparişi asla engellemez.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notifications_send_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
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
        'sound', 'default',
        'channelId', CASE WHEN NEW.type = 'order_status' THEN 'orders' ELSE 'system' END,
        'data', coalesce(NEW.data, '{}'::jsonb) || jsonb_build_object('type', NEW.type)
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push gönderilemedi: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notifications_send_push_trg ON public.notifications;
CREATE TRIGGER notifications_send_push_trg
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_send_push();
