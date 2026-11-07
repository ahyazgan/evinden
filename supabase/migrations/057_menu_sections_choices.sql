-- 057: Restoran menüsü: kendi bölümleri, ürün sırası, ekstra/porsiyon/çeşit düzenleme.
--
-- - Restoran kendi bölüm başlıklarını açar ve sıralar (menu_sections). Bölümü olan ürün müşteri menüsünde
--   o bölümün altında, bölümün sırasıyla görünür. Bölüm açmamış restoranın menüsü eskisi gibi kategoriye
--   göre gruplanır; kategori arama ve filtre için kalır.
-- - Ürün sırası menu_items.sort_order ile tutulur, tek çağrıyla yazılır.
-- - Ekstra, porsiyon ve çeşitler tek çağrıyla kaydedilir: ad, fiyat, sıra ve "bitti" durumu yerinde
--   değişir, mevcut satırın kimliği korunur (sepetteki seçim bozulmaz). Önceden yalnızca silinip
--   yeniden eklenebiliyordu ve sıra yazılmıyordu.

BEGIN;

-- ── 1. Bölümler ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.menu_sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS menu_sections_seller_idx ON public.menu_sections (seller_id, sort_order);

ALTER TABLE public.menu_sections ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.menu_sections FROM anon, authenticated;
DROP POLICY IF EXISTS "Herkes menü bölümlerini görebilir" ON public.menu_sections;
CREATE POLICY "Herkes menü bölümlerini görebilir" ON public.menu_sections FOR SELECT USING (TRUE);

ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.menu_sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS menu_items_section_idx ON public.menu_items (section_id);

-- Mevcut ürünler eklenme sırasıyla numaralanır. Yalnızca sütun ilk eklendiğinde: dosya ikinci kez
-- çalışırsa restoranın seçtiği sıra bozulmaz.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'sort_order') THEN
    ALTER TABLE public.menu_items ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
    UPDATE public.menu_items mi SET sort_order = r.rn
      FROM (SELECT id, (row_number() OVER (PARTITION BY seller_id ORDER BY created_at, id) - 1)::integer AS rn
              FROM public.menu_items) r
     WHERE r.id = mi.id AND r.rn <> 0;
  END IF;
END $$;

-- Ürün yalnızca kendi restoranının bölümüne konabilir.
CREATE OR REPLACE FUNCTION public.menu_items_section_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_sections ms WHERE ms.id = NEW.section_id AND ms.seller_id = NEW.seller_id
  ) THEN
    RAISE EXCEPTION 'Bölüm bu restorana ait değil' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.menu_items_section_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS menu_items_section_guard_trg ON public.menu_items;
CREATE TRIGGER menu_items_section_guard_trg BEFORE INSERT OR UPDATE OF section_id, seller_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.menu_items_section_guard();

-- Restoranın bölüm listesini sırasıyla yazar: kimliği olan güncellenir, olmayan eklenir, listede
-- olmayan silinir (ürünleri bölümsüz kalır). p_sections: [{ "id"?: uuid, "title": text }]
CREATE OR REPLACE FUNCTION public.save_menu_sections(p_sections jsonb)
RETURNS SETOF public.menu_sections LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller uuid;
  v_row jsonb;
  v_id uuid;
  v_title text;
  v_keep uuid[] := '{}';
  v_titles text[] := '{}';
  v_i integer := 0;
BEGIN
  SELECT id INTO v_seller FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'Restoran bulunamadı' USING ERRCODE = '42501'; END IF;
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array' THEN
    RAISE EXCEPTION 'Bölüm listesi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_sections) > 30 THEN
    RAISE EXCEPTION 'En fazla 30 bölüm açılabilir' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.sellers WHERE id = v_seller FOR NO KEY UPDATE;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_sections) LOOP
    v_title := btrim(coalesce(v_row->>'title', ''));
    IF char_length(v_title) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Bölüm adı 1-60 karakter olmalı' USING ERRCODE = '22023';
    END IF;
    IF lower(v_title) = ANY (v_titles) THEN
      RAISE EXCEPTION '"%" adında iki bölüm olamaz', v_title USING ERRCODE = '22023';
    END IF;
    v_titles := v_titles || lower(v_title);
    v_id := NULLIF(v_row->>'id', '')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.menu_sections (seller_id, title, sort_order) VALUES (v_seller, v_title, v_i) RETURNING id INTO v_id;
    ELSE
      UPDATE public.menu_sections SET title = v_title, sort_order = v_i WHERE id = v_id AND seller_id = v_seller;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bölüm bu restorana ait değil' USING ERRCODE = '42501'; END IF;
    END IF;
    v_keep := v_keep || v_id;
    v_i := v_i + 1;
  END LOOP;

  DELETE FROM public.menu_sections WHERE seller_id = v_seller AND NOT (id = ANY (v_keep));
  RETURN QUERY SELECT * FROM public.menu_sections WHERE seller_id = v_seller ORDER BY sort_order;
