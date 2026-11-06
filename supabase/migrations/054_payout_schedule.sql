-- 054: Restoran ödeme takvimi.
--
-- 1. Online ödemede (iyzico pazaryeri) onay teslimden hemen sonra değil, bekletme süresi (varsayılan 24 saat)
--    dolunca verilir. İade talepleri bu pencerede yakalanır; para restorana geçmeden iade edilebilir.
-- 2. Hesap kesimi her hafta kendiliğinden yapılır (varsayılan pazartesi 06:00, İstanbul). Kesim "ödeme bekliyor"
--    olarak açılır; yönetici havaleyi yapıp (veya restorandan komisyonu alıp) "ödendi" işaretler.
--    Bekletme süresi dolmamış siparişler sonraki haftaya kalır. Yöneticinin elle kesimi (admin_settle_seller) aynen durur.

BEGIN;

-- ── 1. Ödeme ayarı ──────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value)
VALUES ('payout_policy', '{"approve_delay_hours":24,"settlement_weekday":1,"auto_settlement":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Bozuk veya eksik değerde güvenli varsayılan döner.
CREATE OR REPLACE FUNCTION public.payout_policy()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT coalesce((SELECT value FROM public.app_config WHERE key = 'payout_policy'), '{}'::jsonb) AS j)
  SELECT jsonb_build_object(
    'approve_delay_hours', CASE WHEN j->>'approve_delay_hours' ~ '^[0-9]{1,3}$'
                                THEN least(168, (j->>'approve_delay_hours')::integer) ELSE 24 END,
    'settlement_weekday', CASE WHEN j->>'settlement_weekday' ~ '^[1-7]$' THEN (j->>'settlement_weekday')::integer ELSE 1 END,
    'auto_settlement', CASE WHEN jsonb_typeof(j->'auto_settlement') = 'boolean' THEN (j->>'auto_settlement')::boolean ELSE true END
  ) FROM v;
