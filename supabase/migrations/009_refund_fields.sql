-- Add cancel/refund fields to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_status TEXT CHECK (refund_status IN ('none', 'requested', 'approved', 'rejected')) DEFAULT 'none';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_reason TEXT;
