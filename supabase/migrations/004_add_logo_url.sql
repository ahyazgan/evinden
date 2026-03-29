-- Add logo_url column to sellers table
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Add cover_url column to sellers table (optional cover photo)
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS cover_url TEXT;