$$;
REVOKE ALL ON FUNCTION public.payout_policy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payout_policy() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._approve_delay() RETURNS interval
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT make_interval(hours => (public.payout_policy()->>'approve_delay_hours')::integer);
$$;
REVOKE ALL ON FUNCTION public._approve_delay() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_payout_policy(p_policy jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_policy IS NULL OR jsonb_typeof(p_policy) <> 'object' THEN RAISE EXCEPTION 'Geçersiz ayar' USING ERRCODE = '22023'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_policy) LOOP
    IF v_key NOT IN ('approve_delay_hours','settlement_weekday','auto_settlement') THEN
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
  v_value := public.payout_policy() || p_policy;
  INSERT INTO public.app_config (key, value) VALUES ('payout_policy', v_value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  RETURN public.payout_policy();
END $$;
REVOKE ALL ON FUNCTION public.admin_update_payout_policy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_payout_policy(jsonb) TO authenticated;

-- ── 2. iyzico onayı bekletme süresinden sonra ──────────────────────────────

-- 036 ile aynı; ek koşul: teslimden bu yana bekletme süresi geçmiş olmalı.
CREATE OR REPLACE FUNCTION public.claim_payment_approvals(p_limit integer)
RETURNS TABLE (order_id uuid, attempts integer, transactions jsonb, submerchant_key text, submerchant_price_cents integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH picked AS (
    SELECT a.order_id
      FROM public.payment_approvals a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.status = 'pending'
       AND a.next_attempt_at <= now()
       AND (a.locked_until IS NULL OR a.locked_until < now())
       AND o.status = 'delivered'
       AND o.payment_status = 'paid'
       AND o.marketplace_status = 'held'
       AND coalesce(o.refund_status, 'none') NOT IN ('requested', 'approved')
       AND coalesce(o.delivered_at, o.updated_at) <= now() - public._approve_delay()
     ORDER BY a.next_attempt_at
     LIMIT p_limit
     FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE public.payment_approvals a
       SET attempts = a.attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
      FROM picked
     WHERE a.order_id = picked.order_id
    RETURNING a.order_id, a.attempts
  )
  SELECT c.order_id, c.attempts, p.transactions, p.submerchant_key, p.submerchant_price_cents
    FROM claimed c
    JOIN public.order_payments p ON p.order_id = c.order_id;
$$;
REVOKE ALL ON FUNCTION public.claim_payment_approvals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_approvals(integer) TO service_role;

-- Bekletmedeki sipariş için Edge Function her 5 dakikada boşuna çağrılmaz.
CREATE OR REPLACE FUNCTION public.run_payment_approve()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url    text := (SELECT value FROM public.internal_settings WHERE key = 'approve_url');
  v_secret text := (SELECT value FROM public.internal_settings WHERE key = 'cron_secret');
BEGIN
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_approvals a JOIN public.orders o ON o.id = a.order_id
     WHERE a.status = 'pending' AND a.next_attempt_at <= now()
       AND coalesce(o.delivered_at, o.updated_at) <= now() - public._approve_delay()
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public.run_payment_approve() FROM PUBLIC, anon, authenticated;

-- Yönetici ekranı onayın ne zaman gideceğini görür.
DROP FUNCTION IF EXISTS public.admin_payment_approval_queue();
CREATE FUNCTION public.admin_payment_approval_queue()
RETURNS TABLE (
  order_id uuid, display_name text, amount_cents integer, status text, attempts integer,
  last_error text, next_attempt_at timestamptz, refund_status text, due_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.order_id, s.display_name, p.submerchant_price_cents, a.status, a.attempts,
         a.last_error, a.next_attempt_at, o.refund_status,
         greatest(a.next_attempt_at, coalesce(o.delivered_at, o.updated_at) + public._approve_delay())
    FROM public.payment_approvals a
    JOIN public.orders o ON o.id = a.order_id
    JOIN public.sellers s ON s.id = o.seller_id
    JOIN public.order_payments p ON p.order_id = a.order_id
   WHERE a.status IN ('pending', 'failed')
   ORDER BY a.status, a.created_at;
END $$;
REVOKE ALL ON FUNCTION public.admin_payment_approval_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_approval_queue() TO authenticated;

-- ── 3. Haftalık hesap kesimi ────────────────────────────────────────────────

ALTER TABLE public.seller_payouts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS period_start timestamptz,
  ADD COLUMN IF NOT EXISTS period_end timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_reference text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_payouts_status_check') THEN
    ALTER TABLE public.seller_payouts ADD CONSTRAINT seller_payouts_status_check CHECK (status IN ('pending','paid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_payouts_kind_check') THEN
    ALTER TABLE public.seller_payouts ADD CONSTRAINT seller_payouts_kind_check CHECK (kind IN ('manual','weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_payouts_reference_check') THEN
    ALTER TABLE public.seller_payouts ADD CONSTRAINT seller_payouts_reference_check
      CHECK (paid_reference IS NULL OR length(paid_reference) <= 200);
  END IF;
END $$;
-- Önceki kesimler havale yapıldıktan sonra kaydediliyordu: ödenmiş sayılır.
UPDATE public.seller_payouts SET paid_at = created_at WHERE status = 'paid' AND paid_at IS NULL;
CREATE INDEX IF NOT EXISTS seller_payouts_pending_idx ON public.seller_payouts (created_at) WHERE status = 'pending';

-- Her kesim dönemi bir kez çalışır.
CREATE TABLE IF NOT EXISTS public.settlement_runs (
  period_end   timestamptz PRIMARY KEY,
  period_start timestamptz NOT NULL,
  payouts      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settlement_runs FROM anon, authenticated;

-- Dönem sonu: kesim gününün (İstanbul) en son 00:00'ı.
CREATE OR REPLACE FUNCTION public._settlement_period_end(p_now timestamptz, p_weekday integer)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((d - ((extract(isodow FROM d)::integer - p_weekday + 7) % 7) * interval '1 day')::timestamp
          AT TIME ZONE 'Europe/Istanbul')
    FROM (SELECT date_trunc('day', p_now AT TIME ZONE 'Europe/Istanbul') AS d) x;
$$;
REVOKE ALL ON FUNCTION public._settlement_period_end(timestamptz, integer) FROM PUBLIC, anon, authenticated;

-- Dönemin kesimlerini oluşturur. Satıcıya ait kesilecek kalemler admin_settle_seller ile aynıdır; tek fark:
-- yeni satışlar yalnızca dönem sonundan önce teslim edildiyse girer. Ters kayıtlar ve pazaryeri borcu beklemeden girer.
-- Dönem, sonundan itibaren bekletme süresi geçince kesilir: pazartesi 00:00'da biten hafta, 24 saat bekletmeyle
-- salı 06:00'daki çalışmada kesilir; pazar akşamı teslim edilen sipariş de aynı haftaya girer.
CREATE OR REPLACE FUNCTION public.generate_weekly_settlements(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb := public.payout_policy();
  v_end timestamptz := public._settlement_period_end(p_now - public._approve_delay(), (v_policy->>'settlement_weekday')::integer);
  v_start timestamptz;
  v_cutoff timestamptz;
  v_seller record;
  v_settle uuid[];
  v_reverse uuid[];
  v_amount integer;
  v_commission integer;
  v_payout public.seller_payouts%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.settlement_runs WHERE period_end = v_end) THEN
    RETURN jsonb_build_object('skipped', true, 'period_end', v_end);
  END IF;
  -- Aynı dönem için eşzamanlı iki çalışma birbirini beklesin; ikincisi yukarıdaki kontrolü yeniden yapar.
  PERFORM pg_advisory_xact_lock(hashtext('weekly_settlement'));
  IF EXISTS (SELECT 1 FROM public.settlement_runs WHERE period_end = v_end) THEN
    RETURN jsonb_build_object('skipped', true, 'period_end', v_end);
  END IF;
  v_start := coalesce((SELECT max(period_end) FROM public.settlement_runs WHERE period_end < v_end), v_end - interval '7 days');
  v_cutoff := v_end;

  FOR v_seller IN
    SELECT DISTINCT s.id, s.user_id
      FROM public.sellers s JOIN public.orders o ON o.seller_id = s.id
     WHERE public.order_open_amount_cents(o) IS NOT NULL
     ORDER BY s.id
  LOOP
    PERFORM 1 FROM public.sellers WHERE id = v_seller.id FOR UPDATE;

    SELECT coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NULL), '{}'),
           coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NOT NULL), '{}'),
           coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
           coalesce(sum(CASE WHEN o.marketplace_status IS NOT NULL THEN 0
                             WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END), 0)::integer
      INTO v_settle, v_reverse, v_amount, v_commission
      FROM (
        SELECT * FROM public.orders x
         WHERE x.seller_id = v_seller.id
           AND public.order_open_amount_cents(x) IS NOT NULL
           AND (x.payout_id IS NOT NULL OR x.marketplace_status IS NOT NULL
                OR coalesce(x.delivered_at, x.updated_at) < v_cutoff)
         FOR UPDATE
      ) o;

    CONTINUE WHEN coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0) = 0;

    INSERT INTO public.seller_payouts (seller_id, amount_cents, order_count, commission_cents, note, created_by,
      status, kind, period_start, period_end, paid_at)
    VALUES (v_seller.id, v_amount, coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0),
      v_commission, 'Haftalık hesap kesimi', NULL,
      CASE WHEN v_amount = 0 THEN 'paid' ELSE 'pending' END, 'weekly', v_start, v_end,
      CASE WHEN v_amount = 0 THEN now() END)
    RETURNING * INTO v_payout;

    PERFORM set_config('app.internal', '1', true);
    UPDATE public.orders SET payout_id = v_payout.id WHERE id = ANY (v_settle);
    UPDATE public.orders SET reversal_payout_id = v_payout.id WHERE id = ANY (v_reverse);
    PERFORM set_config('app.internal', '', true);

    IF v_seller.user_id IS NOT NULL AND v_amount <> 0 THEN
      PERFORM public.notify_user(v_seller.user_id, 'Haftalık hesap kesimin hazır',
        CASE WHEN v_amount > 0
          THEN '₺' || to_char(v_amount / 100.0, 'FM999999990.00') || ' kayıtlı IBAN''ına gönderilecek. Ayrıntı Kazancım ekranında.'
          ELSE '₺' || to_char(-v_amount / 100.0, 'FM999999990.00') || ' komisyon ödemen var. Ayrıntı Kazancım ekranında.'
        END,
        'payout', jsonb_build_object('payoutId', v_payout.id));
    END IF;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.settlement_runs (period_end, period_start, payouts) VALUES (v_end, v_start, v_count);
  RETURN jsonb_build_object('skipped', false, 'period_start', v_start, 'period_end', v_end, 'payouts', v_count);
