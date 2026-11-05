-- 039: Marka adı Afiyetli oldu.
-- Eski dosyalar geçmiş kaydıdır, değiştirilmez: veritabanında kalan iki yer burada güncellenir.

-- Kupon kodunda I harfi yok: Türkçe klavyede büyük harf İ olur ve kod eşleşmez.
UPDATE public.coupons SET code = 'LEZZET20' WHERE code = 'EVINDEN20';

CREATE OR REPLACE FUNCTION public._assert_not_suspended()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_suspended) THEN
    RAISE EXCEPTION 'Hesabın askıya alındı. Destek için destek@afiyetli.app' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_not_suspended() FROM PUBLIC, anon, authenticated;
