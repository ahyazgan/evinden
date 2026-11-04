-- 037: bağımsız incelemede bulunan sunucu hataları.
--
-- 1. Kapıda ödeme sınırı günler sonrasına planlı ve unutulmuş siparişleri saymaz; eski kurye konumu silinir.
-- 2. Pazaryeri: iyzico'nun onaylı dediği sipariş kayda da onaylı geçer, geri çekilemeyen iadede satıcı borçlanır.
-- 3. Kupon: telefon başına hak, hesap silinince sıfırlanmaz. Ham telefon artık saklanmaz.
-- 4. seller_payout_accounts.updated_at cihaz saatinden değil veritabanından gelir.
--
-- Yeniden çalıştırılabilir.

BEGIN;

-- ── 1. Kapıda ödeme sınırı ─────────────────────────────────────────────────

-- door_active_horizon_hours: planlı sipariş, saatine bu kadar kala sınıra girer.
-- door_active_stale_hours: bu kadar süredir durumu değişmeyen sipariş unutulmuş sayılır, sınıra girmez.
CREATE OR REPLACE FUNCTION public.fraud_rule_defaults()
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "door_active_limit": 2,
    "door_active_horizon_hours": 2,
    "door_active_stale_hours": 12,
    "door_cancel_limit": 3,
    "door_cancel_days": 30,
    "flag_new_account_hours": 24,
    "flag_new_account_total_cents": 200000,
    "flag_burst_orders": 3,
    "flag_burst_minutes": 10
  }'::jsonb;
$$;
REVOKE ALL ON FUNCTION public.fraud_rule_defaults() FROM PUBLIC, anon, authenticated;

-- Yeni anahtarlar yönetici ayarında da görünsün. Elle değiştirilmiş eşikler korunur.
UPDATE public.app_config SET value = public.fraud_rule_defaults() || value WHERE key = 'fraud_rules';

-- 035 ile aynı; yalnızca aktif sipariş sayımı değişti. Unutulmuş sipariş kapatılmaz: para etkisi var ve yönetici
-- canlı izleme ekranında takılmış olarak görür. Burada yalnızca müşterinin önünü kesmesi engellenir.
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
       AND (o.scheduled_for IS NULL
            OR o.scheduled_for <= now() + make_interval(hours => public.fraud_rule('door_active_horizon_hours')))
       AND coalesce(o.status_changed_at, o.created_at)
             >= now() - make_interval(hours => public.fraud_rule('door_active_stale_hours'))
  ) >= public.fraud_rule('door_active_limit') THEN
    RAISE EXCEPTION '%', 'Aynı anda en çok ' || public.fraud_rule('door_active_limit') || ' kapıda ödemeli siparişin olabilir. '
      || CASE WHEN v_online THEN 'Online ödeyebilir ya da biri tamamlanınca tekrar deneyebilirsin.' ELSE 'Biri tamamlanınca tekrar dene.' END
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_fraud_guard() FROM PUBLIC, anon, authenticated;

-- 035 ile aynı; ek olarak 6 saat güncellenmeyen kurye konumu silinir. Konum kişisel veridir: teslim edilmeden
-- unutulan siparişin satırı başka hiçbir yoldan silinmezdi. Paylaşım sürerse satır bir sonraki konumla geri gelir.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer;
BEGIN
  DELETE FROM public.analytics_events WHERE created_at < now() - interval '180 days';
  DELETE FROM public.order_courier_locations WHERE updated_at < now() - interval '6 hours';

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

-- ── 2. Pazaryeri onay kaydı ────────────────────────────────────────────────

