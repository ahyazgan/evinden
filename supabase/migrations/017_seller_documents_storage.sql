-- 017: Restoran belgeleri için gizli depo
--
-- Fotoğraf depoları herkese açık olduğundan vergi levhası gibi belgeler ayrı ve gizli bir depoda durur.
-- Dosya yolu <kullanıcı kimliği>/<belge türü>-<zaman>.<uzantı> biçimindedir. Yalnızca başvuran ve
-- yönetici okuyabilir; UPDATE politikası yoktur, yeni dosya her zaman yeni bir yola yüklenir.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('seller-documents', 'seller-documents', false, 10485760, ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Başvuran belge yükleyebilir" ON storage.objects;
CREATE POLICY "Başvuran belge yükleyebilir"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'seller-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Başvuran kendi belgesini görebilir" ON storage.objects;
CREATE POLICY "Başvuran kendi belgesini görebilir"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'seller-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Admin belgeleri okuyabilir" ON storage.objects;
CREATE POLICY "Admin belgeleri okuyabilir"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'seller-documents' AND public.is_admin());

DROP POLICY IF EXISTS "Başvuran kendi belgesini silebilir" ON storage.objects;
CREATE POLICY "Başvuran kendi belgesini silebilir"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'seller-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
