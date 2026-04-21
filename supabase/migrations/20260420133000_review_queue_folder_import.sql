ALTER TABLE public.art_drafts
  ALTER COLUMN artist DROP NOT NULL,
  ALTER COLUMN measures DROP NOT NULL,
  ALTER COLUMN price DROP NOT NULL;

ALTER TABLE public.art_drafts
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS is_user_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_edited_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS generated_title text,
  ADD COLUMN IF NOT EXISTS final_title text,
  ADD COLUMN IF NOT EXISTS generated_description text,
  ADD COLUMN IF NOT EXISTS final_description text,
  ADD COLUMN IF NOT EXISTS inherited_artist text,
  ADD COLUMN IF NOT EXISTS inherited_category text,
  ADD COLUMN IF NOT EXISTS inherited_measures text,
  ADD COLUMN IF NOT EXISTS inherited_price numeric,
  ADD COLUMN IF NOT EXISTS parsing_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_attempts integer NOT NULL DEFAULT 0;

UPDATE public.art_drafts
SET publication_status = 'pending_review'
WHERE publication_status IN ('not_published', 'reviewing');

UPDATE public.art_drafts
SET publication_status = 'ready_to_publish'
WHERE publication_status = 'ready';

UPDATE public.art_drafts
SET review_status = 'ready_to_publish'
WHERE review_status = 'reviewed';

UPDATE public.art_drafts
SET review_status = 'pending_review'
WHERE review_status IN ('reviewing', 'rejected');

UPDATE public.art_drafts
SET
  generated_title = COALESCE(generated_title, title),
  final_title = COALESCE(final_title, title),
  generated_description = COALESCE(generated_description, description),
  final_description = COALESCE(final_description, description)
WHERE generated_title IS NULL
   OR final_title IS NULL
   OR generated_description IS NULL
   OR final_description IS NULL;

ALTER TABLE public.art_drafts
  ALTER COLUMN publication_status SET DEFAULT 'pending_review',
  ALTER COLUMN status SET DEFAULT 'pending_review';

ALTER TABLE public.art_drafts
  DROP CONSTRAINT IF EXISTS art_drafts_publication_status_valid,
  DROP CONSTRAINT IF EXISTS art_drafts_review_status_valid;

ALTER TABLE public.art_drafts
  ADD CONSTRAINT art_drafts_publication_status_valid
    CHECK (publication_status IN ('not_published', 'pending_review', 'ready_to_publish', 'publishing', 'published', 'failed')) NOT VALID,
  ADD CONSTRAINT art_drafts_review_status_valid
    CHECK (review_status IN ('pending_review', 'ready_to_publish', 'reviewed')) NOT VALID,
  ADD CONSTRAINT art_drafts_source_type_valid
    CHECK (source_type IN ('manual', 'single_upload', 'batch_upload', 'folder_import')) NOT VALID,
  ADD CONSTRAINT art_drafts_publish_attempts_non_negative
    CHECK (publish_attempts >= 0) NOT VALID;

CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'folder_import',
  root_name text,
  status text NOT NULL DEFAULT 'uploaded',
  total_images integer NOT NULL DEFAULT 0,
  processed_images integer NOT NULL DEFAULT 0,
  pending_images integer NOT NULL DEFAULT 0,
  failed_images integer NOT NULL DEFAULT 0,
  ready_for_review integer NOT NULL DEFAULT 0,
  parsing_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT import_batches_status_valid
    CHECK (status IN ('uploaded', 'processing', 'completed', 'completed_with_errors', 'failed')),
  CONSTRAINT import_batches_counts_non_negative
    CHECK (
      total_images >= 0
      AND processed_images >= 0
      AND pending_images >= 0
      AND failed_images >= 0
      AND ready_for_review >= 0
    )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'art_drafts_import_batch_id_fkey'
  ) THEN
    ALTER TABLE public.art_drafts
      ADD CONSTRAINT art_drafts_import_batch_id_fkey
      FOREIGN KEY (import_batch_id)
      REFERENCES public.import_batches(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own import batches" ON public.import_batches;
CREATE POLICY "Users can manage own import batches"
  ON public.import_batches FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS art_drafts_user_review_idx
  ON public.art_drafts (user_id, review_status, publication_status, created_at DESC);

CREATE INDEX IF NOT EXISTS art_drafts_import_batch_idx
  ON public.art_drafts (import_batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS art_drafts_source_path_idx
  ON public.art_drafts (user_id, source_type, source_path);

CREATE INDEX IF NOT EXISTS import_batches_user_created_idx
  ON public.import_batches (user_id, created_at DESC);

DROP TRIGGER IF EXISTS update_import_batches_updated_at ON public.import_batches;
CREATE TRIGGER update_import_batches_updated_at
  BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