END $$;
REVOKE ALL ON FUNCTION public.save_menu_sections(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_menu_sections(jsonb) TO authenticated;

-- Ürün sırasını yazar: listedeki sıra sort_order olur. Liste restoranın ürünlerinin bir kısmı olabilir
-- (bir bölümün ürünleri); hepsi çağıranın restoranına ait olmalı.
CREATE OR REPLACE FUNCTION public.reorder_menu_items(p_items uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seller uuid;
BEGIN
  SELECT id INTO v_seller FROM public.sellers WHERE user_id = auth.uid() LIMIT 1;
  IF v_seller IS NULL THEN RAISE EXCEPTION 'Restoran bulunamadı' USING ERRCODE = '42501'; END IF;
  IF p_items IS NULL OR cardinality(p_items) = 0 OR cardinality(p_items) > 500 THEN
    RAISE EXCEPTION 'Ürün listesi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_items) <> (SELECT count(DISTINCT x) FROM unnest(p_items) x) THEN
    RAISE EXCEPTION 'Ürün listesi geçersiz' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_items) x WHERE NOT EXISTS (
       SELECT 1 FROM public.menu_items mi WHERE mi.id = x AND mi.seller_id = v_seller)) THEN
    RAISE EXCEPTION 'Ürün bu restorana ait değil' USING ERRCODE = '42501';
  END IF;
  UPDATE public.menu_items mi SET sort_order = (t.ord - 1)::integer
    FROM unnest(p_items) WITH ORDINALITY AS t(id, ord)
   WHERE mi.id = t.id;
END $$;
REVOKE ALL ON FUNCTION public.reorder_menu_items(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_menu_items(uuid[]) TO authenticated;

-- ── 2. Ekstra, porsiyon, çeşit ─────────────────────────────────────────────
-- p_kind: extra | portion | variant. p_rows sırasıyla: [{ "id"?: uuid, "label", "price_cents", "is_available" }]
-- Porsiyonda price_cents porsiyonun fiyatıdır (0'dan büyük), ekstrada ek ücret, çeşitte fiyat farkıdır (0 veya fazla).
-- Listede olmayan satır silinir.
CREATE OR REPLACE FUNCTION public.save_menu_item_choices(p_item uuid, p_kind text, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_label text;
  v_price integer;
  v_available boolean;
  v_keep uuid[] := '{}';
  v_labels text[] := '{}';
  v_i integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items mi JOIN public.sellers s ON s.id = mi.seller_id
     WHERE mi.id = p_item AND s.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Bu ürünü düzenleyemezsin' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('extra','portion','variant') THEN
    RAISE EXCEPTION 'Seçenek türü geçersiz' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 30 THEN
    RAISE EXCEPTION 'En fazla 30 seçenek eklenebilir' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.menu_items WHERE id = p_item FOR NO KEY UPDATE;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_label := btrim(coalesce(v_row->>'label', ''));
    IF char_length(v_label) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'Seçenek adı 1-60 karakter olmalı' USING ERRCODE = '22023';
    END IF;
    IF lower(v_label) = ANY (v_labels) THEN
      RAISE EXCEPTION '"%" iki kez eklenmiş', v_label USING ERRCODE = '22023';
    END IF;
    v_labels := v_labels || lower(v_label);
    BEGIN
      v_price := coalesce((v_row->>'price_cents')::integer, 0);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: fiyat geçersiz', v_label USING ERRCODE = '22023';
    END;
    IF v_price > 10000000 OR v_price < 0 OR (p_kind = 'portion' AND v_price = 0) THEN
      RAISE EXCEPTION '%: fiyat geçersiz', v_label USING ERRCODE = '22023';
    END IF;
    v_available := coalesce((v_row->>'is_available')::boolean, TRUE);
    v_id := NULLIF(v_row->>'id', '')::uuid;

    IF p_kind = 'extra' THEN
      IF v_id IS NULL THEN
        INSERT INTO public.menu_item_extras (menu_item_id, label, price_cents, is_available, sort_order)
        VALUES (p_item, v_label, v_price, v_available, v_i) RETURNING id INTO v_id;
      ELSE
        UPDATE public.menu_item_extras SET label = v_label, price_cents = v_price, is_available = v_available, sort_order = v_i
         WHERE id = v_id AND menu_item_id = p_item;
        IF NOT FOUND THEN RAISE EXCEPTION 'Seçenek bu ürüne ait değil' USING ERRCODE = '42501'; END IF;
      END IF;
    ELSIF p_kind = 'portion' THEN
      IF v_id IS NULL THEN
        INSERT INTO public.menu_item_portions (menu_item_id, label, price_cents, is_available, sort_order)
        VALUES (p_item, v_label, v_price, v_available, v_i) RETURNING id INTO v_id;
      ELSE
        UPDATE public.menu_item_portions SET label = v_label, price_cents = v_price, is_available = v_available, sort_order = v_i
         WHERE id = v_id AND menu_item_id = p_item;
        IF NOT FOUND THEN RAISE EXCEPTION 'Seçenek bu ürüne ait değil' USING ERRCODE = '42501'; END IF;
      END IF;
    ELSE
      IF v_id IS NULL THEN
        INSERT INTO public.menu_item_variants (menu_item_id, label, price_diff_cents, is_available, sort_order)
        VALUES (p_item, v_label, v_price, v_available, v_i) RETURNING id INTO v_id;
      ELSE
        UPDATE public.menu_item_variants SET label = v_label, price_diff_cents = v_price, is_available = v_available, sort_order = v_i
         WHERE id = v_id AND menu_item_id = p_item;
        IF NOT FOUND THEN RAISE EXCEPTION 'Seçenek bu ürüne ait değil' USING ERRCODE = '42501'; END IF;
      END IF;
    END IF;
    v_keep := v_keep || v_id;
    v_i := v_i + 1;
  END LOOP;

  IF p_kind = 'extra' THEN
    DELETE FROM public.menu_item_extras WHERE menu_item_id = p_item AND NOT (id = ANY (v_keep));
  ELSIF p_kind = 'portion' THEN
    DELETE FROM public.menu_item_portions WHERE menu_item_id = p_item AND NOT (id = ANY (v_keep));
  ELSE
    DELETE FROM public.menu_item_variants WHERE menu_item_id = p_item AND NOT (id = ANY (v_keep));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_menu_item_choices(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_menu_item_choices(uuid, text, jsonb) TO authenticated;

COMMIT;
