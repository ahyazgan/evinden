-- 058: Destek yazışması geçmişi, restoran başvurusunu reddetme, restorana özel komisyon.
--
-- - 050 öncesi açılan destek taleplerinin mesajı ve yanıtı konuşma geçmişine taşınır: yazışma ekranı
--   eski taleplerde de ilk mesajı gösterir. (Müşteri yanıtı ve sınırları 051'de.)
-- - Yönetici restoran başvurusunu nedenini yazarak reddeder; başvurana bildirim gider, başvuran nedeni
--   profilinde görür ve bilgilerini düzeltip yeniden başvurur. Neden ayrı tabloda durur: sellers satırını
--   herkes okur.
-- - Restoran satışa açılınca başvurana bildirim gider.
-- - Restorana özel komisyon oranı yönetim ekranından yazılır; restorana bildirim gider. Oran yalnızca
--   yeni siparişlere uygulanır (place_order sipariş anında okur).

BEGIN;

-- ── 1. Destek geçmişi ──────────────────────────────────────────────────────

-- İlk mesaj, talep açılışıyla aynı anda yazılır (create_support_ticket aynı işlemde ekler). O anda müşteri
-- mesajı yoksa eski talebin mesajı eklenir; 050'den sonra yanıt almış eski talepler de böylece eksik kalmaz.
INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body, created_at)
SELECT t.id, t.user_id, 'customer', left(t.message, 3000), t.created_at
  FROM public.support_tickets t
 WHERE NOT EXISTS (SELECT 1 FROM public.support_ticket_messages m
                    WHERE m.ticket_id = t.id AND m.author_role = 'customer' AND m.created_at = t.created_at)
   AND char_length(btrim(t.message)) > 0;

INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, body, created_at)
SELECT t.id, NULL, 'admin', left(t.reply, 3000), coalesce(t.replied_at, t.created_at)
  FROM public.support_tickets t
 WHERE t.reply IS NOT NULL AND char_length(btrim(t.reply)) > 0
   AND NOT EXISTS (SELECT 1 FROM public.support_ticket_messages m WHERE m.ticket_id = t.id AND m.author_role = 'admin');

-- ── 2. Restoran başvurusu ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seller_application_reviews (
  seller_id  uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'rejected' CHECK (status IN ('rejected')),
  reason     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_application_reviews ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.seller_application_reviews FROM anon, authenticated;
DROP POLICY IF EXISTS "Başvuru kararını sahibi ve yönetici görür" ON public.seller_application_reviews;
CREATE POLICY "Başvuru kararını sahibi ve yönetici görür" ON public.seller_application_reviews FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_reject_seller(p_seller uuid, p_reason text)
RETURNS public.seller_application_reviews LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row public.seller_application_reviews;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Ret nedeni 5-500 karakter olmalı' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller FOR UPDATE;
  IF NOT FOUND OR v_seller.user_id IS NULL THEN RAISE EXCEPTION 'Başvuru bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_seller.is_active THEN
    RAISE EXCEPTION 'Satıştaki restoranın başvurusu reddedilemez; önce pasif yap' USING ERRCODE = '55000';
  END IF;
  -- Daha önce onaylanmış, sonra pasife alınmış restoran başvuru değildir; ret ona görünmez.
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_seller.user_id AND u.role = 'seller' AND u.is_approved) THEN
    RAISE EXCEPTION 'Onaylanmış restoranın başvurusu reddedilemez' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.seller_application_reviews (seller_id, status, reason, decided_by, decided_at)
  VALUES (p_seller, 'rejected', v_reason, auth.uid(), now())
  ON CONFLICT (seller_id) DO UPDATE SET reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by, decided_at = now()
  RETURNING * INTO v_row;
  PERFORM public.notify_user(v_seller.user_id, 'Restoran başvurun onaylanmadı',
    left(v_reason, 160) || ' Bilgilerini düzeltip yeniden başvurabilirsin.', 'system',
    jsonb_build_object('sellerApplication', 'rejected'));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.admin_reject_seller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_seller(uuid, text) TO authenticated;

-- Başvuran bilgilerini düzelttikten sonra başvurusunu yeniden incelemeye gönderir.
CREATE OR REPLACE FUNCTION public.resubmit_seller_application()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Başvuru bulunamadı' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM public.seller_application_reviews WHERE seller_id = v_seller.id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  PERFORM public.notify_user(u.id, 'Restoran başvurusu yeniden gönderildi', v_seller.display_name, 'system',
    jsonb_build_object('sellerId', v_seller.id))
    FROM public.users u WHERE u.role = 'admin';
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.resubmit_seller_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_seller_application() TO authenticated;

-- Restoran satışa açılınca eski ret kaydı silinir ve başvurana haber verilir.
CREATE OR REPLACE FUNCTION public.sellers_activation_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND NOT OLD.is_active THEN
    DELETE FROM public.seller_application_reviews WHERE seller_id = NEW.id;
    IF NEW.user_id IS NOT NULL THEN
      PERFORM public.notify_user(NEW.user_id, 'Restoranın satışa açıldı',
        NEW.display_name || ' artık müşterilere görünüyor. Menünü kontrol etmeyi unutma.', 'system',
        jsonb_build_object('sellerApplication', 'approved'));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sellers_activation_notify() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sellers_activation_notify_trg ON public.sellers;
CREATE TRIGGER sellers_activation_notify_trg AFTER UPDATE OF is_active ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.sellers_activation_notify();

-- ── 3. Restorana özel komisyon ─────────────────────────────────────────────

-- p_rate NULL ise özel oran kaldırılır, tür oranı (app_config.order_pricing) geçerli olur.
CREATE OR REPLACE FUNCTION public.admin_set_seller_commission(p_seller uuid, p_rate numeric, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller public.sellers;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_seller FROM public.sellers WHERE id = p_seller;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restoran bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Not en fazla 200 karakter olabilir' USING ERRCODE = '22023';
  END IF;
  IF p_rate IS NULL THEN
    DELETE FROM public.seller_commission_rates WHERE seller_id = p_seller;
    IF FOUND AND v_seller.user_id IS NOT NULL THEN
      PERFORM public.notify_user(v_seller.user_id, 'Komisyon oranın güncellendi',
        'Özel oranın kaldırıldı; yeni siparişlerde genel oran uygulanır.', 'payout', '{}'::jsonb);
    END IF;
    RETURN jsonb_build_object('seller_id', p_seller, 'rate_percent', NULL);
  END IF;
  IF p_rate < 0 OR p_rate > 50 OR p_rate <> round(p_rate, 2) THEN
    RAISE EXCEPTION 'Oran 0 ile 50 arasında, en fazla iki ondalıklı olmalı' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.seller_commission_rates (seller_id, rate_percent, note, updated_at)
  VALUES (p_seller, p_rate, v_note, now())
  ON CONFLICT (seller_id) DO UPDATE SET rate_percent = EXCLUDED.rate_percent, note = EXCLUDED.note, updated_at = now();
  IF v_seller.user_id IS NOT NULL THEN
    PERFORM public.notify_user(v_seller.user_id, 'Komisyon oranın güncellendi',
      'Yeni siparişlerde komisyon oranın %' || replace(trim_scale(p_rate)::text, '.', ',') || '.', 'payout', '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('seller_id', p_seller, 'rate_percent', p_rate, 'note', v_note);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_seller_commission(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_seller_commission(uuid, numeric, text) TO authenticated;

COMMIT;
