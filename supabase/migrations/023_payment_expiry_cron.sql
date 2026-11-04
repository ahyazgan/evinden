-- 023: Ödeme mutabakatı ve süre dolumu (5 dakikada bir)
-- pg_cron ve pg_net Supabase'e özgüdür; Dashboard > Database > Extensions altından açılır.
--
-- internal_settings'e bu dosyadan sonra elle eklenir (docs/CANLIYA-ALMA.md):
--   reconcile_url: payment-reconcile fonksiyonunun adresi
--   cron_secret:   fonksiyondaki CRON_SECRET ile aynı değer
-- app_config herkese açıktır, bu değerler orada duramaz.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.internal_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_payment_reconcile()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url    text := (SELECT value FROM public.internal_settings WHERE key = 'reconcile_url');
  v_secret text := (SELECT value FROM public.internal_settings WHERE key = 'cron_secret');
BEGIN
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public.run_payment_reconcile() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('expire-unpaid-orders', '*/5 * * * *', $$SELECT public.expire_unpaid_orders(20)$$);
SELECT cron.schedule('payment-reconcile', '*/5 * * * *', $$SELECT public.run_payment_reconcile()$$);
