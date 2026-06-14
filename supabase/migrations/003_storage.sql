-- Storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('food-images', 'food-images', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp']),
  ('avatars',     'avatars',     true, 2097152, ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Public read for both buckets
CREATE POLICY "Public read food-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'food-images');

CREATE POLICY "Public read avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated upload
CREATE POLICY "Auth upload food-images"
  ON storage.objects FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND bucket_id = 'food-images');

CREATE POLICY "Auth upload avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND bucket_id = 'avatars');

-- Owner update/delete
CREATE POLICY "Owner update food-images"
  ON storage.objects FOR UPDATE
  USING (auth.uid()::text = (storage.foldername(name))[1] AND bucket_id = 'food-images');

CREATE POLICY "Owner delete food-images"
  ON storage.objects FOR DELETE
  USING (auth.uid()::text = (storage.foldername(name))[1] AND bucket_id = 'food-images');

CREATE POLICY "Owner update avatars"
  ON storage.objects FOR UPDATE
  USING (auth.uid()::text = (storage.foldername(name))[1] AND bucket_id = 'avatars');

CREATE POLICY "Owner delete avatars"
  ON storage.objects FOR DELETE
  USING (auth.uid()::text = (storage.foldername(name))[1] AND bucket_id = 'avatars');
