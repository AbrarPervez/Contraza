CREATE TABLE public.lease_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT 'Untitled lease',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lease_drafts TO authenticated;
GRANT ALL ON public.lease_drafts TO service_role;
ALTER TABLE public.lease_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own drafts" ON public.lease_drafts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.review_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT 'New review',
  contract_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_threads TO authenticated;
GRANT ALL ON public.review_threads TO service_role;
ALTER TABLE public.review_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own threads" ON public.review_threads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.review_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.review_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.review_messages(thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_messages TO authenticated;
GRANT ALL ON public.review_messages TO service_role;
ALTER TABLE public.review_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.review_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);