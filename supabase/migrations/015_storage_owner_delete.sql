-- 015: Kullanıcı yüklediği fotoğrafları silebilsin
--
-- 003'teki silme politikaları dosya yolunun ilk klasörünü kullanıcı kimliği sayıyor, ama uygulama
-- users/<id>/, sellers/<id>/ ve menu/<id>/ altına yüklüyor; bu yüzden hiçbir dosya silinemiyordu.
-- Hesap silmede fotoğraflar temizlenebilsin diye dosyanın sahibine bakılır.

DROP POLICY IF EXISTS "Yükleyen kendi dosyasını silebilir" ON storage.objects;
CREATE POLICY "Yükleyen kendi dosyasını silebilir"
  ON storage.objects FOR DELETE
  USING (bucket_id IN ('food-images', 'avatars') AND owner_id = auth.uid()::text);
