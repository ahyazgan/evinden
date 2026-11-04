-- 021: Davet ödülü
--
-- Davet edilen kod girince ₺15 kupon alır. Davet eden, karşı tarafın ilk teslim edilen siparişinden
-- sonra ₺15 kupon kazanır. Her iki kupon da kişiye özel, tek kullanımlık ve en az ₺50 siparişte geçerlidir.
-- Tablo eskiden istemciden yazılabiliyordu; artık yalnızca bu fonksiyonlar yazar.

BEGIN;

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_code_key;
DROP POLICY IF EXISTS "Kullanıcı referans oluşturabilir" ON public.referrals;
DROP POLICY IF EXISTS "Referans güncellenebilir" ON public.referrals;
REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_unique ON public.referrals (referred_id) WHERE referred_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_referral_code_unique ON public.loyalty (referral_code) WHERE referral_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_referral_coupon(p_user uuid, p_title text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text := public.issue_personal_coupon(p_user, 'fixed', 1500, p_title);
BEGIN
  UPDATE public.coupons SET min_order_cents = 5000 WHERE code = v_code;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.issue_referral_coupon(uuid, text) FROM PUBLIC, anon, authenticated;

-- Kullanıcının davet kodu; yoksa üretir.
CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.loyalty (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT referral_code INTO v_code FROM public.loyalty WHERE user_id = v_uid FOR UPDATE;
  WHILE v_code IS NULL LOOP
    v_code := 'EV' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    BEGIN
      UPDATE public.loyalty SET referral_code = v_code, updated_at = now() WHERE user_id = v_uid;
    EXCEPTION WHEN unique_violation THEN
      v_code := NULL;
    END;
  END LOOP;
  RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.get_my_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated;

-- Davet kodunu uygular, kupon kodunu döndürür. Yalnızca hiç sipariş vermemiş kullanıcı, bir kez.
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Giriş yapmalısınız' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_referrer FROM public.loyalty WHERE referral_code = v_code;
  IF v_referrer IS NULL THEN
    RAISE EXCEPTION 'Davet kodu geçersiz' USING ERRCODE = '55000';
  END IF;
  IF v_referrer = v_uid THEN
    RAISE EXCEPTION 'Kendi davet kodunuzu kullanamazsınız' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_uid) THEN
    RAISE EXCEPTION 'Daha önce bir davet kodu kullandınız' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE customer_id = v_uid AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'Davet kodu yalnızca ilk siparişten önce kullanılabilir' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.referrals WHERE referrer_id = v_referrer) >= 100 THEN
    RAISE EXCEPTION 'Bu davet kodunun kullanım sınırı doldu' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, code) VALUES (v_referrer, v_uid, v_code);
  RETURN public.issue_referral_coupon(v_uid, 'Davet İndirimi');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Daha önce bir davet kodu kullandınız' USING ERRCODE = '55000';
END $$;
REVOKE ALL ON FUNCTION public.apply_referral_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text) TO authenticated;

-- Davet edilenin ara toplamı ₺50 ve üzeri ilk teslim edilen siparişi davet edene ödül kazandırır.
-- Kuponla aynı ölçü: ara toplam alınır ki ₺15 indirim ödülü engellemesin.
CREATE OR REPLACE FUNCTION public.orders_complete_referral()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer uuid;
  v_code     text;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.customer_id IS NULL OR NEW.subtotal_cents < 5000 THEN
    RETURN NEW;
  END IF;

  UPDATE public.referrals SET status = 'completed'
   WHERE referred_id = NEW.customer_id AND status = 'pending'
   RETURNING referrer_id INTO v_referrer;
  IF v_referrer IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.loyalty (user_id) VALUES (v_referrer) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.loyalty
     SET referral_count = referral_count + 1, referral_earnings = referral_earnings + 1500, updated_at = now()
   WHERE user_id = v_referrer;

  v_code := public.issue_referral_coupon(v_referrer, 'Davet Ödülü');
  PERFORM public.notify_user(v_referrer, 'Davet ödülünüz hazır 🎉',
    'Arkadaşınız ilk siparişini aldı. Kupon kodunuz: ' || v_code, 'promo', jsonb_build_object('couponCode', v_code));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_complete_referral_trg ON public.orders;
CREATE TRIGGER orders_complete_referral_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_complete_referral();

COMMIT;
