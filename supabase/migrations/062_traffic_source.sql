-- 062: Ziyaretçinin nereden geldiği (Google, Instagram, WhatsApp, kampanya bağlantısı...).
--
-- Webde app_open olayına "source" alanı eklenir. Değer istemcide kaba bir etikete indirgenir
-- (lib/traffic-source.ts): tam adres, sorgu metni ve kişisel veri gönderilmez. Kural 035'teki gibi:
-- yalnız bilinen anahtarlar, boşluksuz kısa değerler.
-- Yönetici "Nereden geldiler" tablosunu admin_traffic_sources ile görür: oturum ve siparişe dönen oturum.
--
-- Önemli: istemci bu migration'dan önce yayınlanırsa source taşıyan app_open olayları kısıta takılır ve
-- sessizce atılır (track_events check_violation'ı yutar). Önce bu dosya uygulanır, sonra site yayınlanır.

BEGIN;

CREATE OR REPLACE FUNCTION public.analytics_props_valid(p_props jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_props) <> 'object' OR octet_length(p_props::text) > 256 THEN FALSE
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_props) AS e(key, value)
       WHERE e.key <> ALL (ARRAY['seller_id','method','fulfillment','scheduled','mode','length','reason','source'])
          OR NOT CASE jsonb_typeof(e.value)
               WHEN 'string' THEN (e.value #>> '{}') ~ '^[A-Za-z0-9_-]{1,64}$'
               WHEN 'number' THEN TRUE
               WHEN 'boolean' THEN TRUE
               ELSE FALSE
             END
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.analytics_props_valid(jsonb) FROM PUBLIC, anon, authenticated;

-- Kaynak başına oturum ve o oturumlardan verilen sipariş. Satıcı ve yönetici oturumları sayılmaz (huni gibi).
CREATE OR REPLACE FUNCTION public.admin_traffic_sources(p_days integer)
RETURNS TABLE (source text, sessions bigint, ordering_sessions bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkin yok' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Dönem geçersiz' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH opens AS (
      SELECT e.session_id, min(coalesce(e.props->>'source', 'bilinmiyor')) AS source
        FROM public.analytics_events e
       WHERE e.name = 'app_open'
         AND e.created_at >= now() - make_interval(days => p_days)
         AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.user_id AND u.role <> 'buyer')
       GROUP BY e.session_id
    ),
    ordered AS (
      SELECT DISTINCT e.session_id
        FROM public.analytics_events e
       WHERE e.name = 'order_placed'
         AND e.created_at >= now() - make_interval(days => p_days)
    )
    SELECT o.source, count(*)::bigint, count(d.session_id)::bigint
      FROM opens o
      LEFT JOIN ordered d ON d.session_id = o.session_id
     GROUP BY o.source
     ORDER BY count(*) DESC, o.source;
END $$;
REVOKE ALL ON FUNCTION public.admin_traffic_sources(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_traffic_sources(integer) TO authenticated;

COMMIT;
