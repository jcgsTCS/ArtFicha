ALTER TABLE public.art_drafts
  ADD COLUMN IF NOT EXISTS generated_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS review_checklist jsonb NOT NULL DEFAULT '{"imageChecked": false, "titleChecked": false, "descriptionChecked": false, "categoryChecked": false, "priceChecked": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS quality_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_minutes_saved integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_edit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generated_snapshot jsonb;
