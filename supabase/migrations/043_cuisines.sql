-- Restoranın mutfakları: ana sayfadaki mutfak satırı, filtre ve kart bunu okur. En çok 3 tane seçilir.
-- Liste lib/cuisines.ts ile aynıdır.

BEGIN;

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS cuisines text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_cuisines_known;
ALTER TABLE public.sellers ADD CONSTRAINT sellers_cuisines_known CHECK (
  coalesce(array_length(cuisines, 1), 0) <= 3
  AND cuisines <@ ARRAY[
    'doner', 'burger', 'pizza', 'pide', 'kebap', 'tavuk', 'kofte', 'esnaf', 'sandvic', 'cigkofte',
    'kahvalti', 'corba', 'manti', 'deniz', 'salata', 'dunya', 'tatli', 'pastane', 'dondurma', 'kahve'
  ]::text[]
);

CREATE INDEX IF NOT EXISTS sellers_cuisines_idx ON public.sellers USING gin (cuisines);

COMMIT;