END $$;
REVOKE ALL ON FUNCTION public.generate_weekly_settlements(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_weekly_settlements(timestamptz) TO service_role;

-- Zamanlanmış görev her gün çalışır; kesim günü geçmişse ve o dönem henüz kesilmediyse keser.
CREATE OR REPLACE FUNCTION public.run_weekly_settlements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.payout_policy()->>'auto_settlement')::boolean THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'disabled');
  END IF;
  RETURN public.generate_weekly_settlements(now());
END $$;
REVOKE ALL ON FUNCTION public.run_weekly_settlements() FROM PUBLIC, anon, authenticated;

-- Görev kaçtıysa yönetici son dönemi elle başlatır.
CREATE OR REPLACE FUNCTION public.admin_run_weekly_settlement()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN public.generate_weekly_settlements(now());
END $$;
REVOKE ALL ON FUNCTION public.admin_run_weekly_settlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_weekly_settlement() TO authenticated;

-- Kesim yapıldı, havale bekliyor; bu arada içindeki bir siparişin iadesi onaylandı. Sipariş kesimden çıkar ve tutar
-- düşer: restorana iade edilen siparişin parası gönderilmez, sonraki haftaya borç da yazılmaz.
-- Tetikleyiciler ada göre çalışır: bu, orders_settlement_trg (hesap alanı koruması) ve orders_zz_flag_refund_trg
-- (onaylanan online iadeyi refund_pending yapar) sonrasında çalışır ve siparişin son hâline bakar.
CREATE OR REPLACE FUNCTION public.orders_release_from_pending_payout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.payout_id IS NOT NULL AND NEW.payout_id IS NOT DISTINCT FROM OLD.payout_id
     AND NEW.reversal_payout_id IS NULL AND NEW.marketplace_status IS NULL
     AND public.order_counts_as_sale(OLD) AND NOT public.order_counts_as_sale(NEW) THEN
    UPDATE public.seller_payouts
       SET amount_cents = amount_cents - public.order_balance_cents(OLD),
           commission_cents = commission_cents - OLD.commission_cents,
           order_count = order_count - 1
     WHERE id = OLD.payout_id AND status = 'pending';
    IF FOUND THEN
      NEW.payout_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_release_from_pending_payout() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_zz_release_pending_payout_trg ON public.orders;
