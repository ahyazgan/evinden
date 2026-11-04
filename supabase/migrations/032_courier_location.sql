-- Canlı kurye konumu. Restoran kendi kuryesiyle teslim eder: kurye, satıcı uygulamasına girmiş telefondur.
-- Konum kişisel veridir: geçmişi tutulmaz, sipariş başına tek satır vardır, teslimat bitince silinir.

CREATE TABLE IF NOT EXISTS public.order_courier_locations (
  order_id   uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  lat        numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading    numeric(5,2) CHECK (heading BETWEEN 0 AND 360),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_courier_locations ENABLE ROW LEVEL SECURITY;
-- Yazma yalnızca aşağıdaki fonksiyonlardan geçer.
REVOKE ALL ON public.order_courier_locations FROM anon, authenticated;
GRANT SELECT ON public.order_courier_locations TO authenticated;

DROP POLICY IF EXISTS "order_courier_locations_select" ON public.order_courier_locations;
CREATE POLICY "order_courier_locations_select" ON public.order_courier_locations FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND (o.customer_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = o.seller_id AND s.user_id = auth.uid()))
    )
  );

-- true: konum yazıldı. false: son yazımın üstünden 5 saniye geçmedi, yok sayıldı.
CREATE OR REPLACE FUNCTION public.update_courier_location(
  p_order   uuid,
  p_lat     numeric,
  p_lng     numeric,
  p_heading numeric DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status  text;
  v_written integer;
BEGIN
  -- FOR SHARE: aynı anda gelen "teslim edildi" bu yazımı bekler, sonra satırı siler.
  -- Kilit olmasa teslimattan sonra konum satırı kalabilirdi.
  SELECT o.status INTO v_status
    FROM public.orders o
    JOIN public.sellers s ON s.id = o.seller_id
   WHERE o.id = p_order AND s.user_id = auth.uid()
   FOR SHARE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_not_suspended();
  IF v_status <> 'out_for_delivery' THEN
    RAISE EXCEPTION 'Konumu yalnızca sipariş yoldayken paylaşabilirsin' USING ERRCODE = '55000';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Konum geçersiz, tekrar dene' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_courier_locations AS l (order_id, lat, lng, heading, updated_at)
  VALUES (p_order, p_lat, p_lng, CASE WHEN p_heading BETWEEN 0 AND 360 THEN p_heading END, now())
  ON CONFLICT (order_id) DO UPDATE
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading, updated_at = now()
    WHERE l.updated_at <= now() - interval '5 seconds';
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END $$;
REVOKE ALL ON FUNCTION public.update_courier_location(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_courier_location(uuid, numeric, numeric, numeric) TO authenticated;

-- Kurye paylaşımı durdurunca son konumu da müşterinin ekranından kalkar.
CREATE OR REPLACE FUNCTION public.stop_courier_location(p_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.id = p_order AND s.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Bu sipariş sana ait değil' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.order_courier_locations WHERE order_id = p_order;
END $$;
REVOKE ALL ON FUNCTION public.stop_courier_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_courier_location(uuid) TO authenticated;

-- Sipariş yoldan çıkınca (teslim, iptal) konum saklanmaz.
CREATE OR REPLACE FUNCTION public.orders_clear_courier_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.order_courier_locations WHERE order_id = NEW.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.orders_clear_courier_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_clear_courier_location_trg ON public.orders;
CREATE TRIGGER orders_clear_courier_location_trg
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status = 'out_for_delivery' AND NEW.status IS DISTINCT FROM 'out_for_delivery')
  EXECUTE FUNCTION public.orders_clear_courier_location();

-- Yoldaki siparişte de kurye müşterinin telefonunu görür: kapıda aramak en çok bu aşamada gerekir.
CREATE OR REPLACE FUNCTION public.get_seller_order_contacts(p_seller uuid)
RETURNS TABLE (order_id uuid, customer_name text, customer_phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sellers s WHERE s.id = p_seller AND s.user_id = auth.uid())
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Bu mağazanın siparişlerini göremezsiniz' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_not_suspended();
  RETURN QUERY
    SELECT o.id,
           u.name,
           CASE WHEN o.status IN ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery') THEN u.phone END
      FROM public.orders o
      LEFT JOIN public.users u ON u.id = o.customer_id
     WHERE o.seller_id = p_seller
       AND o.status <> 'awaiting_payment'; -- parası alınmamış sipariş satıcıya görünmez
END $$;
REVOKE ALL ON FUNCTION public.get_seller_order_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_order_contacts(uuid) TO authenticated;

-- Canlı güncelleme. Yayın yalnızca Supabase'de vardır.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_courier_locations'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_courier_locations;
  END IF;
END $$;
