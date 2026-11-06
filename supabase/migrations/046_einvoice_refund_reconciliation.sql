-- 046: Kurumsal e-fatura, iade vakaları ve ödeme mutabakatı.
--
-- Müşteri fatura profili ve sipariş e-faturası birlikte tutulur. GİB'e gönderim Edge Function'da yapılır;
-- buradaki fonksiyonlar yalnızca denetimli fatura kaydı ve durum geçişlerini yönetir.

BEGIN;

-- ── 1. Kurumsal fatura profili ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.corporate_billing_profiles (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  legal_title   text NOT NULL CHECK (length(btrim(legal_title)) BETWEEN 3 AND 255),
  tax_office    text NOT NULL CHECK (length(btrim(tax_office)) BETWEEN 3 AND 255),
  tax_number    text NOT NULL CHECK (tax_number ~ '^[0-9]{10,11}$'),
  address       text NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 500),
  email         text NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone         text CHECK (phone IS NULL OR phone ~ '^\+90[0-9]{10}$'),
  is_default    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.corporate_billing_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corporate_billing_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.corporate_billing_profiles TO authenticated;
DROP POLICY IF EXISTS "Müşteri kendi fatura profilini görür" ON public.corporate_billing_profiles;
CREATE POLICY "Müşteri kendi fatura profilini görür" ON public.corporate_billing_profiles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Müşteri fatura profilini yazar" ON public.corporate_billing_profiles;
CREATE POLICY "Müşteri fatura profilini yazar" ON public.corporate_billing_profiles FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── 2. E-fatura ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  order_id       uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  seller_id      uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  -- Hesap silinince fatura kaydı kalır, müşteri bağı kopar (yasal saklama alıcı bilgisini snapshot'ta tutar).
  customer_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','submitted','accepted','rejected','cancelled')),
  buyer_snapshot jsonb NOT NULL,
  seller_snapshot jsonb NOT NULL,
  lines          jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents      integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    integer NOT NULL CHECK (total_cents >= 0),
  tax_rate_bps   integer NOT NULL DEFAULT 1000 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  currency       text NOT NULL DEFAULT 'TRY',
  provider       text NOT NULL DEFAULT 'generic',
  provider_id    text,
  error          text CHECK (error IS NULL OR length(error) <= 1000),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_status_created_idx ON public.invoices (status, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_seller_idx ON public.invoices (seller_id, created_at DESC);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoices FROM anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;
DROP POLICY IF EXISTS "Yönetici faturaları görür" ON public.invoices;
CREATE POLICY "Yönetici faturaları görür" ON public.invoices FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "Müşteri kendi faturasını görür" ON public.invoices;
CREATE POLICY "Müşteri kendi faturasını görür" ON public.invoices FOR SELECT USING (customer_id = auth.uid());

-- Fatura numarası GİB biçimindedir: 3 karakter ön ek + 4 haneli yıl + 9 haneli sıra (ör. AFY2026000000001).
-- Sıra her ön ek ve yıl için ayrı, boşluksuz artar; satır kilidiyle eşzamanlı iki fatura aynı numarayı alamaz.
CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  prefix     text NOT NULL CHECK (prefix ~ '^[A-Z0-9]{3}$'),
  year       integer NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value BETWEEN 0 AND 999999999),
  PRIMARY KEY (prefix, year)
);
ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_number_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.einvoice_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value->>'enabled' FROM public.app_config WHERE key = 'einvoice_policy'), 'false') = 'true';
$$;
REVOKE ALL ON FUNCTION public.einvoice_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.einvoice_enabled() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._next_invoice_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix text := upper(coalesce((SELECT value->>'invoice_prefix' FROM public.app_config WHERE key = 'einvoice_policy'), 'AFY'));
  v_year integer := extract(year FROM now() AT TIME ZONE 'Europe/Istanbul')::integer;
  v_seq integer;
BEGIN
  IF v_prefix !~ '^[A-Z0-9]{3}$' THEN v_prefix := 'AFY'; END IF;
  INSERT INTO public.invoice_number_counters (prefix, year, last_value) VALUES (v_prefix, v_year, 1)
  ON CONFLICT (prefix, year) DO UPDATE SET last_value = public.invoice_number_counters.last_value + 1
  RETURNING last_value INTO v_seq;
  RETURN v_prefix || v_year::text || lpad(v_seq::text, 9, '0');
