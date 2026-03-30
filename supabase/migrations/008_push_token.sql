-- Add push_token column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS push_token TEXT;
