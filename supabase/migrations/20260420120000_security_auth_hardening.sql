CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.art_drafts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS original_image_url text,
  ADD COLUMN IF NOT EXISTS processed_image_url text,
  ADD COLUMN IF NOT EXISTS published_image_url text,
  ADD COLUMN IF NOT EXISTS ai_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.art_drafts
  ADD CONSTRAINT art_drafts_quality_score_range
    CHECK (quality_score >= 0 AND quality_score <= 100) NOT VALID,
  ADD CONSTRAINT art_drafts_publication_status_valid
    CHECK (publication_status IN ('not_published', 'reviewing', 'ready', 'publishing', 'published', 'failed')) NOT VALID,
  ADD CONSTRAINT art_drafts_review_status_valid
    CHECK (review_status IN ('pending_review', 'reviewing', 'reviewed', 'rejected')) NOT VALID,
  ADD CONSTRAINT art_drafts_attribution_status_valid
    CHECK (attribution_status IN ('unverified', 'ai_detected', 'human_confirmed')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.api_desks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'groq',
  active_api_id text,
  use_premium_analysis boolean NOT NULL DEFAULT false,
  encrypted_config jsonb NOT NULL DEFAULT '{"apis":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES public.art_drafts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.draft_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES public.art_drafts(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Anyone can insert drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Anyone can update drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Anyone can delete drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Users can read own drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Users can insert own drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Users can update own drafts" ON public.art_drafts;
DROP POLICY IF EXISTS "Users can delete own drafts" ON public.art_drafts;

CREATE POLICY "Users can read own drafts"
  ON public.art_drafts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own drafts"
  ON public.art_drafts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drafts"
  ON public.art_drafts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own drafts"
  ON public.art_drafts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own api desks"
  ON public.api_desks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own credentials"
  ON public.user_credentials FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own events"
  ON public.app_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own events"
  ON public.app_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own history"
  ON public.draft_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own history"
  ON public.draft_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS art_drafts_user_created_idx ON public.art_drafts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS art_drafts_user_publication_idx ON public.art_drafts (user_id, publication_status);
CREATE INDEX IF NOT EXISTS art_drafts_user_quality_idx ON public.art_drafts (user_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS app_events_user_created_idx ON public.app_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draft_history_draft_created_idx ON public.draft_history (draft_id, created_at DESC);

DROP TRIGGER IF EXISTS update_api_desks_updated_at ON public.api_desks;
CREATE TRIGGER update_api_desks_updated_at
  BEFORE UPDATE ON public.api_desks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_credentials_updated_at ON public.user_credentials;
CREATE TRIGGER update_user_credentials_updated_at
  BEFORE UPDATE ON public.user_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