END $$;
REVOKE ALL ON FUNCTION public._next_invoice_number() FROM PUBLIC, anon, authenticated;

-- Faturalanabilir sipariş: teslim edilmiş, iadesi istenmemiş veya reddedilmiş, parası iade edilmemiş.
CREATE OR REPLACE FUNCTION public._assert_invoiceable(p_order public.orders)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_order.status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'Fatura yalnızca teslim edilmiş sipariş için kesilebilir' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_order.refund_status, 'none') IN ('requested','approved')
     OR coalesce(p_order.payment_status, '') IN ('refund_pending','refunded') THEN
    RAISE EXCEPTION 'İadesi istenen veya yapılan siparişe fatura kesilemez' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_invoiceable(public.orders) FROM PUBLIC, anon, authenticated;

-- Fatura satırları ve tutarları. Fatura, restoranın sattığı mal ve teslimat bedelini kapsar:
-- ürünler + teslimat − indirim. Bahşiş satış bedeli olmadığı için faturaya girmez (mali müşavirle doğrulanmalı).
-- Her satırın KDV'si kendi brüt tutarından ayrılır; başlık toplamları satırların toplamıdır, kuruş farkı oluşmaz.
CREATE OR REPLACE FUNCTION public._invoice_amounts(p_order public.orders, p_rate integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_raw jsonb;
  v_goods integer;
  v_discount integer;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_gross integer;
  v_net integer;
  v_subtotal integer := 0;
  v_tax integer := 0;
  v_total integer := 0;
BEGIN
  v_raw := coalesce((SELECT jsonb_agg(jsonb_build_object('kind', 'item', 'name', oi.title_snapshot, 'quantity', oi.quantity,
      'unitPriceCents', oi.unit_price_cents, 'lineTotalCents', oi.line_total_cents) ORDER BY oi.id)
    FROM public.order_items oi WHERE oi.order_id = p_order.id), '[]'::jsonb);
  IF coalesce(p_order.delivery_fee_cents, 0) > 0 THEN
    v_raw := v_raw || jsonb_build_array(jsonb_build_object('kind', 'delivery', 'name', 'Teslimat', 'quantity', 1,
      'unitPriceCents', p_order.delivery_fee_cents, 'lineTotalCents', p_order.delivery_fee_cents));
  END IF;
  SELECT coalesce(sum((x->>'lineTotalCents')::integer), 0) INTO v_goods FROM jsonb_array_elements(v_raw) x;
  v_discount := least(greatest(coalesce(p_order.discount_cents, 0), 0), v_goods);
  IF v_discount > 0 THEN
    v_raw := v_raw || jsonb_build_array(jsonb_build_object('kind', 'discount', 'name', 'İndirim', 'quantity', 1,
      'unitPriceCents', -v_discount, 'lineTotalCents', -v_discount));
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_raw) LOOP
    v_gross := (v_line->>'lineTotalCents')::integer;
    v_net := round(v_gross * 10000.0 / (10000 + p_rate))::integer;
    v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('netCents', v_net, 'taxCents', v_gross - v_net));
    v_subtotal := v_subtotal + v_net;
    v_tax := v_tax + (v_gross - v_net);
    v_total := v_total + v_gross;
  END LOOP;

  RETURN jsonb_build_object('lines', v_lines, 'subtotal_cents', v_subtotal, 'tax_cents', v_tax, 'total_cents', v_total);
END $$;
REVOKE ALL ON FUNCTION public._invoice_amounts(public.orders, integer) FROM PUBLIC, anon, authenticated;

