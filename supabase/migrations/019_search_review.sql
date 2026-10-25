-- 019: search review. Words the AI said are not foods are collected here for the admin to block (or dismiss).
CREATE TABLE IF NOT EXISTS public.search_review (
  term       text PRIMARY KEY,
  source     text NOT NULL DEFAULT 'ai',
  hits       integer NOT NULL DEFAULT 1,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'blocked', 'dismissed')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
ALTER TABLE public.search_review ENABLE ROW LEVEL SECURITY;  -- no policies: only the server (service role) can read or write

CREATE OR REPLACE FUNCTION public.note_search_term(p_term text, p_source text DEFAULT 'ai')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.search_review (term, source) VALUES (left(lower(trim(p_term)), 80), p_source)
  ON CONFLICT (term) DO UPDATE SET hits = public.search_review.hits + 1, last_seen = now();
$$;
REVOKE ALL ON FUNCTION public.note_search_term(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.note_search_term(text, text) TO service_role;
