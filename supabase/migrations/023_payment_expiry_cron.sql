-- 023: Ödemesi tamamlanmayan siparişleri 5 dakikada bir temizle
-- pg_cron Supabase'e özgüdür; Dashboard > Database > Extensions altından açılabilir.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('expire-unpaid-orders', '*/5 * * * *', $$SELECT public.expire_unpaid_orders(20)$$);