-- Satıcı bilgisi: şahıs şirketinde vergi numarası yerine T.C. kimlik numarası kullanılır (faturada zorunlu alan).
CREATE OR REPLACE FUNCTION public._invoice_seller_snapshot(p_seller uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company public.seller_company_info;
BEGIN
  SELECT * INTO v_company FROM public.seller_company_info WHERE seller_id = p_seller;
  IF NOT FOUND OR v_company.legal_company_title IS NULL OR coalesce(v_company.tax_number, v_company.identity_number) IS NULL THEN
    RAISE EXCEPTION 'Satıcının vergi bilgileri eksik' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('title', v_company.legal_company_title,
    'taxNumber', coalesce(v_company.tax_number, v_company.identity_number),
    'taxOffice', v_company.tax_office, 'address', v_company.address, 'email', v_company.email);
END $$;
REVOKE ALL ON FUNCTION public._invoice_seller_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._invoice_tax_rate()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (SELECT value->>'tax_rate_bps' FROM public.app_config WHERE key = 'einvoice_policy') ~ '^[0-9]{1,4}$'
              THEN least(10000, (SELECT (value->>'tax_rate_bps')::integer FROM public.app_config WHERE key = 'einvoice_policy'))
              ELSE 1000 END;
$$;
REVOKE ALL ON FUNCTION public._invoice_tax_rate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_invoice(p_order uuid, p_buyer jsonb)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_buyer jsonb;
  v_invoice public.invoices;
  v_rate integer := public._invoice_tax_rate();
  v_amounts jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  IF NOT public.einvoice_enabled() THEN
    RAISE EXCEPTION 'E-fatura henüz açık değil' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_invoiceable(v_order);
  IF EXISTS (SELECT 1 FROM public.invoices WHERE order_id = p_order) THEN
    RAISE EXCEPTION 'Bu sipariş için fatura zaten kesilmiş' USING ERRCODE = '23505';
  END IF;

  -- Yalnızca bilinen alanlar alınır; istemcinin gönderdiği fazla anahtarlar faturaya girmez.
  v_buyer := jsonb_build_object(
    'title', left(btrim(coalesce(p_buyer->>'title', '')), 255),
    'taxNumber', left(regexp_replace(coalesce(p_buyer->>'taxNumber', ''), '\D', '', 'g'), 11),
    'taxOffice', left(btrim(coalesce(p_buyer->>'taxOffice', '')), 255),
    'address', left(btrim(coalesce(p_buyer->>'address', '')), 500),
    'email', left(btrim(coalesce(p_buyer->>'email', '')), 254)
  );
  IF length(v_buyer->>'title') < 3 OR v_buyer->>'taxNumber' !~ '^[0-9]{10,11}$'
     OR length(v_buyer->>'address') < 5 OR v_buyer->>'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Fatura profili eksik veya geçersiz' USING ERRCODE = '22023';
  END IF;

  v_amounts := public._invoice_amounts(v_order, v_rate);
  INSERT INTO public.invoices (
    invoice_number, order_id, seller_id, customer_id, status, buyer_snapshot, seller_snapshot,
    lines, subtotal_cents, tax_cents, total_cents, tax_rate_bps
  ) VALUES (
    public._next_invoice_number(), p_order, v_order.seller_id, v_order.customer_id, 'queued',
    v_buyer, public._invoice_seller_snapshot(v_order.seller_id),
    v_amounts->'lines', (v_amounts->>'subtotal_cents')::integer, (v_amounts->>'tax_cents')::integer,
    (v_amounts->>'total_cents')::integer, v_rate
  ) RETURNING * INTO v_invoice;
  RETURN v_invoice;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_invoice(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_invoice(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_invoices(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, invoice_number text, order_id uuid, seller_id uuid, seller_name text, customer_id uuid,
  customer_name text, status text, subtotal_cents integer, tax_cents integer, total_cents integer,
  provider text, provider_id text, error text, issued_at timestamptz, created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT i.id, i.invoice_number, i.order_id, i.seller_id, s.display_name, i.customer_id,
           coalesce(u.name, 'Müşteri'), i.status, i.subtotal_cents, i.tax_cents, i.total_cents,
           i.provider, i.provider_id, i.error, i.issued_at, i.created_at
      FROM public.invoices i
      JOIN public.sellers s ON s.id = i.seller_id
      LEFT JOIN public.users u ON u.id = i.customer_id
     WHERE p_status IS NULL OR i.status = p_status
     ORDER BY i.created_at DESC LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_invoices(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_invoices(text) TO authenticated;

-- ── 3. İade vakaları ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.refund_cases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id      uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  -- Hesap silinse de iade kaydı denetim için kalır.
  customer_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  -- Siparişteki ödeme yöntemi aynen kopyalanır (cash, card_door, meal_card_door, online); ayrı liste tutulmaz.
  payment_method text NOT NULL DEFAULT 'cash',
  requested_cents integer NOT NULL CHECK (requested_cents >= 0),
  approved_cents integer CHECK (approved_cents IS NULL OR approved_cents >= 0),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  decision_note  text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_cases_status_idx ON public.refund_cases (status, requested_at DESC);
ALTER TABLE public.refund_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_cases FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.orders_refund_case_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status AND NEW.refund_status IN ('requested','approved','rejected') THEN
    INSERT INTO public.refund_cases (order_id, seller_id, customer_id, reason, payment_method, requested_cents, status,
      approved_cents, decided_at, decided_by)
    VALUES (NEW.id, NEW.seller_id, NEW.customer_id, left(coalesce(nullif(btrim(NEW.refund_reason), ''), 'Belirtilmedi'), 500),
      coalesce(NEW.payment_method, 'cash'), NEW.total_cents, NEW.refund_status,
      CASE WHEN NEW.refund_status = 'approved' THEN NEW.total_cents END,
      CASE WHEN NEW.refund_status IN ('approved','rejected') THEN now() END,
      CASE WHEN NEW.refund_status IN ('approved','rejected') THEN auth.uid() END)
    ON CONFLICT (order_id) DO UPDATE SET
      reason = excluded.reason, requested_cents = excluded.requested_cents,
      -- Ödenmiş iade, eski yoldan gelen bir durum değişikliğiyle geri açılmaz.
      status = CASE WHEN refund_cases.status = 'paid' THEN 'paid' ELSE excluded.status END,
      approved_cents = CASE WHEN refund_cases.status = 'paid' THEN refund_cases.approved_cents
                            WHEN excluded.status = 'approved' THEN coalesce(refund_cases.approved_cents, excluded.approved_cents)
                            ELSE NULL END,
      decided_at = coalesce(refund_cases.decided_at, excluded.decided_at),
      decided_by = coalesce(refund_cases.decided_by, excluded.decided_by),
      updated_at = now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_refund_case_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_refund_case_sync_trg ON public.orders;
CREATE TRIGGER orders_refund_case_sync_trg
  AFTER UPDATE OF refund_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_refund_case_sync();

CREATE OR REPLACE FUNCTION public.admin_list_refund_cases(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, order_id uuid, seller_id uuid, seller_name text, customer_id uuid, customer_name text,
  reason text, payment_method text, requested_cents integer, approved_cents integer, status text, decision_note text,
  requested_at timestamptz, decided_at timestamptz, paid_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT r.id, r.order_id, r.seller_id, s.display_name, r.customer_id, coalesce(u.name, 'Müşteri'),
           r.reason, r.payment_method, r.requested_cents, r.approved_cents, r.status, r.decision_note,
           r.requested_at, r.decided_at, r.paid_at
      FROM public.refund_cases r
      JOIN public.sellers s ON s.id = r.seller_id
      LEFT JOIN public.users u ON u.id = r.customer_id
     WHERE p_status IS NULL OR r.status = p_status
     ORDER BY r.requested_at DESC LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_refund_cases(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_refund_cases(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_decide_refund_case(
  p_case uuid, p_decision text, p_approved_cents integer DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.refund_cases;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Geçersiz karar' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND OR v_case.status <> 'requested' THEN RAISE EXCEPTION 'İade vakası bulunamadı veya karara bağlanmış' USING ERRCODE = '22023'; END IF;
  -- Kısmi iade henüz desteklenmez: online iade ve satıcı kazancı siparişin tamamı üzerinden işler.
  -- Kısmi tutar onaylanırsa gerçekte tam iade yapılır; bu yüzden reddedilir.
  IF p_decision = 'approved' AND p_approved_cents IS NOT NULL AND p_approved_cents <> v_case.requested_cents THEN
    RAISE EXCEPTION 'Kısmi iade desteklenmiyor; iade tutarın tamamı onaylanır' USING ERRCODE = '22023';
  END IF;
  UPDATE public.refund_cases SET status = p_decision,
    approved_cents = CASE WHEN p_decision = 'approved' THEN v_case.requested_cents ELSE NULL END,
    decision_note = left(coalesce(p_note, ''), 500), decided_at = now(), decided_by = auth.uid(), updated_at = now()
   WHERE id = p_case;
  UPDATE public.orders SET refund_status = p_decision, updated_at = now() WHERE id = v_case.order_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_decide_refund_case(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decide_refund_case(uuid, text, integer, text) TO authenticated;

-- ── 4. Mutabakat ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start   timestamptz NOT NULL,
  period_end     timestamptz NOT NULL,
  source         text NOT NULL DEFAULT 'iyzico' CHECK (source IN ('iyzico','bank')),
  reference      text CHECK (reference IS NULL OR length(reference) <= 200),
  expected_cents integer NOT NULL,
  actual_cents   integer NOT NULL,
  difference_cents integer NOT NULL,
  status         text NOT NULL DEFAULT 'difference' CHECK (status IN ('matched','difference','closed')),
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note           text CHECK (note IS NULL OR length(note) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CHECK (period_end > period_start)
);
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliation_runs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_reconciliation(
  p_period_start timestamptz, p_period_end timestamptz, p_actual_cents integer,
  p_source text DEFAULT 'iyzico', p_reference text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS public.reconciliation_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expected integer;
  v_run public.reconciliation_runs;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF p_period_end <= p_period_start OR p_actual_cents < 0 THEN RAISE EXCEPTION 'Geçersiz mutabakat dönemi' USING ERRCODE = '22023'; END IF;
  -- Beklenen tutar: dönemde açılan online siparişlerden müşteriden net tahsil edilen para.
  -- İadesi yapılan siparişte çekim ve iade birbirini götürür (0); iadesi bekleyen sipariş henüz tahsil edilmiş sayılır.
  -- iyzico komisyonu ve satıcıya aktarılan paylar bu tutara dahil değildir.
  SELECT coalesce(sum(o.total_cents::bigint) FILTER (WHERE o.payment_status IN ('paid','refund_pending')), 0)::integer INTO v_expected
    FROM public.orders o WHERE o.payment_method = 'online' AND o.payment_status IN ('paid','refund_pending','refunded')
      AND o.created_at >= p_period_start AND o.created_at < p_period_end;
  INSERT INTO public.reconciliation_runs (period_start, period_end, source, reference, expected_cents, actual_cents, difference_cents, status, note)
  VALUES (p_period_start, p_period_end, coalesce(p_source, 'iyzico'), left(coalesce(p_reference, ''), 200), v_expected, p_actual_cents,
    p_actual_cents - v_expected, CASE WHEN p_actual_cents = v_expected THEN 'matched' ELSE 'difference' END, left(coalesce(p_note, ''), 500))
  RETURNING * INTO v_run;
  RETURN v_run;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_reconciliation(timestamptz, timestamptz, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_reconciliation(timestamptz, timestamptz, integer, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_reconciliations()
RETURNS TABLE (
  id uuid, period_start timestamptz, period_end timestamptz, source text, reference text,
  expected_cents integer, actual_cents integer, difference_cents integer, status text, note text,
  created_at timestamptz, closed_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT r.id, r.period_start, r.period_end, r.source, r.reference, r.expected_cents,
    r.actual_cents, r.difference_cents, r.status, r.note, r.created_at, r.closed_at
    FROM public.reconciliation_runs r ORDER BY r.created_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_reconciliations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reconciliations() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_close_reconciliation(p_run uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  UPDATE public.reconciliation_runs SET status = 'closed', note = left(coalesce(p_note, note, ''), 500), closed_at = now(), closed_by = auth.uid()
   WHERE id = p_run AND status <> 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Mutabakat bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_close_reconciliation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_reconciliation(uuid, text) TO authenticated;

COMMIT;
