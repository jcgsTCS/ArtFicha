
ALTER TABLE public.art_drafts 
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'not_published',
  ADD COLUMN IF NOT EXISTS tc_external_id integer,
  ADD COLUMN IF NOT EXISTS tc_last_response jsonb,
  ADD COLUMN IF NOT EXISTS tc_last_error text,
  ADD COLUMN IF NOT EXISTS tc_published_at timestamp with time zone;
