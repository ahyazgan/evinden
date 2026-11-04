-- 036: iyzico pazaryeri (otomatik satıcı ödemesi), anahtarı KAPALI olarak gelir.
--
-- Kapalıyken hiçbir akış değişmez: tüm online siparişler bugünkü gibi tek hesaba düşer, satıcıya havale
-- yönetici tarafından yapılır (024). Bu akış iyzico'ya karşı HİÇ çalıştırılmadı, bkz. docs/CANLIYA-ALMA.md.
--
-- Akış: alt üye kaydı (submerchant-sync) -> ödemede sepet kırılımına subMerchantKey ve subMerchantPrice ->
-- teslimde onay kuyruğu (payment-approve) -> iyzico parayı satıcının IBAN'ına gönderir.
--
-- Hesap kesimi: pazaryerinden geçen siparişi iyzico öder, elle hesap kesimine asla girmez (order_open_amount_cents).
-- Kapıda ödenen siparişlerin komisyon borcu eskisi gibi hesap kesiminde izlenir.
--
-- Stopaj: iyzico'nun "Pazaryerlerinde Stopaj Uygulaması" sayfasına göre stopajı hesaplayıp alt üyenin
-- hakedişinden düşmek pazaryerinin sorumluluğundadır. Burada vergi hesabı YOKTUR: subMerchantPrice stopajsız
-- gönderilir. Açmadan önce mali müşavirle netleştirilmeli (docs/CANLIYA-ALMA.md).
--
-- Ayrıca: telefon doğrulama hatasının kodu EVN05 oldu, track_events oturum başına sınırlandı.

BEGIN;

-- ── 1. Anahtar ─────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value) VALUES ('iyzico_marketplace', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Herkese açık okunmaz; uygulama yalnızca açık mı kapalı mı olduğunu marketplace_enabled ile öğrenir.
DROP POLICY IF EXISTS "Herkes app config okuyabilir" ON public.app_config;
CREATE POLICY "Herkes app config okuyabilir"
  ON public.app_config FOR SELECT USING (key NOT IN ('fraud_rules', 'iyzico_marketplace') OR public.is_admin());

CREATE OR REPLACE FUNCTION public.marketplace_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value->>'enabled')::boolean FROM public.app_config WHERE key = 'iyzico_marketplace'), FALSE);
$$;
REVOKE ALL ON FUNCTION public.marketplace_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_enabled() TO authenticated, service_role;

-- ── 2. Alt üye kaydı ───────────────────────────────────────────────────────

-- sellers herkese açıktır; kimlik ve vergi bilgileri bu yüzden ayrı tabloda durur. IBAN seller_payout_accounts'tadır.
-- Yönetici politikası bilerek yok: panel yalnızca unvanı ve durumu admin_marketplace_sellers ile görür,
-- T.C. kimlik ve vergi numarasını satıcıdan başka yalnızca submerchant-sync (service role) okur.
CREATE TABLE IF NOT EXISTS public.seller_company_info (
  seller_id           uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  -- iyzico'daki subMerchantType. Restoranlar şirkettir, bireysel (PERSONAL) yoktur.
  company_type        text NOT NULL CHECK (company_type IN ('PRIVATE_COMPANY', 'LIMITED_OR_JOINT_STOCK_COMPANY')),
  legal_company_title text NOT NULL CHECK (length(btrim(legal_company_title)) BETWEEN 3 AND 255),
  tax_office          text NOT NULL CHECK (length(btrim(tax_office)) BETWEEN 3 AND 255),
  tax_number          text CHECK (tax_number ~ '^[0-9]{10,11}$'),
  -- Belgede oluşturmada isteğe bağlı görünür ama güncellemede zorunludur; yoksa onay 5024 hatası verir.
  identity_number     text NOT NULL CHECK (identity_number ~ '^[1-9][0-9]{10}$'),
  email               text NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  gsm_number          text NOT NULL CHECK (gsm_number ~ '^\+90[0-9]{10}$'),
  address             text NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 255),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_company_info_tax_number_required
    CHECK (company_type = 'PRIVATE_COMPANY' OR tax_number IS NOT NULL)
);
ALTER TABLE public.seller_company_info ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_company_info FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.seller_company_info TO authenticated;

