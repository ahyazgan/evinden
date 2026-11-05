-- Herkese açık görsel kovaları: yükleme yalnızca kişinin kendi klasörüne, dosya listesi yalnızca kendi dosyalarına.
-- Görseller herkese açık adresten yüklenmeye devam eder, bu adres bu kurallara bakmaz.
-- Depo şeması yerel testlerde yoktur (tests/db/harness.mjs bu dosyayı atlar), gerçek projede denenir.

BEGIN;

DROP POLICY IF EXISTS "Auth upload avatars" ON storage.objects;
CREATE POLICY "Auth upload avatars" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'users'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Auth upload food-images" ON storage.objects;
CREATE POLICY "Auth upload food-images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'food-images'
    AND (storage.foldername(name))[1] IN ('menu', 'sellers')
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR (storage.foldername(name))[2] IN (SELECT id::text FROM public.sellers WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public read food-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner read public buckets" ON storage.objects;
CREATE POLICY "Owner read public buckets" ON storage.objects FOR SELECT
  USING (bucket_id IN ('avatars', 'food-images') AND owner_id = auth.uid()::text);

COMMIT;
