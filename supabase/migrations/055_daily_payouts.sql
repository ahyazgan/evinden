-- 055: Restoran ödeme sıklığını seçer: haftalık (varsayılan) veya günlük.
--
-- Günlük: gün İstanbul saatiyle 00:00'da kapanır; ertesi sabah 06:00'daki çalışmada o günün teslimleri kesilir.
-- Dün teslim edilen sipariş bugün kesilir, havalesi bugün yapılır. Günlükte dönem için 24 saat bekletme beklenmez;
-- iade koruması sipariş düzeyindedir: iade talebi açık sipariş kesime girmez, havaleden önce iadesi onaylanan
-- sipariş kesimden çıkar (054), havaleden sonraki iade sonraki kesime ters kayıt olur.
-- Yönetici günlük seçeneği payout_policy.allow_daily ile kapatabilir; kapalıyken herkes haftalık kesilir.
-- Sıklık seller_payout_accounts'ta tutulmaz: orada her değişiklik iyzico kaydını "güncelleme gerekir" yapar (037).

BEGIN;

-- ── 1. Ayar: günlük seçenek açık mı ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.payout_policy()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT coalesce((SELECT value FROM public.app_config WHERE key = 'payout_policy'), '{}'::jsonb) AS j)
  SELECT jsonb_build_object(
    'approve_delay_hours', CASE WHEN j->>'approve_delay_hours' ~ '^[0-9]{1,3}$'
                                THEN least(168, (j->>'approve_delay_hours')::integer) ELSE 24 END,
    'settlement_weekday', CASE WHEN j->>'settlement_weekday' ~ '^[1-7]$' THEN (j->>'settlement_weekday')::integer ELSE 1 END,
    'auto_settlement', CASE WHEN jsonb_typeof(j->'auto_settlement') = 'boolean' THEN (j->>'auto_settlement')::boolean ELSE true END,
    'allow_daily', CASE WHEN jsonb_typeof(j->'allow_daily') = 'boolean' THEN (j->>'allow_daily')::boolean ELSE true END
  ) FROM v;
