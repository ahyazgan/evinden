-- 053: Pazar yeri fatura modeli.
--
-- Büyük yemek platformlarında olduğu gibi:
--   1. Yemeğin faturasını satıcı restoran kendi adına, kendi e-fatura/e-arşiv sisteminden keser. Platform yalnızca
--      müşterinin kurumsal fatura bilgisini siparişle restorana iletir; restoran fatura numarasını (ve isterse PDF'ini)
--      uygulamaya işler, müşteri görür.
--   2. Platform her restorana aylık komisyon faturası keser (komisyon KDV hariçtir, KDV üstüne eklenir).
--
-- 046'daki platform adına e-fatura modülü kapalı kalır; tabloları silinmez.

BEGIN;

-- ── 1. Siparişe kurumsal fatura talebi ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_invoice_requests (
  order_id          uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id         uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  customer_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  buyer             jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','issued','correction_required','corrected','cancelled')),
  invoice_number    text CHECK (invoice_number IS NULL OR length(invoice_number) BETWEEN 3 AND 50),
  document_path     text CHECK (document_path IS NULL OR length(document_path) <= 300),
  issued_at         timestamptz,
  correction_note   text CHECK (correction_note IS NULL OR length(correction_note) <= 500),
  corrected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_invoice_requests_seller_idx ON public.order_invoice_requests (seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_invoice_requests_customer_idx ON public.order_invoice_requests (customer_id, created_at DESC);
ALTER TABLE public.order_invoice_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_invoice_requests FROM anon, authenticated;
GRANT SELECT ON public.order_invoice_requests TO authenticated;
DROP POLICY IF EXISTS "Fatura talebini taraflar görür" ON public.order_invoice_requests;
CREATE POLICY "Fatura talebini taraflar görür" ON public.order_invoice_requests FOR SELECT
  USING (customer_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid())
         OR public.is_admin());

-- Müşteri, kayıtlı kurumsal profilinden kendi siparişine fatura ister. Sipariş verirken veya teslimden
-- sonraki 30 gün içinde istenebilir; iptal veya iade edilen siparişe istenemez.
CREATE OR REPLACE FUNCTION public.request_order_invoice(p_order uuid)
RETURNS public.order_invoice_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_profile public.corporate_billing_profiles;
  v_row public.order_invoice_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Giriş yapmalısın' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sipariş bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status = 'cancelled' OR coalesce(v_order.refund_status, 'none') IN ('requested','approved')
     OR coalesce(v_order.payment_status, '') IN ('refund_pending','refunded') THEN
    RAISE EXCEPTION 'İptal veya iade edilen siparişe fatura istenemez' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'delivered' AND coalesce(v_order.delivered_at, v_order.updated_at) < now() - interval '30 days' THEN
    RAISE EXCEPTION 'Fatura teslimden sonraki 30 gün içinde istenebilir' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_profile FROM public.corporate_billing_profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Önce kurumsal fatura bilgilerini kaydet' USING ERRCODE = '55000'; END IF;

  INSERT INTO public.order_invoice_requests (order_id, seller_id, customer_id, buyer)
  VALUES (p_order, v_order.seller_id, auth.uid(), jsonb_build_object(
    'title', v_profile.legal_title, 'taxNumber', v_profile.tax_number, 'taxOffice', v_profile.tax_office,
    'address', v_profile.address, 'email', v_profile.email))
  ON CONFLICT (order_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.order_id IS NULL THEN RAISE EXCEPTION 'Bu sipariş için fatura zaten istendi' USING ERRCODE = '23505'; END IF;

  PERFORM public.notify_user(s.user_id, 'Kurumsal fatura istendi',
    v_profile.legal_title || ' sipariş #' || left(p_order::text, 8) || ' için fatura istiyor.', 'system',
    jsonb_build_object('orderId', p_order)) FROM public.sellers s WHERE s.id = v_order.seller_id;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.request_order_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_order_invoice(uuid) TO authenticated;

-- Restoran faturayı kendi sisteminden kestikten sonra numarasını (ve isterse PDF'ini) işler.
-- Numara sonradan düzeltilebilir; düzeltme bekleyen talepte de yeni numara yazılabilir.
CREATE OR REPLACE FUNCTION public.seller_mark_order_invoiced(p_order uuid, p_number text, p_document_path text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.order_invoice_requests;
  v_order public.orders;
  v_number text := upper(btrim(coalesce(p_number, '')));
  v_path text := nullif(btrim(coalesce(p_document_path, '')), '');
BEGIN
  SELECT r.* INTO v_row FROM public.order_invoice_requests r
    JOIN public.sellers s ON s.id = r.seller_id
   WHERE r.order_id = p_order AND s.user_id = auth.uid()
   FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura talebi bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status NOT IN ('requested','issued') THEN
    RAISE EXCEPTION 'Bu talep için fatura işlenemez' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order;
  IF v_order.status IN ('pending','awaiting_payment','cancelled') THEN
    RAISE EXCEPTION 'Fatura sipariş onaylandıktan sonra kesilir' USING ERRCODE = '22023';
  END IF;
  IF v_number !~ '^[A-Z0-9][A-Z0-9/-]{2,49}$' THEN
    RAISE EXCEPTION 'Fatura numarasını kontrol et' USING ERRCODE = '22023';
  END IF;
  IF v_path IS NOT NULL AND v_path NOT LIKE auth.uid()::text || '/' || p_order::text || '/%' THEN
    RAISE EXCEPTION 'Geçersiz belge' USING ERRCODE = '22023';
  END IF;
  UPDATE public.order_invoice_requests
     SET status = 'issued', invoice_number = v_number, document_path = coalesce(v_path, document_path),
         issued_at = coalesce(issued_at, now()), updated_at = now()
   WHERE order_id = p_order;
  IF v_row.status = 'requested' THEN
    PERFORM public.notify_user(v_row.customer_id, 'Faturan kesildi',
      'Sipariş #' || left(p_order::text, 8) || ' faturası: ' || v_number, 'order_status',
      jsonb_build_object('orderId', p_order)) WHERE v_row.customer_id IS NOT NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.seller_mark_order_invoiced(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_mark_order_invoiced(uuid, text, text) TO authenticated;

-- İade sonrası düzeltmeyi (iptal veya alıcının iade faturası) restoran tamamlar.
CREATE OR REPLACE FUNCTION public.seller_mark_invoice_corrected(p_order uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Ne yaptığını kısaca yaz (ör. fatura iptal edildi)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.order_invoice_requests r
     SET status = 'corrected', correction_note = left(btrim(p_note), 500), corrected_at = now(), updated_at = now()
    FROM public.sellers s
   WHERE r.order_id = p_order AND s.id = r.seller_id AND s.user_id = auth.uid() AND r.status = 'correction_required';
  IF NOT FOUND THEN RAISE EXCEPTION 'Düzeltme bekleyen fatura bulunamadı' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.seller_mark_invoice_corrected(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_mark_invoice_corrected(uuid, text) TO authenticated;

-- İptal veya iade: kesilmemiş talep kapanır; kesilmiş fatura restorana düzeltme olarak düşer.
CREATE OR REPLACE FUNCTION public.orders_invoice_request_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.order_invoice_requests;
BEGIN
  IF NOT ((NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
       OR (NEW.refund_status = 'approved' AND OLD.refund_status IS DISTINCT FROM 'approved')
       OR (coalesce(NEW.payment_status, '') IN ('refund_pending','refunded')
           AND coalesce(OLD.payment_status, '') NOT IN ('refund_pending','refunded'))) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_row FROM public.order_invoice_requests WHERE order_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_row.status = 'requested' THEN
    UPDATE public.order_invoice_requests SET status = 'cancelled', updated_at = now() WHERE order_id = NEW.id;
  ELSIF v_row.status = 'issued' THEN
    UPDATE public.order_invoice_requests SET status = 'correction_required', updated_at = now() WHERE order_id = NEW.id;
    PERFORM public.notify_user(s.user_id, 'Faturanı düzelt',
      'Sipariş #' || left(NEW.id::text, 8) || ' iade edildi. ' || v_row.invoice_number
        || ' numaralı faturayı iptal et veya alıcıdan iade faturası al.', 'system',
      jsonb_build_object('orderId', NEW.id)) FROM public.sellers s WHERE s.id = v_row.seller_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_invoice_request_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_invoice_request_sync_trg ON public.orders;
CREATE TRIGGER orders_invoice_request_sync_trg AFTER UPDATE OF status, refund_status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_invoice_request_sync();

-- Fatura PDF'leri: yol <restoran kullanıcısı>/<sipariş>/<dosya>. Restoran yükler; restoran, siparişin müşterisi
-- ve yönetici okur. Depolama yalnızca gerçek Supabase'de bulunur; PGlite uyumlu kalmak için koşullu.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('order-invoices', 'order-invoices', false, 5242880, ARRAY['application/pdf','image/jpeg','image/png'])
    ON CONFLICT (id) DO NOTHING;
    IF to_regclass('storage.objects') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'order invoices seller upload') THEN
        CREATE POLICY "order invoices seller upload" ON storage.objects FOR INSERT TO authenticated
          WITH CHECK (bucket_id = 'order-invoices'
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND EXISTS (SELECT 1 FROM public.order_invoice_requests r JOIN public.sellers s ON s.id = r.seller_id
                         WHERE r.order_id::text = (storage.foldername(name))[2] AND s.user_id = auth.uid()));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'order invoices read') THEN
        CREATE POLICY "order invoices read" ON storage.objects FOR SELECT TO authenticated
          USING (bucket_id = 'order-invoices' AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR public.is_admin()
            OR EXISTS (SELECT 1 FROM public.order_invoice_requests r
                        WHERE r.order_id::text = (storage.foldername(name))[2] AND r.customer_id = auth.uid())));
      END IF;
    END IF;
  END IF;
END $$;

-- ── 2. Platformun restorana aylık komisyon faturası ─────────────────────────

INSERT INTO public.app_config (key, value)
VALUES ('commission_invoice', '{"tax_rate_bps":2000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.commission_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  period_month     date NOT NULL CHECK (extract(day FROM period_month) = 1),
  order_count      integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  tax_rate_bps     integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_cents        integer NOT NULL DEFAULT 0,
  total_cents      integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  invoice_number   text CHECK (invoice_number IS NULL OR length(invoice_number) BETWEEN 3 AND 50),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  issued_at        timestamptz,
  issued_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, period_month)
);
ALTER TABLE public.commission_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_invoices FROM anon, authenticated;
GRANT SELECT ON public.commission_invoices TO authenticated;
DROP POLICY IF EXISTS "Komisyon faturasını restoran ve yönetici görür" ON public.commission_invoices;
CREATE POLICY "Komisyon faturasını restoran ve yönetici görür" ON public.commission_invoices FOR SELECT
  USING (public.is_admin()
         OR (status = 'issued' AND EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = seller_id AND s.user_id = auth.uid())));

-- Faturaya giren siparişler. Kesilmiş faturadaki sipariş sonradan iade edilirse sonraki ayın faturasına
-- eksi satır olarak girer (ters kayıt), bir kez.
CREATE TABLE IF NOT EXISTS public.commission_invoice_orders (
  invoice_id       uuid NOT NULL REFERENCES public.commission_invoices(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  commission_cents integer NOT NULL,
  PRIMARY KEY (invoice_id, order_id)
);
CREATE INDEX IF NOT EXISTS commission_invoice_orders_order_idx ON public.commission_invoice_orders (order_id);
ALTER TABLE public.commission_invoice_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_invoice_orders FROM anon, authenticated;

-- Geçmiş bir ayın taslaklarını oluşturur veya yeniden hesaplar. Kesilmiş faturaya dokunmaz.
-- Ay İstanbul saatine göredir; teslim zamanı (delivered_at) esas alınır.
CREATE OR REPLACE FUNCTION public.admin_generate_commission_invoices(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_start timestamptz := (date_trunc('month', p_month)::timestamp AT TIME ZONE 'Europe/Istanbul');
  v_end timestamptz := ((date_trunc('month', p_month) + interval '1 month')::timestamp AT TIME ZONE 'Europe/Istanbul');
  v_rate integer := CASE WHEN (SELECT value->>'tax_rate_bps' FROM public.app_config WHERE key = 'commission_invoice') ~ '^[0-9]{1,4}$'
                         THEN least(10000, (SELECT (value->>'tax_rate_bps')::integer FROM public.app_config WHERE key = 'commission_invoice'))
                         ELSE 2000 END;
  v_drafts integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF v_end > now() THEN RAISE EXCEPTION 'Ay bitmeden komisyon faturası oluşturulamaz' USING ERRCODE = '22023'; END IF;
  -- Aynı ay için iki eşzamanlı çağrı satırları çakıştırmasın.
  PERFORM pg_advisory_xact_lock(hashtext('commission_invoices:' || v_month::text));

  -- Taslakların satırları baştan hesaplanır.
  DELETE FROM public.commission_invoice_orders l USING public.commission_invoices ci
   WHERE ci.id = l.invoice_id AND ci.period_month = v_month AND ci.status = 'draft';

  CREATE TEMP TABLE IF NOT EXISTS _commission_lines (seller_id uuid, order_id uuid, commission_cents integer) ON COMMIT DROP;
  DELETE FROM _commission_lines;

  -- Ayda teslim edilip iade edilmemiş, henüz hiçbir faturaya girmemiş siparişler.
  INSERT INTO _commission_lines
  SELECT o.seller_id, o.id, o.commission_cents
    FROM public.orders o
   WHERE public.order_is_realized_sale(o) AND coalesce(o.commission_cents, 0) <> 0
     AND o.delivered_at >= v_start AND o.delivered_at < v_end
     AND NOT EXISTS (SELECT 1 FROM public.commission_invoice_orders l JOIN public.commission_invoices ci ON ci.id = l.invoice_id
                      WHERE l.order_id = o.id AND l.commission_cents > 0 AND ci.status <> 'cancelled');

  -- Önceki kesilmiş faturada olup sonradan iade edilen siparişler: ters kayıt.
  INSERT INTO _commission_lines
  SELECT o.seller_id, o.id, -l.commission_cents
    FROM public.commission_invoice_orders l
    JOIN public.commission_invoices ci ON ci.id = l.invoice_id AND ci.status = 'issued' AND ci.period_month < v_month
    JOIN public.orders o ON o.id = l.order_id
   WHERE l.commission_cents > 0 AND NOT public.order_is_realized_sale(o)
     AND NOT EXISTS (SELECT 1 FROM public.commission_invoice_orders r JOIN public.commission_invoices rc ON rc.id = r.invoice_id
                      WHERE r.order_id = o.id AND r.commission_cents < 0 AND rc.status <> 'cancelled');

  -- Eksi toplamlı fatura kesilemez. Ters kayıtlar ancak o ayın toplamı artı kalıyorsa bu aya yazılır;
  -- kalmıyorsa hiçbir taslağa girmez ve sonraki ayın dökümünde yeniden denenir.
  DELETE FROM _commission_lines c
   WHERE c.commission_cents < 0
     AND c.seller_id IN (SELECT x.seller_id FROM _commission_lines x GROUP BY x.seller_id HAVING sum(x.commission_cents::bigint) <= 0);

  INSERT INTO public.commission_invoices (seller_id, period_month, tax_rate_bps)
  SELECT DISTINCT seller_id, v_month, v_rate FROM _commission_lines
  ON CONFLICT (seller_id, period_month) DO NOTHING;

  INSERT INTO public.commission_invoice_orders (invoice_id, order_id, commission_cents)
  SELECT ci.id, c.order_id, c.commission_cents
    FROM _commission_lines c
    JOIN public.commission_invoices ci ON ci.seller_id = c.seller_id AND ci.period_month = v_month AND ci.status = 'draft';

  UPDATE public.commission_invoices ci SET
    order_count = t.n, commission_cents = t.net, tax_rate_bps = v_rate,
    tax_cents = round(t.net::numeric * v_rate / 10000)::integer,
    total_cents = (t.net + round(t.net::numeric * v_rate / 10000))::integer, updated_at = now()
    FROM (SELECT l.invoice_id, count(*)::integer AS n, sum(l.commission_cents::bigint)::integer AS net
            FROM public.commission_invoice_orders l GROUP BY l.invoice_id) t
   WHERE t.invoice_id = ci.id AND ci.period_month = v_month AND ci.status = 'draft';

  DELETE FROM public.commission_invoices ci
   WHERE ci.period_month = v_month AND ci.status = 'draft'
     AND NOT EXISTS (SELECT 1 FROM public.commission_invoice_orders l WHERE l.invoice_id = ci.id);

  SELECT count(*)::integer INTO v_drafts FROM public.commission_invoices WHERE period_month = v_month AND status = 'draft';
  RETURN jsonb_build_object('month', v_month, 'drafts', v_drafts,
    'issued', (SELECT count(*)::integer FROM public.commission_invoices WHERE period_month = v_month AND status = 'issued'));
END $$;
REVOKE ALL ON FUNCTION public.admin_generate_commission_invoices(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_commission_invoices(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_commission_invoices(p_month date)
RETURNS TABLE (
  id uuid, seller_id uuid, seller_name text, legal_title text, tax_number text, period_month date,
  order_count integer, commission_cents integer, tax_rate_bps integer, tax_cents integer, total_cents integer,
  status text, invoice_number text, issued_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT ci.id, ci.seller_id, s.display_name, c.legal_company_title, coalesce(c.tax_number, c.identity_number),
           ci.period_month, ci.order_count, ci.commission_cents, ci.tax_rate_bps, ci.tax_cents, ci.total_cents,
           ci.status, ci.invoice_number, ci.issued_at
      FROM public.commission_invoices ci
      JOIN public.sellers s ON s.id = ci.seller_id
      LEFT JOIN public.seller_company_info c ON c.seller_id = ci.seller_id
     WHERE ci.period_month = date_trunc('month', p_month)::date
     ORDER BY s.display_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_commission_invoices(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_commission_invoices(date) TO authenticated;

-- Yönetici faturayı muhasebe/e-fatura sisteminden kestikten sonra numarasını işler; restoran görür.
CREATE OR REPLACE FUNCTION public.admin_mark_commission_invoiced(p_invoice uuid, p_number text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.commission_invoices;
  v_number text := upper(btrim(coalesce(p_number, '')));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  IF v_number !~ '^[A-Z0-9][A-Z0-9/-]{2,49}$' THEN RAISE EXCEPTION 'Fatura numarasını kontrol et' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.commission_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'draft' THEN RAISE EXCEPTION 'Taslak komisyon faturası bulunamadı' USING ERRCODE = 'P0002'; END IF;
  IF v_row.commission_cents <= 0 THEN
    RAISE EXCEPTION 'Toplam sıfır veya eksi: bu ay için fatura yerine iade faturası gerekir' USING ERRCODE = '22023';
  END IF;
  UPDATE public.commission_invoices
     SET status = 'issued', invoice_number = v_number, note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         issued_at = now(), issued_by = auth.uid(), updated_at = now()
   WHERE id = p_invoice;
  PERFORM public.notify_user(s.user_id, 'Komisyon faturan kesildi',
    to_char(v_row.period_month, 'MM.YYYY') || ' dönemi komisyon faturası: ' || v_number, 'system',
    jsonb_build_object('commissionInvoiceId', p_invoice)) FROM public.sellers s WHERE s.id = v_row.seller_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_mark_commission_invoiced(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_commission_invoiced(uuid, text, text) TO authenticated;

-- ── 3. Operasyon özeti ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    -- Teslimden 48 saat sonra hâlâ kesilmemiş kurumsal fatura talebi.
    'order_invoices_overdue', (SELECT count(*)::integer FROM public.order_invoice_requests r JOIN public.orders o ON o.id = r.order_id
       WHERE r.status = 'requested' AND o.status = 'delivered' AND coalesce(o.delivered_at, o.updated_at) < now() - interval '48 hours'),
    'order_invoices_open', (SELECT count(*)::integer FROM public.order_invoice_requests WHERE status IN ('requested','correction_required')),
    'commission_drafts', (SELECT count(*)::integer FROM public.commission_invoices WHERE status = 'draft'),
    -- 046 e-fatura modülü kapalı; eski kartlar için sayılar korunur.
    'invoice_candidates', 0,
    'invoice_drafts', (SELECT count(*)::integer FROM public.invoices WHERE status IN ('draft','queued')),
    'invoice_submitted', (SELECT count(*)::integer FROM public.invoices WHERE status IN ('sending','submitted')),
    'invoice_rejected', (SELECT count(*)::integer FROM public.invoices WHERE status = 'rejected'),
    'invoice_corrections', (SELECT count(*)::integer FROM public.invoices WHERE correction_status = 'required'),
    'invoice_stale', (SELECT count(*)::integer FROM public.invoices
       WHERE status = 'submitted' AND submitted_at < now() - interval '24 hours'),
    'sla_open', (SELECT count(*)::integer FROM public.sla_violations WHERE status = 'open'),
    'refunds_requested', (SELECT count(*)::integer FROM public.refund_cases WHERE status = 'requested'),
    'refunds_approved', (SELECT count(*)::integer FROM public.refund_cases WHERE status = 'approved'),
    'reconciliation_differences', (SELECT count(*)::integer FROM public.reconciliation_runs WHERE status = 'difference')
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_operations_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_overview() TO authenticated;

COMMIT;
