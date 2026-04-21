
CREATE TABLE public.art_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  artist TEXT NOT NULL,
  measures TEXT NOT NULL,
  price TEXT NOT NULL,
  observations TEXT,
  image_url TEXT,
  title TEXT,
  description TEXT,
  scene_type TEXT,
  condition INTEGER DEFAULT 3,
  condition_details TEXT DEFAULT 'Buen estado general',
  category TEXT DEFAULT 'Arte',
  id_section INTEGER DEFAULT 178,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.art_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read drafts" ON public.art_drafts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert drafts" ON public.art_drafts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update drafts" ON public.art_drafts FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete drafts" ON public.art_drafts FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_art_drafts_updated_at
  BEFORE UPDATE ON public.art_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