DROP POLICY IF EXISTS "Satıcı şirket bilgisini görür" ON public.seller_company_info;
CREATE POLICY "Satıcı şirket bilgisini görür" ON public.seller_company_info FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS "Satıcı şirket bilgisini ekler" ON public.seller_company_info;
CREATE POLICY "Satıcı şirket bilgisini ekler" ON public.seller_company_info FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS "Satıcı şirket bilgisini günceller" ON public.seller_company_info;
CREATE POLICY "Satıcı şirket bilgisini günceller" ON public.seller_company_info FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

-- Satıcı anahtarı görür ve yönetici durumu izler; yazmak yalnızca service role ile (submerchant-sync).
CREATE TABLE IF NOT EXISTS public.seller_submerchants (
  seller_id       uuid PRIMARY KEY REFERENCES public.sellers(id) ON DELETE CASCADE,
  submerchant_key text UNIQUE,
  -- active: anahtar var, ödemede kullanılır. error: kayıt olmadı, anahtar yok.
  status          text NOT NULL CHECK (status IN ('active', 'error')),
  last_error      text,
  synced_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_submerchants_active_has_key CHECK (status <> 'active' OR submerchant_key IS NOT NULL)
);
ALTER TABLE public.seller_submerchants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_submerchants FROM anon, authenticated;
GRANT SELECT ON public.seller_submerchants TO authenticated;
DROP POLICY IF EXISTS "Satıcı ve yönetici alt üye kaydını görür" ON public.seller_submerchants;
CREATE POLICY "Satıcı ve yönetici alt üye kaydını görür" ON public.seller_submerchants FOR SELECT
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid()));

