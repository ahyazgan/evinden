-- 029: Cevapsız siparişler için zamanlanmış görev (2 dakikada bir)
-- pg_cron Supabase'e özgüdür, bu yüzden 028'den ayrı duruyor; testlerde çalıştırılmaz.

SELECT cron.schedule('expire-pending-orders', '*/2 * * * *', $$SELECT public.expire_pending_orders(10, 30)$$);
