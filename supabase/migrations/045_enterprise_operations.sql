-- 045: Kurumsal operasyonlar — SLA, gelişmiş raporlar, e-fatura, iade ve mutabakat.
--
-- Güvenlik ilkesi:
-- - Tüm mali kararlar yönetici RPC'leriyle verilir; istemci tabloları doğrudan yazamaz.
-- - GİB için doğrudan bir sahte bağlantı yoktur. Faturalar UBL olarak hazırlanır ve e-fatura sağlayıcısına
--   Edge Function üzerinden gönderilir. Sağlayıcı adresi/anahtarı tanımlı değilse gönderim başarısız olur.
-- - SLA cezası ayrı tabloda tutulur; mevcut satıcı kazanç/hakediş hesabı değiştirilmez.
-- - Varsayılan kural yalnızca ihlal kaydeder: hazırlanan sipariş iptal edilmez, ceza tutarı 0 kuruştur.

BEGIN;

-- ── 1. Yapılandırma ve SLA ───────────────────────────────────────────────

INSERT INTO public.app_config (key, value) VALUES
  ('sla_policy', '{"enabled":true,"reminder_minutes":10,"cancel_minutes":30,"preparation_cancel_minutes":90,"action":"penalty","penalty_cents":0}'::jsonb),
  ('einvoice_policy', '{"enabled":false,"provider":"generic","invoice_prefix":"AFY","tax_rate_bps":1000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ready_at timestamptz;

CREATE OR REPLACE FUNCTION public.orders_enterprise_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.accepted_at := coalesce(NEW.accepted_at, CASE WHEN NEW.status = 'accepted' THEN now() END);
    NEW.ready_at := coalesce(NEW.ready_at, CASE WHEN NEW.status = 'ready' THEN now() END);
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL AND NOT public.is_admin() AND NOT public._internal_call() THEN
    -- İstemci zaman damgalarını doğrudan değiştiremez; durum geçişinin kendisi güvenlidir.
    IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
      NEW.accepted_at := now();
    ELSE
      NEW.accepted_at := OLD.accepted_at;
    END IF;
    IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
      NEW.ready_at := now();
    ELSE
      NEW.ready_at := OLD.ready_at;
    END IF;
  ELSE
    IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
      NEW.accepted_at := now();
    END IF;
    IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
      NEW.ready_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_enterprise_timestamps() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_aaa_enterprise_timestamps_trg ON public.orders;
CREATE TRIGGER orders_aaa_enterprise_timestamps_trg
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_enterprise_timestamps();

CREATE TABLE IF NOT EXISTS public.sla_violations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id      uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  violation_type text NOT NULL CHECK (violation_type IN ('acceptance_timeout','preparation_timeout')),
  minutes_late   integer NOT NULL CHECK (minutes_late >= 0),
  penalty_cents  integer NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waived','collected')),
  note           text CHECK (note IS NULL OR length(note) <= 500),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, violation_type)
);
CREATE INDEX IF NOT EXISTS sla_violations_seller_status_idx ON public.sla_violations (seller_id, status, occurred_at DESC);
ALTER TABLE public.sla_violations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sla_violations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sla_policy()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value FROM public.app_config WHERE key = 'sla_policy'),
    '{"enabled":true,"reminder_minutes":10,"cancel_minutes":30,"preparation_cancel_minutes":90,"action":"penalty","penalty_cents":0}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.sla_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sla_policy() TO authenticated, service_role;


-- SLA motorunun ilk sürümü; tam sürümü 048 kurar.
CREATE OR REPLACE FUNCTION public.sla_process_orders(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb;
  v_remind integer;
  v_cancel integer;
  v_prepare integer;
  v_action text;
  v_penalty integer;
  v_cancelled integer := 0;
  v_violations integer := 0;
  v_row record;
BEGIN
  v_policy := public.sla_policy();
  IF NOT coalesce((v_policy->>'enabled')::boolean, TRUE) THEN
    RETURN jsonb_build_object('cancelled', 0, 'violations', 0, 'enabled', false);
  END IF;
  v_remind := greatest(1, least(240, coalesce((v_policy->>'reminder_minutes')::integer, 10)));
  v_cancel := greatest(v_remind + 1, least(720, coalesce((v_policy->>'cancel_minutes')::integer, 30)));
  v_prepare := greatest(5, least(1440, coalesce((v_policy->>'preparation_cancel_minutes')::integer, 60)));
  v_action := CASE WHEN v_policy->>'action' = 'penalty' THEN 'penalty' ELSE 'cancel' END;
  v_penalty := greatest(0, least(100000, coalesce((v_policy->>'penalty_cents')::integer, 500)));

  FOR v_row IN
    SELECT o.id, o.seller_id, s.user_id,
           floor(extract(epoch FROM (p_now - coalesce(o.pending_since, o.created_at))) / 60)::integer AS age
      FROM public.orders o JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.status = 'pending'
  LOOP
    IF v_row.age >= v_remind AND v_row.age < v_cancel THEN
      UPDATE public.orders SET pending_reminded_at = p_now
       WHERE id = v_row.id AND pending_reminded_at IS NULL;
      IF FOUND THEN
        PERFORM public.notify_user(v_row.user_id, 'Bekleyen siparişin var',
          'Yanıtlamazsan sipariş iptal edilecek.', 'order_status', jsonb_build_object('orderId', v_row.id));
      END IF;
    END IF;

    IF v_row.age >= v_cancel THEN
      INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late, penalty_cents)
      VALUES (v_row.id, v_row.seller_id, 'acceptance_timeout', v_row.age - v_cancel, v_penalty)
      ON CONFLICT (order_id, violation_type) DO NOTHING;
      IF FOUND THEN v_violations := v_violations + 1; END IF;
      IF v_action = 'cancel' THEN
        UPDATE public.orders SET status = 'cancelled', cancel_reason = 'SLA: satıcı zamanında yanıtlamadı', updated_at = p_now
         WHERE id = v_row.id AND status = 'pending';
        IF FOUND THEN v_cancelled := v_cancelled + 1; END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT o.id, o.seller_id,
           floor(extract(epoch FROM (p_now - coalesce(o.accepted_at, o.status_changed_at, o.updated_at))) / 60)::integer AS age
      FROM public.orders o
     WHERE o.status = 'accepted'
  LOOP
    IF v_row.age >= v_prepare THEN
      INSERT INTO public.sla_violations (order_id, seller_id, violation_type, minutes_late, penalty_cents)
      VALUES (v_row.id, v_row.seller_id, 'preparation_timeout', v_row.age - v_prepare, v_penalty)
      ON CONFLICT (order_id, violation_type) DO NOTHING;
      IF FOUND THEN v_violations := v_violations + 1; END IF;
      IF v_action = 'cancel' THEN
        UPDATE public.orders SET status = 'cancelled', cancel_reason = 'SLA: hazırlama süresi aşıldı', updated_at = p_now
         WHERE id = v_row.id AND status = 'accepted';
        IF FOUND THEN v_cancelled := v_cancelled + 1; END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enabled', true, 'cancelled', v_cancelled, 'violations', v_violations,
    'reminder_minutes', v_remind, 'cancel_minutes', v_cancel, 'preparation_cancel_minutes', v_prepare);
END $$;
REVOKE ALL ON FUNCTION public.sla_process_orders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sla_process_orders(timestamptz) TO service_role;

-- Zamanlanmış görev bu motora 048 içinde bağlanır; 048 tam sürümü kurana kadar eski görev aynen çalışır.

COMMIT;