$$;
REVOKE ALL ON FUNCTION public.payout_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_policy() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_payout_policy(p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_policy IS NULL OR jsonb_typeof(p_policy) <> 'object' THEN RAISE EXCEPTION 'Geçersiz ayar' USING ERRCODE = '22023'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_policy) LOOP
    IF v_key NOT IN ('approve_delay_hours','settlement_weekday','auto_settlement','allow_daily') THEN
      RAISE EXCEPTION 'Bilinmeyen ayar: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_policy ? 'approve_delay_hours' AND (jsonb_typeof(p_policy->'approve_delay_hours') <> 'number'
     OR (p_policy->>'approve_delay_hours') !~ '^[0-9]+$' OR (p_policy->>'approve_delay_hours')::integer > 168) THEN
    RAISE EXCEPTION 'Bekletme 0 ile 168 saat arasında olmalı' USING ERRCODE = '22023';
  END IF;
  IF p_policy ? 'settlement_weekday' AND (jsonb_typeof(p_policy->'settlement_weekday') <> 'number'
     OR (p_policy->>'settlement_weekday') !~ '^[1-7]$') THEN
    RAISE EXCEPTION 'Kesim günü 1 (pazartesi) ile 7 (pazar) arasında olmalı' USING ERRCODE = '22023';
  END IF;
  IF p_policy ? 'auto_settlement' AND jsonb_typeof(p_policy->'auto_settlement') <> 'boolean' THEN
    RAISE EXCEPTION 'Otomatik kesim açık veya kapalı olmalı' USING ERRCODE = '22023';
  END IF;
  IF p_policy ? 'allow_daily' AND jsonb_typeof(p_policy->'allow_daily') <> 'boolean' THEN
    RAISE EXCEPTION 'Günlük ödeme seçeneği açık veya kapalı olmalı' USING ERRCODE = '22023';
  END IF;
  v_value := public.payout_policy() || p_policy;
  INSERT INTO public.app_config (key, value) VALUES ('payout_policy', v_value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  RETURN public.payout_policy();
END $$;
REVOKE ALL ON FUNCTION public.admin_update_payout_policy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_payout_policy(jsonb) TO authenticated;

-- ── 2. Restoranın tercihi ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seller_payout_preferences (
  seller_id  uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  frequency  text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','daily')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_payout_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_payout_preferences FROM anon, authenticated;
GRANT SELECT ON public.seller_payout_preferences TO authenticated;
DROP POLICY IF EXISTS "Restoran ve yönetici ödeme sıklığını görür" ON public.seller_payout_preferences;
CREATE POLICY "Restoran ve yönetici ödeme sıklığını görür" ON public.seller_payout_preferences FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.set_my_payout_frequency(p_frequency text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller uuid;
BEGIN
  IF p_frequency NOT IN ('weekly','daily') THEN RAISE EXCEPTION 'Geçersiz ödeme sıklığı' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_seller FROM public.sellers WHERE user_id = auth.uid();
  IF v_seller IS NULL THEN RAISE EXCEPTION 'Restoran hesabı bulunamadı' USING ERRCODE = '42501'; END IF;
  IF p_frequency = 'daily' AND NOT (public.payout_policy()->>'allow_daily')::boolean THEN
    RAISE EXCEPTION 'Günlük ödeme şu an sunulmuyor' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.seller_payout_preferences (seller_id, frequency) VALUES (v_seller, p_frequency)
  ON CONFLICT (seller_id) DO UPDATE SET frequency = excluded.frequency, updated_at = now();
  RETURN p_frequency;
END $$;
REVOKE ALL ON FUNCTION public.set_my_payout_frequency(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_payout_frequency(text) TO authenticated;

-- Seçenek kapalıysa günlük seçmiş restoran da haftalık kesilir.
CREATE OR REPLACE FUNCTION public._seller_pays_daily(p_seller uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.payout_policy()->>'allow_daily')::boolean
     AND coalesce((SELECT frequency FROM public.seller_payout_preferences WHERE seller_id = p_seller), 'weekly') = 'daily';
$$;
REVOKE ALL ON FUNCTION public._seller_pays_daily(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Kesim kayıtları ──────────────────────────────────────────────────────

ALTER TABLE public.seller_payouts DROP CONSTRAINT IF EXISTS seller_payouts_kind_check;
ALTER TABLE public.seller_payouts ADD CONSTRAINT seller_payouts_kind_check CHECK (kind IN ('manual','weekly','daily'));

-- Haftalık ve günlük dönemler ayrı izlenir.
ALTER TABLE public.settlement_runs ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'weekly';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_runs_frequency_check') THEN
    ALTER TABLE public.settlement_runs ADD CONSTRAINT settlement_runs_frequency_check CHECK (frequency IN ('weekly','daily'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_runs_pkey'
              AND pg_get_constraintdef(oid) = 'PRIMARY KEY (period_end)') THEN
    ALTER TABLE public.settlement_runs DROP CONSTRAINT settlement_runs_pkey;
    ALTER TABLE public.settlement_runs ADD CONSTRAINT settlement_runs_pkey PRIMARY KEY (frequency, period_end);
  END IF;
END $$;

-- Bir restoranın bir dönemini keser. Kalemler 054'teki haftalık kesimle aynıdır: dönem sonundan önce teslim edilen
-- satışlar, ters kayıtlar ve pazaryeri borcu. Kesilecek kalem yoksa false döner.
CREATE OR REPLACE FUNCTION public._settle_seller_period(p_seller uuid, p_start timestamptz, p_end timestamptz, p_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_settle uuid[];
  v_reverse uuid[];
  v_amount integer;
  v_commission integer;
  v_payout public.seller_payouts%ROWTYPE;
  v_start timestamptz;
BEGIN
  SELECT user_id INTO v_user FROM public.sellers WHERE id = p_seller FOR UPDATE;
  -- Dönem başı restoranın kendi son kesiminden gelir: haftalıktan günlüğe geçen restoranın ilk günlük kesimi
  -- birikmiş günleri kapsar, etiketi de öyle görünür.
  v_start := coalesce((SELECT max(p.period_end) FROM public.seller_payouts p
                        WHERE p.seller_id = p_seller AND p.period_end IS NOT NULL AND p.period_end < p_end), p_start);

  SELECT coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NULL), '{}'),
         coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NOT NULL), '{}'),
         coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
         coalesce(sum(CASE WHEN o.marketplace_status IS NOT NULL THEN 0
                           WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END), 0)::integer
    INTO v_settle, v_reverse, v_amount, v_commission
    FROM (
      SELECT * FROM public.orders x
       WHERE x.seller_id = p_seller
         AND public.order_open_amount_cents(x) IS NOT NULL
         AND (x.payout_id IS NOT NULL OR x.marketplace_status IS NOT NULL
              OR coalesce(x.delivered_at, x.updated_at) < p_end)
       FOR UPDATE
    ) o;

  IF coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0) = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.seller_payouts (seller_id, amount_cents, order_count, commission_cents, note, created_by,
    status, kind, period_start, period_end, paid_at)
  VALUES (p_seller, v_amount, coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0),
    v_commission, CASE WHEN p_kind = 'daily' THEN 'Günlük hesap kesimi' ELSE 'Haftalık hesap kesimi' END, NULL,
    CASE WHEN v_amount = 0 THEN 'paid' ELSE 'pending' END, p_kind, v_start, p_end,
    CASE WHEN v_amount = 0 THEN now() END)
  RETURNING * INTO v_payout;

  PERFORM set_config('app.internal', '1', true);
  UPDATE public.orders SET payout_id = v_payout.id WHERE id = ANY (v_settle);
  UPDATE public.orders SET reversal_payout_id = v_payout.id WHERE id = ANY (v_reverse);
  PERFORM set_config('app.internal', '', true);

  IF v_user IS NOT NULL AND v_amount <> 0 THEN
    PERFORM public.notify_user(v_user,
      CASE WHEN p_kind = 'daily' THEN 'Günlük hesap kesimin hazır' ELSE 'Haftalık hesap kesimin hazır' END,
      CASE WHEN v_amount > 0
        THEN '₺' || to_char(v_amount / 100.0, 'FM999999990.00') || ' kayıtlı IBAN''ına gönderilecek. Ayrıntı Kazancım ekranında.'
        ELSE '₺' || to_char(-v_amount / 100.0, 'FM999999990.00') || ' komisyon ödemen var. Ayrıntı Kazancım ekranında.'
      END,
      'payout', jsonb_build_object('payoutId', v_payout.id));
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._settle_seller_period(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;

-- 054 ile aynı dönem kuralı; günlük ödeme seçen restoranlar haftalık kesime girmez.
CREATE OR REPLACE FUNCTION public.generate_weekly_settlements(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb := public.payout_policy();
  v_end timestamptz := public._settlement_period_end(p_now - public._approve_delay(), (v_policy->>'settlement_weekday')::integer);
  v_start timestamptz;
  v_seller uuid;
  v_count integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('weekly_settlement'));
  IF EXISTS (SELECT 1 FROM public.settlement_runs WHERE frequency = 'weekly' AND period_end = v_end) THEN
    RETURN jsonb_build_object('skipped', true, 'period_end', v_end);
  END IF;
  v_start := coalesce((SELECT max(period_end) FROM public.settlement_runs WHERE frequency = 'weekly' AND period_end < v_end),
                      v_end - interval '7 days');

  FOR v_seller IN
    SELECT DISTINCT o.seller_id FROM public.orders o
     WHERE public.order_open_amount_cents(o) IS NOT NULL
       AND NOT public._seller_pays_daily(o.seller_id)
     ORDER BY o.seller_id
  LOOP
    IF public._settle_seller_period(v_seller, v_start, v_end, 'weekly') THEN v_count := v_count + 1; END IF;
  END LOOP;

  INSERT INTO public.settlement_runs (frequency, period_end, period_start, payouts) VALUES ('weekly', v_end, v_start, v_count);
  RETURN jsonb_build_object('skipped', false, 'period_start', v_start, 'period_end', v_end, 'payouts', v_count);
END $$;
REVOKE ALL ON FUNCTION public.generate_weekly_settlements(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_settlements(timestamptz) TO service_role;

-- Günlük kesim: bugün 00:00'a (İstanbul) kadar teslim edilenler, yani dünün tamamı.
CREATE OR REPLACE FUNCTION public.generate_daily_settlements(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_end timestamptz := (date_trunc('day', p_now AT TIME ZONE 'Europe/Istanbul')::timestamp AT TIME ZONE 'Europe/Istanbul');
  v_start timestamptz;
  v_seller uuid;
  v_count integer := 0;
BEGIN
  IF NOT (public.payout_policy()->>'allow_daily')::boolean THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'daily_disabled');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('daily_settlement'));
  IF EXISTS (SELECT 1 FROM public.settlement_runs WHERE frequency = 'daily' AND period_end = v_end) THEN
    RETURN jsonb_build_object('skipped', true, 'period_end', v_end);
  END IF;
  v_start := coalesce((SELECT max(period_end) FROM public.settlement_runs WHERE frequency = 'daily' AND period_end < v_end),
                      v_end - interval '1 day');

  FOR v_seller IN
    SELECT DISTINCT o.seller_id FROM public.orders o
     WHERE public.order_open_amount_cents(o) IS NOT NULL
       AND public._seller_pays_daily(o.seller_id)
     ORDER BY o.seller_id
  LOOP
    IF public._settle_seller_period(v_seller, v_start, v_end, 'daily') THEN v_count := v_count + 1; END IF;
  END LOOP;

  INSERT INTO public.settlement_runs (frequency, period_end, period_start, payouts) VALUES ('daily', v_end, v_start, v_count);
  RETURN jsonb_build_object('skipped', false, 'period_start', v_start, 'period_end', v_end, 'payouts', v_count);
END $$;
REVOKE ALL ON FUNCTION public.generate_daily_settlements(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_settlements(timestamptz) TO service_role;

-- İki kesim birbirinden bağımsızdır: birindeki hata diğerini geri almaz, hata sonuçta döner.
CREATE OR REPLACE FUNCTION public._run_settlements(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_weekly jsonb;
  v_daily jsonb;
BEGIN
  BEGIN
    v_weekly := public.generate_weekly_settlements(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_weekly := jsonb_build_object('skipped', true, 'error', left(SQLERRM, 300));
  END;
  BEGIN
    v_daily := public.generate_daily_settlements(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_daily := jsonb_build_object('skipped', true, 'error', left(SQLERRM, 300));
  END;
  RETURN jsonb_build_object('weekly', v_weekly, 'daily', v_daily);
END $$;
REVOKE ALL ON FUNCTION public._run_settlements(timestamptz) FROM PUBLIC, anon, authenticated;

-- Zamanlanmış görev (054'teki weekly-settlement, her gün 06:00) iki kesimi de çalıştırır.
CREATE OR REPLACE FUNCTION public.run_weekly_settlements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.payout_policy()->>'auto_settlement')::boolean THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'disabled');
  END IF;
  RETURN public._run_settlements(now());
END $$;
REVOKE ALL ON FUNCTION public.run_weekly_settlements() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_run_weekly_settlement()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_weekly jsonb;
  v_daily jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  v_result := public._run_settlements(now());
  v_weekly := v_result->'weekly';
  v_daily := v_result->'daily';
  IF v_weekly ? 'error' AND v_daily ? 'error' THEN
    RAISE EXCEPTION 'Kesim yapılamadı: %', v_weekly->>'error' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'skipped', coalesce((v_weekly->>'skipped')::boolean, true) AND coalesce((v_daily->>'skipped')::boolean, true),
    'payouts', coalesce((v_weekly->>'payouts')::integer, 0) + coalesce((v_daily->>'payouts')::integer, 0),
    'weekly', v_weekly, 'daily', v_daily);
END $$;
REVOKE ALL ON FUNCTION public.admin_run_weekly_settlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_weekly_settlement() TO authenticated;

-- Yönetici bekleyen kesimin günlük mü haftalık mı olduğunu görür.
DROP FUNCTION IF EXISTS public.admin_pending_payouts();
CREATE FUNCTION public.admin_pending_payouts()
RETURNS TABLE (
  id uuid, seller_id uuid, display_name text, iban text, account_name text, amount_cents integer,
  order_count integer, commission_cents integer, period_start timestamptz, period_end timestamptz, created_at timestamptz,
  kind text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT p.id, p.seller_id, s.display_name, a.iban, a.account_name, p.amount_cents, p.order_count,
           p.commission_cents, p.period_start, p.period_end, p.created_at, p.kind
      FROM public.seller_payouts p
      JOIN public.sellers s ON s.id = p.seller_id
      LEFT JOIN public.seller_payout_accounts a ON a.seller_id = p.seller_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at, s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_pending_payouts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_payouts() TO authenticated;

-- Başlangıç: bugün 00:00'a kadarki dönem kesilmiş sayılır; ilk günlük kesim yarın sabah, bugünün teslimleriyle.
INSERT INTO public.settlement_runs (frequency, period_end, period_start, payouts)
SELECT 'daily', e, e - interval '1 day', 0
  FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')::timestamp AT TIME ZONE 'Europe/Istanbul') AS e) x
ON CONFLICT (frequency, period_end) DO NOTHING;

COMMIT;