CREATE TRIGGER orders_zz_release_pending_payout_trg BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_release_from_pending_payout();

-- Elle kesim (admin_settle_seller) havale yapıldıktan sonra kaydedilir: ödeme zamanı kayıt zamanıdır.
CREATE OR REPLACE FUNCTION public.seller_payouts_paid_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := coalesce(NEW.created_at, now());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seller_payouts_paid_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS seller_payouts_paid_at_trg ON public.seller_payouts;
CREATE TRIGGER seller_payouts_paid_at_trg BEFORE INSERT OR UPDATE ON public.seller_payouts
  FOR EACH ROW EXECUTE FUNCTION public.seller_payouts_paid_at();

-- Havale yapıldı (veya restorandan komisyon alındı). Yönetici ekranda gördüğü tutarı gönderir; o arada iade
-- yüzünden tutar değiştiyse (EVN04) işaretlenmez, ekran yenilenir.
DROP FUNCTION IF EXISTS public.admin_mark_payout_paid(uuid, text);
CREATE FUNCTION public.admin_mark_payout_paid(p_payout uuid, p_expected_cents integer, p_reference text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.seller_payouts;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.seller_payouts WHERE id = p_payout AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ödeme bekleyen kesim bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_row.amount_cents IS DISTINCT FROM p_expected_cents THEN
    RAISE EXCEPTION 'Kesim tutarı değişti, listeyi yenile' USING ERRCODE = 'EVN04', DETAIL = v_row.amount_cents::text;
  END IF;
  UPDATE public.seller_payouts
     SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
         paid_reference = nullif(left(btrim(coalesce(p_reference, '')), 200), '')
   WHERE id = p_payout
  RETURNING * INTO v_row;
  PERFORM public.notify_user(s.user_id,
    CASE WHEN v_row.amount_cents > 0 THEN 'Ödemen gönderildi' ELSE 'Komisyon ödemen alındı' END,
    '₺' || to_char(abs(v_row.amount_cents) / 100.0, 'FM999999990.00')
      || CASE WHEN v_row.amount_cents > 0 THEN ' hesabına gönderildi.' ELSE ' komisyon ödemen kaydedildi.' END,
    'payout', jsonb_build_object('payoutId', v_row.id))
    FROM public.sellers s WHERE s.id = v_row.seller_id AND s.user_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.admin_mark_payout_paid(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_payout_paid(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_pending_payouts()
RETURNS TABLE (
  id uuid, seller_id uuid, display_name text, iban text, account_name text, amount_cents integer,
  order_count integer, commission_cents integer, period_start timestamptz, period_end timestamptz, created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT p.id, p.seller_id, s.display_name, a.iban, a.account_name, p.amount_cents, p.order_count,
           p.commission_cents, p.period_start, p.period_end, p.created_at
      FROM public.seller_payouts p
      JOIN public.sellers s ON s.id = p.seller_id
      LEFT JOIN public.seller_payout_accounts a ON a.seller_id = p.seller_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at, s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_pending_payouts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pending_payouts() TO authenticated;

-- 033 ile aynı (satışa bahşiş girmez); ek olarak kesilip henüz ödenmemiş tutarlar da ödenecek / alınacak sayılır.
CREATE OR REPLACE FUNCTION public.admin_platform_totals()
RETURNS TABLE (delivered_count bigint, sales_cents bigint, commission_cents bigint, payable_cents bigint, receivable_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sales AS (
    SELECT count(*) AS n, coalesce(sum(o.total_cents - o.tip_cents), 0) AS total, coalesce(sum(o.commission_cents), 0) AS commission
      FROM public.orders o WHERE public.order_counts_as_sale(o)
  ), balances AS (
    SELECT (public.seller_open_totals(s.id)).balance_cents AS b FROM public.sellers s
    UNION ALL
    SELECT p.amount_cents FROM public.seller_payouts p WHERE p.status = 'pending'
  )
  SELECT sales.n, sales.total::bigint, sales.commission::bigint,
         coalesce((SELECT sum(b) FROM balances WHERE b > 0), 0)::bigint,
         coalesce((SELECT -sum(b) FROM balances WHERE b < 0), 0)::bigint
    FROM sales;
END $$;
REVOKE ALL ON FUNCTION public.admin_platform_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_totals() TO authenticated;

-- ── 4. Hesap silme: ödenmemiş kesim varken silinemez ───────────────────────
-- 036 ile aynı; tek ek koşul ödeme bekleyen haftalık kesim.

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

  IF v_seller IS NOT NULL AND (
    (public.seller_open_totals(v_seller)).order_count > 0
    OR EXISTS (SELECT 1 FROM public.orders o
                WHERE o.seller_id = v_seller AND o.status = 'delivered' AND o.refund_status = 'requested')
    OR EXISTS (SELECT 1 FROM public.payment_approvals a JOIN public.orders o ON o.id = a.order_id
                WHERE o.seller_id = v_seller AND a.status IN ('pending', 'failed'))
    OR EXISTS (SELECT 1 FROM public.seller_payouts p WHERE p.seller_id = v_seller AND p.status = 'pending')
  ) THEN
    RAISE EXCEPTION 'Bekleyen hesap kesiminiz var. Kesim tamamlandıktan sonra hesabınızı silebilirsiniz; destek ekibimize yazın.'
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

-- ── 5. Zamanlanmış görev: her gün 06:00 (İstanbul) ─────────────────────────

-- Başlangıç: yükleme anına kadar kapanmış dönem kesilmiş sayılır. İlk otomatik kesim bir sonraki dönem sonunda
-- yapılır (o zamana kadarki tüm açık bakiyeyi kapsar); yükleme günü herkese birden kesim açılmaz.
INSERT INTO public.settlement_runs (period_end, period_start, payouts)
SELECT e, e - interval '7 days', 0
  FROM (SELECT public._settlement_period_end(now() - public._approve_delay(),
                 (public.payout_policy()->>'settlement_weekday')::integer) AS e) x
ON CONFLICT (period_end) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('weekly-settlement', '0 3 * * *', 'SELECT public.run_weekly_settlements()');
  END IF;
END $$;

COMMIT;