-- iyzico alt üye tipi kayıttan sonra değiştirilemez (belge); kayıt tarihi de istemciden gelmez.
CREATE OR REPLACE FUNCTION public.seller_company_info_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
      RAISE EXCEPTION 'Satıcı değiştirilemez' USING ERRCODE = '42501';
    END IF;
    IF NEW.company_type IS DISTINCT FROM OLD.company_type AND EXISTS (
      SELECT 1 FROM public.seller_submerchants m WHERE m.seller_id = NEW.seller_id AND m.submerchant_key IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'iyzico kaydından sonra şirket türü değiştirilemez' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seller_company_info_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS seller_company_info_guard_trg ON public.seller_company_info;
CREATE TRIGGER seller_company_info_guard_trg
  BEFORE INSERT OR UPDATE ON public.seller_company_info
  FOR EACH ROW EXECUTE FUNCTION public.seller_company_info_guard();

-- ── 3. Hangi akış kullanıldı ───────────────────────────────────────────────

-- Ödeme başlatılırken verilen karar. İşlem numaraları (paymentTransactionId) mevcut transactions alanında,
-- iyzico sorgusunun döndürdüğü kırılımlarla birlikte durur.
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS marketplace boolean NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS submerchant_key text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS submerchant_price_cents integer;
-- Anahtar açıkken sipariş neden pazaryerine girmedi: elle hesap kesimine kalan siparişin açıklaması.
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS fallback_reason text;

-- orders üzerinde de durur: hesap fonksiyonları sipariş satırıyla çalışır (IMMUTABLE, tablo okumaz).
-- NULL: elle hesap kesimi. held: para iyzico'da bekliyor. approved: onay verildi. reversed: onay geri çekildi.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS marketplace_status text;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_marketplace_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_marketplace_status_check
  CHECK (marketplace_status IN ('held', 'approved', 'reversed'));

-- 024 ile aynı, marketplace_status de hesap kesimi alanı sayılır: kimse istemciden değiştiremez.
CREATE OR REPLACE FUNCTION public.orders_settlement_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Yönetici de bu alanları elle değiştiremez: hesap kesimi yalnızca admin_settle_seller ile yazılır.
  IF auth.uid() IS NOT NULL AND NOT public._internal_call() THEN
    IF NEW.seller_discount_cents IS DISTINCT FROM OLD.seller_discount_cents
       OR NEW.platform_delivery_cents IS DISTINCT FROM OLD.platform_delivery_cents
       OR NEW.payout_id IS DISTINCT FROM OLD.payout_id
       OR NEW.reversal_payout_id IS DISTINCT FROM OLD.reversal_payout_id
       OR NEW.marketplace_status IS DISTINCT FROM OLD.marketplace_status THEN
      RAISE EXCEPTION 'Hesap kesimi alanları değiştirilemez' USING ERRCODE = '42501';
    END IF;
    NEW.delivered_at := OLD.delivered_at;
  END IF;
  -- Ters kaydı işlenmiş sipariş yeniden satışa dönemez: hiçbir kesime girmeden kazançta görünürdü.
  IF OLD.reversal_payout_id IS NOT NULL AND public.order_counts_as_sale(NEW) THEN
    RAISE EXCEPTION 'Hesap kesiminde iade edilmiş sipariş yeniden açılamaz' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    NEW.delivered_at := coalesce(NEW.delivered_at, now());
  END IF;
  RETURN NEW;
END $$;

-- Her başlatmada akış yeniden yazılır: anahtar arada değiştiyse eski karar kalmasın.
CREATE OR REPLACE FUNCTION public.record_payment_init(
  p_order uuid, p_token text, p_marketplace boolean, p_submerchant_key text,
  p_submerchant_price_cents integer, p_fallback_reason text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.order_payments (order_id, token, marketplace, submerchant_key, submerchant_price_cents, fallback_reason)
  VALUES (p_order, p_token, p_marketplace, p_submerchant_key, p_submerchant_price_cents, p_fallback_reason)
  ON CONFLICT (order_id) DO UPDATE
    SET token = EXCLUDED.token, last_error = NULL, marketplace = EXCLUDED.marketplace,
        submerchant_key = EXCLUDED.submerchant_key, submerchant_price_cents = EXCLUDED.submerchant_price_cents,
        fallback_reason = EXCLUDED.fallback_reason;
$$;

-- 022 ile aynı; pazaryeri ödemesi siparişe 'held' olarak işlenir.
CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order uuid, p_payment_id text, p_transactions jsonb, p_paid_cents integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_marketplace boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.payment_method <> 'online' THEN
    RAISE EXCEPTION 'Sipariş online ödemeli değil' USING ERRCODE = '22023';
  END IF;
  IF p_paid_cents <> v_order.total_cents THEN
    RAISE EXCEPTION 'Ödenen tutar sipariş tutarıyla uyuşmuyor' USING ERRCODE = '22023';
  END IF;

  UPDATE public.order_payments
     SET payment_id = p_payment_id, transactions = coalesce(p_transactions, '[]'::jsonb),
         paid_at = coalesce(paid_at, now()), last_error = NULL
   WHERE order_id = p_order
   RETURNING marketplace INTO v_marketplace;

  IF v_order.payment_status <> 'pending' THEN
    RETURN 'already_paid';
  END IF;
  IF v_order.status = 'cancelled' THEN
    UPDATE public.orders
       SET payment_status = 'refund_pending', updated_at = now(),
           marketplace_status = CASE WHEN v_marketplace THEN 'held' END
     WHERE id = p_order;
    RETURN 'refund_pending';
  END IF;
  UPDATE public.orders
     SET status = 'pending', payment_status = 'paid', updated_at = now(),
         marketplace_status = CASE WHEN v_marketplace THEN 'held' END
   WHERE id = p_order;
  RETURN 'paid';
END $$;

-- ── 4. Onay kuyruğu ────────────────────────────────────────────────────────

-- Para onay verilene kadar iyzico'da bekler. Onay ağ hatasıyla kaybolabilir, bu yüzden doğrudan değil
-- kuyruktan yapılır: aynı kırılım için ikinci onay 5064 döner ve başarı sayılır.
CREATE TABLE IF NOT EXISTS public.payment_approvals (
  order_id        uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  -- pending: denenecek. approved: tamam. failed: deneme hakkı bitti veya tutar uyuşmadı, yönetici bakar.
  -- cancelled: iade başladı, onay gönderilmeyecek.
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'failed', 'cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Bir çalışma satırı alınca dolar: iade o sırada onayla yarışmasın, süre dolarsa satır yeniden alınır.
  locked_until    timestamptz,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_approvals_due_idx ON public.payment_approvals (next_attempt_at) WHERE status = 'pending';
-- Politika yok: yalnızca service role ve aşağıdaki yönetici fonksiyonları erişir.
ALTER TABLE public.payment_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_approvals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_enqueue_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' AND NEW.marketplace_status = 'held' THEN
    INSERT INTO public.payment_approvals (order_id) VALUES (NEW.id) ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_enqueue_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_enqueue_approval_trg ON public.orders;
CREATE TRIGGER orders_enqueue_approval_trg
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_enqueue_approval();

-- Vadesi gelen satırları alır. İade talebi açık veya onaylanmış siparişe onay gitmez; talep reddedilirse sıra gelir.
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

-- Satır bu arada iadeye geçtiyse (kilit süresi dolmuşsa) dokunulmaz: iade iyzico'dan gerçek durumu sorar.
CREATE OR REPLACE FUNCTION public.complete_payment_approval(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_approvals
     SET status = 'approved', approved_at = coalesce(approved_at, now()), last_error = NULL,
         locked_until = NULL, updated_at = now()
   WHERE order_id = p_order AND status = 'pending';
  IF FOUND THEN
    UPDATE public.orders SET marketplace_status = 'approved', updated_at = now()
     WHERE id = p_order AND marketplace_status = 'held';
  END IF;
END $$;

-- Üstel bekleme: 5 dk, 10 dk, ... en çok 6 saat. On denemeden sonra veya p_final ile yöneticiye kalır.
CREATE OR REPLACE FUNCTION public.fail_payment_approval(p_order uuid, p_error text, p_final boolean DEFAULT FALSE)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.payment_approvals
     SET status = CASE WHEN p_final OR attempts >= 10 THEN 'failed' ELSE 'pending' END,
         last_error = left(p_error, 500),
         locked_until = NULL,
         next_attempt_at = now() + least(5 * power(2, greatest(attempts - 1, 0)), 360) * interval '1 minute',
         updated_at = now()
   WHERE order_id = p_order AND status = 'pending';
$$;

-- İade başlarken çağrılır. Dönüş: none, cancelled, approved, in_flight (onay o anda gönderiliyor olabilir).
CREATE OR REPLACE FUNCTION public.begin_marketplace_refund(p_order uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.payment_approvals%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.payment_approvals WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF v_row.status = 'approved' THEN
    RETURN 'approved';
  END IF;
  IF v_row.status = 'pending' AND v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN 'in_flight';
  END IF;
  UPDATE public.payment_approvals SET status = 'cancelled', locked_until = NULL, updated_at = now() WHERE order_id = p_order;
  RETURN 'cancelled';
END $$;

-- iyzico'da onay yok (hiç verilmedi veya geri çekildi): para satıcıya gitmeyecek, satıcı borçlanmaz.
CREATE OR REPLACE FUNCTION public.mark_marketplace_reversed(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_approvals SET status = 'cancelled', locked_until = NULL, updated_at = now() WHERE order_id = p_order;
  UPDATE public.orders SET marketplace_status = 'reversed', updated_at = now()
   WHERE id = p_order AND marketplace_status IS NOT NULL;
END $$;

-- 022 ile aynı, iki yoldan da (payment-refund, admin_mark_refunded) iade edilen siparişe artık onay gitmez.
-- Satır kuyrukta kalsaydı görev boşuna uyanır, satıcının hesap silmesi de sonsuza dek engellenirdi.
CREATE OR REPLACE FUNCTION public.mark_order_refunded(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders SET payment_status = 'refunded', updated_at = now()
   WHERE id = p_order AND payment_status = 'refund_pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sipariş iade beklemiyor' USING ERRCODE = '55000';
  END IF;
  UPDATE public.order_payments SET refunded_at = now(), last_error = NULL WHERE order_id = p_order;
  UPDATE public.payment_approvals SET status = 'cancelled', locked_until = NULL, updated_at = now()
   WHERE order_id = p_order AND status IN ('pending', 'failed');
END $$;

-- 023 ile aynı yaklaşım. internal_settings'e elle eklenir: approve_url ve aynı cron_secret.
CREATE TABLE IF NOT EXISTS public.internal_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.internal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_settings FROM anon, authenticated;

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
  -- Kuyruk boşken iyzico'ya da fonksiyona da gidilmez.
  IF NOT EXISTS (SELECT 1 FROM public.payment_approvals WHERE status = 'pending' AND next_attempt_at <= now()) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public.run_payment_approve() FROM PUBLIC, anon, authenticated;

-- pg_cron yoksa (023 henüz çalışmadıysa) görev elle eklenir, bkz. docs/CANLIYA-ALMA.md.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('payment-approve', '*/5 * * * *', 'SELECT public.run_payment_approve()');
  END IF;
END $$;

-- ── 5. Hesap kesimi ────────────────────────────────────────────────────────
-- Aynı hesap istemcide lib/earnings.ts içinde; test ikisini karşılaştırır.

-- Pazaryeri siparişinde satıcının hakkını iyzico öder: platformun borcu yok, satıcıda da platformun parası yok.
CREATE OR REPLACE FUNCTION public.order_balance_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN o.marketplace_status IS NOT NULL THEN 0
    ELSE public.order_net_cents(o) - CASE WHEN o.payment_method = 'online' THEN 0 ELSE o.total_cents END
  END;
$$;

-- Pazaryeri siparişi hesap kesimine girmez. Tek istisna: onay verilmiş ve geri çekilemediği için para satıcıya
-- geçmişken müşteriye panelden iade edilmiş sipariş (admin_mark_refunded). O zaman satıcının hakkı kadar borç doğar.
-- 'approved' + 'refund_pending' borç sayılmaz: payment-refund onayı geri çekerse çift kayıt olurdu.
CREATE OR REPLACE FUNCTION public.order_open_amount_cents(o public.orders)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN o.marketplace_status IS NOT NULL THEN
      CASE WHEN o.marketplace_status = 'approved' AND o.payment_status = 'refunded' AND o.payout_id IS NULL
        THEN -public.order_net_cents(o) END
    WHEN o.payout_id IS NULL AND public.order_counts_as_sale(o)
         AND coalesce(o.refund_status, 'none') <> 'requested' THEN public.order_balance_cents(o)
    WHEN o.payout_id IS NOT NULL AND o.reversal_payout_id IS NULL AND NOT public.order_counts_as_sale(o)
      THEN -public.order_balance_cents(o)
  END;
$$;

-- 024 ile aynı; pazaryeri siparişinin komisyonu kesimde sayılmaz, iade incelemesi de elle kesimi bekletmez.
CREATE OR REPLACE FUNCTION public.seller_open_totals(p_seller uuid)
RETURNS public.seller_open_total
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROW(
    coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
    (count(*) FILTER (WHERE public.order_open_amount_cents(o) IS NOT NULL))::integer,
    coalesce(sum(CASE WHEN o.marketplace_status IS NOT NULL THEN 0
                      WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END)
      FILTER (WHERE public.order_open_amount_cents(o) IS NOT NULL), 0)::integer,
    (count(*) FILTER (WHERE o.status = 'delivered' AND o.refund_status = 'requested' AND o.payout_id IS NULL
                        AND o.marketplace_status IS NULL))::integer
  )::public.seller_open_total
  FROM public.orders o WHERE o.seller_id = p_seller;
$$;

-- 024 ile aynı; yalnızca komisyon toplamı pazaryeri borcunu saymaz.
CREATE OR REPLACE FUNCTION public.admin_settle_seller(p_seller uuid, p_expected_cents integer, p_note text DEFAULT NULL)
RETURNS public.seller_payouts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_settle uuid[];
  v_reverse uuid[];
  v_amount integer;
  v_commission integer;
  v_payout public.seller_payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_user FROM public.sellers WHERE id = p_seller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Satıcı bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NULL), '{}'),
         coalesce(array_agg(o.id) FILTER (WHERE o.payout_id IS NOT NULL), '{}'),
         coalesce(sum(public.order_open_amount_cents(o)), 0)::integer,
         coalesce(sum(CASE WHEN o.marketplace_status IS NOT NULL THEN 0
                           WHEN o.payout_id IS NULL THEN o.commission_cents ELSE -o.commission_cents END), 0)::integer
    INTO v_settle, v_reverse, v_amount, v_commission
    FROM (
      SELECT * FROM public.orders x
       WHERE x.seller_id = p_seller AND public.order_open_amount_cents(x) IS NOT NULL
       FOR UPDATE
    ) o;

  IF coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Kesilecek sipariş yok' USING ERRCODE = '55000';
  END IF;
  IF v_amount <> p_expected_cents THEN
    RAISE EXCEPTION 'Bakiye değişti, listeyi yenileyin' USING ERRCODE = 'EVN04', DETAIL = v_amount::text;
  END IF;
  IF length(coalesce(p_note, '')) > 300 THEN
    RAISE EXCEPTION 'Not çok uzun' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.seller_payouts (seller_id, amount_cents, order_count, commission_cents, note, created_by)
  VALUES (p_seller, v_amount, coalesce(array_length(v_settle, 1), 0) + coalesce(array_length(v_reverse, 1), 0),
          v_commission, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  RETURNING * INTO v_payout;

  PERFORM set_config('app.internal', '1', true);
  UPDATE public.orders SET payout_id = v_payout.id WHERE id = ANY (v_settle);
  UPDATE public.orders SET reversal_payout_id = v_payout.id WHERE id = ANY (v_reverse);
  PERFORM set_config('app.internal', '', true);

  PERFORM public.notify_user(
    v_user, 'Hesap kesimi yapıldı',
    CASE WHEN v_amount >= 0
      THEN '₺' || to_char(v_amount / 100.0, 'FM999999990.00') || ' hesabınıza gönderildi.'
      ELSE '₺' || to_char(-v_amount / 100.0, 'FM999999990.00') || ' komisyon ödemeniz kaydedildi.'
    END,
    'payout', jsonb_build_object('payoutId', v_payout.id));
  RETURN v_payout;
END $$;
REVOKE ALL ON FUNCTION public.admin_settle_seller(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settle_seller(uuid, integer, text) TO authenticated;

-- Rapora pazaryeri satırı eklendi; dönüş tipi değiştiği için yeniden oluşturulur. Diğer sütunlar 033 ile aynı.
DROP FUNCTION IF EXISTS public.get_my_earnings(timestamptz, timestamptz);
CREATE FUNCTION public.get_my_earnings(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  order_count integer, gross_cents integer, seller_discount_cents integer, commission_cents integer,
  net_cents integer, collected_cents integer, open_balance_cents integer, open_order_count integer, held_count integer,
  tip_cents integer, marketplace_cents integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller uuid;
  v_open public.seller_open_total;
BEGIN
  SELECT s.id INTO v_seller FROM public.sellers s WHERE s.user_id = auth.uid();
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'Satıcı hesabı bulunamadı' USING ERRCODE = '42501';
  END IF;
  v_open := public.seller_open_totals(v_seller);
  RETURN QUERY
  SELECT count(*)::integer,
         coalesce(sum(o.subtotal_cents + o.delivery_fee_cents + o.platform_delivery_cents), 0)::integer,
         coalesce(sum(o.seller_discount_cents), 0)::integer,
         coalesce(sum(o.commission_cents), 0)::integer,
         coalesce(sum(public.order_net_cents(o)), 0)::integer,
         coalesce(sum(CASE WHEN o.payment_method = 'online' THEN 0 ELSE o.total_cents END), 0)::integer,
         v_open.balance_cents, v_open.order_count, v_open.held_count,
         coalesce(sum(o.tip_cents), 0)::integer,
         coalesce(sum(public.order_net_cents(o)) FILTER (WHERE o.marketplace_status IS NOT NULL), 0)::integer
    FROM public.orders o
   WHERE o.seller_id = v_seller
     AND public.order_counts_as_sale(o)
     AND o.delivered_at >= p_from AND o.delivered_at < p_to;
END $$;
REVOKE ALL ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_earnings(timestamptz, timestamptz) TO authenticated;

-- ── 6. Yönetici ekranı ─────────────────────────────────────────────────────

-- T.C. kimlik ve vergi numarası dönmez. needs_sync: kayıttan sonra şirket bilgisi veya IBAN değişti.
CREATE OR REPLACE FUNCTION public.admin_marketplace_sellers()
RETURNS TABLE (
  seller_id uuid, display_name text, legal_company_title text, company_type text, has_company_info boolean,
  has_iban boolean, status text, has_key boolean, last_error text, synced_at timestamptz, needs_sync boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.display_name, c.legal_company_title, c.company_type, c.seller_id IS NOT NULL, a.seller_id IS NOT NULL,
         m.status, m.submerchant_key IS NOT NULL, m.last_error, m.synced_at,
         (m.submerchant_key IS NOT NULL AND (
           m.synced_at IS NULL
           OR coalesce(c.updated_at > m.synced_at, FALSE)
           OR coalesce(a.updated_at > m.synced_at, FALSE)
         ))
    FROM public.sellers s
    LEFT JOIN public.seller_company_info c ON c.seller_id = s.id
    LEFT JOIN public.seller_payout_accounts a ON a.seller_id = s.id
    LEFT JOIN public.seller_submerchants m ON m.seller_id = s.id
   WHERE s.is_active OR m.seller_id IS NOT NULL
   ORDER BY s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_marketplace_sellers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_sellers() TO authenticated;

-- Parası hâlâ iyzico'da bekleyen siparişler.
CREATE OR REPLACE FUNCTION public.admin_payment_approval_queue()
RETURNS TABLE (
  order_id uuid, display_name text, amount_cents integer, status text, attempts integer,
  last_error text, next_attempt_at timestamptz, refund_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.order_id, s.display_name, p.submerchant_price_cents, a.status, a.attempts,
         a.last_error, a.next_attempt_at, o.refund_status
    FROM public.payment_approvals a
    JOIN public.orders o ON o.id = a.order_id
    JOIN public.sellers s ON s.id = o.seller_id
    JOIN public.order_payments p ON p.order_id = a.order_id
   WHERE a.status IN ('pending', 'failed')
   ORDER BY a.status, a.created_at;
END $$;
REVOKE ALL ON FUNCTION public.admin_payment_approval_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_approval_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_retry_payment_approval(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yalnızca yönetici' USING ERRCODE = '42501';
  END IF;
  UPDATE public.payment_approvals
     SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = NULL, updated_at = now()
   WHERE order_id = p_order AND status = 'failed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bu sipariş için yeniden denenecek onay yok' USING ERRCODE = '55000';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_retry_payment_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_payment_approval(uuid) TO authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'record_payment_init(uuid, text, boolean, text, integer, text)',
    'claim_payment_approvals(integer)',
    'complete_payment_approval(uuid)',
    'fail_payment_approval(uuid, text, boolean)',
    'begin_marketplace_refund(uuid)',
    'mark_marketplace_reversed(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ── 7. Hesap silme ─────────────────────────────────────────────────────────
-- 027 ile aynı, iki ek: kimlik ve vergi bilgisi anonimleşen mağazada kalmaz; parası iyzico'da bekleyen
-- satıcı silinemez (bu siparişler hesap kesimi bakiyesine girmediği için 027'deki denetim görmez).

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
  -- Son yöneticinin kendini silip paneli sahipsiz bırakmasını önler.
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

  -- Açık bakiye silinirse ne satıcıya ödeme yapılabilir ne de komisyon tahsil edilebilir.
  -- Bakiye sıfır görünse de kesilmemiş sipariş veya açık iade talebi varsa sonradan tutar doğabilir.
  IF v_seller IS NOT NULL AND (
    (public.seller_open_totals(v_seller)).order_count > 0
    OR EXISTS (SELECT 1 FROM public.orders o
                WHERE o.seller_id = v_seller AND o.status = 'delivered' AND o.refund_status = 'requested')
    OR EXISTS (SELECT 1 FROM public.payment_approvals a JOIN public.orders o ON o.id = a.order_id
                WHERE o.seller_id = v_seller AND a.status IN ('pending', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Bekleyen hesap kesiminiz var. Kesim tamamlandıktan sonra hesabınızı silebilirsiniz; destek ekibimize yazın.'
      USING ERRCODE = '55000';
  END IF;

  -- Önce yorumlar: puan tetikleyicisi bittiğinde app.internal işaretini temizler,
  -- bu yüzden işaret ancak bu adımdan sonra açılır.
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

  -- public.users ve ona bağlı kayıtlar (favori, adres, bildirim, sadakat, referans) buradan silinir.
  DELETE FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hesap bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.internal', '', true);
  RETURN v_seller;
END $$;

-- ── 8. Telefon doğrulama hatası: EVN05 ─────────────────────────────────────
-- 031 EVN02 kullanıyordu; EVN02 teslimat konumu yok (020), EVN03 alan dışı, EVN04 bakiye değişti demek.
-- Sepet konum hatasını telefon sanıp doğrulama penceresini açıyordu.

CREATE OR REPLACE FUNCTION public.orders_require_verified_phone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF (SELECT (value->>'required')::boolean FROM public.app_config WHERE key = 'phone_verification') IS TRUE
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND phone_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Sipariş vermek için telefonunu doğrula' USING ERRCODE = 'EVN05';
  END IF;
  RETURN NEW;
END $$;

-- ── 9. track_events: oturum başına sınır ───────────────────────────────────
-- Girişsiz çağrılabildiği için tablo sınırsız büyütülebilirdi. Bir oturum 24 saatte en çok 500 olay yazar,
-- fazlası hata vermeden atlanır (dönüş değerinde sayılmaz). Oturum numarasını sürekli değiştiren çağıran bu
-- sınıra takılmaz; bu yalnızca bozuk istemciye ve sıradan kötüye kullanıma karşıdır.

CREATE INDEX IF NOT EXISTS analytics_events_session_created_idx ON public.analytics_events (session_id, created_at);

CREATE OR REPLACE FUNCTION public.track_events(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_event jsonb;
  v_count integer := 0;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 20 THEN
    RAISE EXCEPTION 'Olay listesi geçersiz' USING ERRCODE = '22023';
  END IF;
  -- Profil satırı olmayan oturum (silinmiş hesabın eski jetonu) anonim sayılır.
  SELECT id INTO v_user FROM public.users WHERE id = auth.uid();

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    IF (SELECT count(*) FROM public.analytics_events e
         WHERE e.session_id = v_event->>'session_id' AND e.created_at > now() - interval '1 day') >= 500 THEN
      CONTINUE;
    END IF;
    BEGIN
      INSERT INTO public.analytics_events (session_id, user_id, name, props)
      VALUES (v_event->>'session_id', v_user, v_event->>'name', coalesce(v_event->'props', '{}'::jsonb));
      v_count := v_count + 1;
    EXCEPTION WHEN check_violation OR not_null_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN v_count;
END $$;

COMMIT;