-- payment-refund, iyzico'nun ödeme sorgusunda onaylı (transactionStatus 2) gördüğü siparişi geri çekmeyi denemeden
-- önce buraya yazar. Sorgu en güncel bilgidir, bu yüzden daha önce 'reversed' yazılmışsa da düzeltilir. Geri çekme
-- başarılı olursa mark_marketplace_reversed kaydı geri alır; başarısız olur ve yönetici panelden iade ederse
-- order_open_amount_cents satıcının hakkını borç yazar. Yazılmasaydı sipariş 'held' kalır, payı platform üstlenirdi.
CREATE OR REPLACE FUNCTION public.mark_marketplace_approved(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders SET marketplace_status = 'approved', updated_at = now()
   WHERE id = p_order AND marketplace_status IS NOT NULL AND marketplace_status <> 'approved';
  UPDATE public.payment_approvals
     SET status = 'approved', approved_at = coalesce(approved_at, now()), last_error = NULL,
         locked_until = NULL, updated_at = now()
   WHERE order_id = p_order AND status <> 'approved';
END $$;
REVOKE ALL ON FUNCTION public.mark_marketplace_approved(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_marketplace_approved(uuid) TO service_role;

-- iyzico onayı doğruladı: kuyruk satırı bu arada iptal edilmiş olsa da (admin_mark_refunded kilide bakmaz) para
-- satıcıya gidiyor, sipariş 'held' kalmamalı. Tek istisna 'reversed': iade iyzico'ya sorup karar vermiştir, geç gelen
-- bu yanıt ondan eskidir. Hâlâ yanlışsa yeniden iade denemesindeki sorgu mark_marketplace_approved ile düzeltir.
CREATE OR REPLACE FUNCTION public.complete_payment_approval(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders SET marketplace_status = 'approved', updated_at = now()
   WHERE id = p_order AND marketplace_status = 'held';
  UPDATE public.payment_approvals a
     SET status = 'approved', approved_at = coalesce(a.approved_at, now()), last_error = NULL,
         locked_until = NULL, updated_at = now()
    FROM public.orders o
   WHERE a.order_id = p_order AND o.id = a.order_id
     AND a.status <> 'approved' AND o.marketplace_status = 'approved';
END $$;

-- ── 3. Kupon: telefon başına kullanım ──────────────────────────────────────

-- Hesapla bağı yok: hesap silinince coupon_redemptions kayıtları gider, bu satırlar kalır ve aynı numara hakkı
-- yeniden kazanamaz. Telefonun kendisi saklanmaz. Politika ve istemci yetkisi yok, yalnızca tetikleyiciler yazar.
CREATE TABLE IF NOT EXISTS public.coupon_phone_uses (
  coupon_id  uuid        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  phone_hash text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_phone_uses_lookup_idx ON public.coupon_phone_uses (coupon_id, phone_hash);
ALTER TABLE public.coupon_phone_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_phone_uses FROM PUBLIC, anon, authenticated;

-- Kupon numarası tuz yerine geçer: aynı telefonun özeti iki kuponda farklıdır, kuponlar arası eşleşmez.
CREATE OR REPLACE FUNCTION public.coupon_phone_hash(p_coupon uuid, p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_coupon::text || ':' || p_phone, 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public.coupon_phone_hash(uuid, text) FROM PUBLIC, anon, authenticated;

-- 035'in yerine. Sayaç iki yerden bakar, çift saymamak için büyüğü alınır: kullanımda telefonu olanlar özetle,
-- önce kullanıp telefonu sonradan doğrulayan hesaplar (o an özet yazılmadı) güncel numarayla bulunur.
-- Kupon satırı place_order'da kilitli, yarış olmaz.
CREATE OR REPLACE FUNCTION public.coupon_redemptions_phone_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer;
  v_phone text := public.verified_phone(NEW.user_id);
  v_hash  text;
BEGIN
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;
  v_hash := public.coupon_phone_hash(NEW.coupon_id, v_phone);
  SELECT max_uses_per_user INTO v_limit FROM public.coupons WHERE id = NEW.coupon_id;
  IF v_limit IS NOT NULL AND greatest(
    (SELECT count(*) FROM public.coupon_phone_uses u WHERE u.coupon_id = NEW.coupon_id AND u.phone_hash = v_hash),
    (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = NEW.coupon_id AND public.verified_phone(r.user_id) = v_phone)
  ) >= v_limit THEN
    RAISE EXCEPTION 'Bu kupon telefon numaran için kullanıldı, kuponu kaldırıp tekrar dene' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.coupon_phone_uses (coupon_id, phone_hash) VALUES (NEW.coupon_id, v_hash);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.coupon_redemptions_phone_guard() FROM PUBLIC, anon, authenticated;

-- 013 ile aynı; iptal telefon hakkını da geri verir. Hesap silme bu yoldan geçmez, onun için hak geri dönmez.
-- Satırda hesap bağı olmadığından müşterinin güncel numarasıyla aranır. Numara siparişle iptal arasında değiştiyse
-- eski numaranın hakkı geri dönmez: müşteri kaybetmez (yeni numarasında hakkı duruyor), yanılma payı güvenli yönde.
CREATE OR REPLACE FUNCTION public.orders_release_coupon()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coupon uuid;
  v_user   uuid;
  v_phone  text;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    DELETE FROM public.coupon_redemptions WHERE order_id = NEW.id RETURNING coupon_id, user_id INTO v_coupon, v_user;
    IF FOUND THEN
      UPDATE public.coupons SET used_count = greatest(used_count - 1, 0) WHERE id = v_coupon;
      v_phone := public.verified_phone(v_user);
      IF v_phone IS NOT NULL THEN
        DELETE FROM public.coupon_phone_uses
         WHERE ctid = (
           SELECT u.ctid FROM public.coupon_phone_uses u
            WHERE u.coupon_id = v_coupon AND u.phone_hash = public.coupon_phone_hash(v_coupon, v_phone)
            ORDER BY u.created_at DESC
            LIMIT 1
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Eski kullanımlar taşınır, ham telefon sütunu kalkar. Sütun yoksa bu adım daha önce çalışmıştır.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'coupon_redemptions' AND column_name = 'verified_phone'
  ) THEN
    EXECUTE $backfill$
      INSERT INTO public.coupon_phone_uses (coupon_id, phone_hash, created_at)
      SELECT r.coupon_id, public.coupon_phone_hash(r.coupon_id, p.phone), r.created_at
        FROM public.coupon_redemptions r
        CROSS JOIN LATERAL (SELECT coalesce(r.verified_phone, public.verified_phone(r.user_id)) AS phone) p
       WHERE p.phone IS NOT NULL
    $backfill$;
    ALTER TABLE public.coupon_redemptions DROP COLUMN verified_phone;
  END IF;
END $$;

-- ── 4. Satıcı ödeme hesabı ─────────────────────────────────────────────────

-- updated_at, admin_marketplace_sellers'taki needs_sync kararını verir. Cihaz saati ileriyse kayıt sonsuza dek
-- "güncelleme gerekir" görünürdü, geriyse IBAN değişikliği iyzico'ya hiç gitmezdi.
CREATE OR REPLACE FUNCTION public.seller_payout_accounts_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seller_payout_accounts_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seller_payout_accounts_touch_trg ON public.seller_payout_accounts;
CREATE TRIGGER seller_payout_accounts_touch_trg
  BEFORE INSERT OR UPDATE ON public.seller_payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.seller_payout_accounts_touch();

-- Geleceğe yazılmış eski kayıtlar bir sonraki iyzico güncellemesinden sonra normale dönsün.
UPDATE public.seller_payout_accounts SET updated_at = now() WHERE updated_at > now();

COMMIT;
