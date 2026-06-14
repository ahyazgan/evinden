-- App configuration table for force update and other settings
CREATE TABLE IF NOT EXISTS public.app_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Everyone can read app config
CREATE POLICY "Herkes app config okuyabilir"
  ON public.app_config FOR SELECT USING (true);

-- Only admin can modify
CREATE POLICY "Admin app config güncelleyebilir"
  ON public.app_config FOR ALL USING (public.is_admin());

-- Insert default update config
INSERT INTO public.app_config (key, value) VALUES (
  'update_config',
  '{"min_version": "1.0.0", "latest_version": "1.0.0", "force_update": false, "update_message": "Daha iyi bir deneyim için uygulamayı güncellemeniz gerekiyor."}'::jsonb
) ON CONFLICT (key) DO NOTHING;
