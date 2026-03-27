-- evinden: kullanıcı profilleri (telefon OTP ile auth.users'a bağlı)
-- Supabase SQL Editor'da veya CLI ile çalıştırın.

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
  avatar_url TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.users.is_approved IS 'Alıcılar için true; satıcılar yönetici onayıyla true olur.';

CREATE INDEX IF NOT EXISTS users_phone_idx ON public.users (phone);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kullanıcı kendi satırını okuyabilir"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Kullanıcı kendi satırını ekleyebilir"
  ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Kullanıcı kendi satırını güncelleyebilir"
  ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
