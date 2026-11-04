-- 034: Keşif: gece verilen planlı siparişin yanıt süresi ve yemek etiketleri.
--
-- Planlı sipariş: restoran kapalıyken verilen sipariş yanıtsız kaldığı için 30 dakikada iptal oluyor,
--   online ödemeler de iade kuyruğuna düşüyordu. Planlı siparişte yanıt süresi artık yalnızca restoranın
--   açık olduğu zamanı sayar. Normal siparişin kuralı değişmedi.
-- Yemek etiketleri: satıcı işaretler (lib/dietary.ts ile aynı liste). Glutensiz ve sütsüz burada yok:
--   allergens kolonundan türetilir, iki ayrı kaynak birbiriyle çelişmesin.

BEGIN;

-- ── 1. Planlı siparişin yanıt süresi ───────────────────────────────────────

-- Son p_minutes dakikanın tamamında açık mı? Yalnızca iki ucu sormak yetmez: gece yarısını aşan saatlerde
-- araya kısa bir kapalılık girebilir (00:05'te kapanıp 00:10'da açılan restoran). Saatler dakika
-- çözünürlüğünde girildiği için her dakika sorulur; bu yalnızca bekleyen planlı siparişlerde çalışır.
CREATE OR REPLACE FUNCTION public.seller_open_throughout(p_seller_id uuid, p_minutes integer, p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM generate_series(p_at - make_interval(mins => p_minutes), p_at, interval '1 minute') AS t(at)
     WHERE NOT public.seller_open_at(p_seller_id, t.at)
  );
$$;
REVOKE ALL ON FUNCTION public.seller_open_throughout(uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;

-- Planlı siparişin süresi doldu mu: sipariş p_minutes'tan eski ve restoran o kadar süredir açık.
CREATE OR REPLACE FUNCTION public.scheduled_reply_elapsed(p_seller_id uuid, p_since timestamptz, p_minutes integer)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_since < now() - make_interval(mins => p_minutes)
     AND public.seller_open_throughout(p_seller_id, p_minutes);
$$;
REVOKE ALL ON FUNCTION public.scheduled_reply_elapsed(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;

-- 033'teki görevle aynı; farkı bekleyen planlı sipariş:
--   Hatırlatma ve iptal restoran kapalıyken çalışmaz, süre açık geçen zamandan sayılır.
--   Saatine 15 dakikadan az kalmış ve hâlâ yanıtsız sipariş her durumda iptal olur: restoran
--   artık hazırlayamaz, müşteri de yemeğini boşuna beklemesin.
CREATE OR REPLACE FUNCTION public.expire_pending_orders(p_remind_minutes integer DEFAULT 10, p_cancel_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer;
BEGIN
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

-- ── 2. Yemek etiketleri ────────────────────────────────────────────────────

ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS dietary text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_dietary_known;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_dietary_known CHECK (
  dietary <@ ARRAY['vegetarian','vegan','spicy']::text[]
);

COMMIT;
