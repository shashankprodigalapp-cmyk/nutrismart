-- =============================================================================
-- NutriSmart: 006_vector_cache.sql
-- TASK 1 — Cost & Latency Optimization: Semantic AI-result cache
-- Run after 005_payment_submissions.sql
--
-- Purpose: every Gemini/Claude food lookup costs money and ~1–3s latency.
-- Most users search the same ~500 Indian foods with slightly different
-- wording ("paneer bhurji", "bhurji paneer", "paneer ki bhurji").
-- A pgvector cosine-similarity cache answers repeats in <50ms for ₹0.
-- =============================================================================

-- ── 1. Enable pgvector ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Semantic cache table ──────────────────────────────────────────────────
-- Gemini text-embedding-004 outputs 768-dim vectors.
CREATE TABLE IF NOT EXISTS public.food_semantic_cache (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_name         TEXT NOT NULL,               -- normalized query that produced this
  embedding         vector(768) NOT NULL,
  nutritional_jsonb JSONB NOT NULL,              -- exact AI response payload
  source            TEXT NOT NULL DEFAULT 'gemini'
                    CHECK (source IN ('gemini','claude','popular_custom')),
  hit_count         INTEGER NOT NULL DEFAULT 0,  -- how many times cache served this
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_hit_at       TIMESTAMPTZ
);

-- Same normalized name never cached twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_cache_name
  ON public.food_semantic_cache (lower(food_name));

-- ── 3. ANN index — IVFFlat cosine ────────────────────────────────────────────
-- lists=100 is right for <100k rows. Revisit at scale (see maintenance notes).
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
  ON public.food_semantic_cache
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── 4. RLS: service-role only ────────────────────────────────────────────────
-- Clients never touch this table. All reads/writes via Netlify functions
-- using SUPABASE_SERVICE_ROLE_KEY. No policies = no client access.
ALTER TABLE public.food_semantic_cache ENABLE ROW LEVEL SECURITY;

-- ── 5. match_cached_food RPC ─────────────────────────────────────────────────
-- Single round-trip similarity lookup. Returns best match above threshold.
-- Cosine distance operator is <=> ; similarity = 1 - distance.
CREATE OR REPLACE FUNCTION public.match_cached_food(
  p_embedding vector(768),
  p_threshold FLOAT DEFAULT 0.9
)
RETURNS TABLE (
  id                UUID,
  food_name         TEXT,
  nutritional_jsonb JSONB,
  similarity        FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.food_name,
    c.nutritional_jsonb,
    (1 - (c.embedding <=> p_embedding))::FLOAT AS similarity
  FROM public.food_semantic_cache c
  WHERE (1 - (c.embedding <=> p_embedding)) > p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT 1;
END;
$$;

-- ── 6. record_cache_hit RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_cache_hit(p_cache_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.food_semantic_cache
  SET hit_count = hit_count + 1, last_hit_at = NOW()
  WHERE id = p_cache_id;
$$;

-- =============================================================================
-- MAINTENANCE STRATEGY — "Weakest Link" mitigation (see blueprint)
--
-- IVFFlat indexes degrade as rows are inserted after index creation, because
-- new vectors land in existing cluster lists that were computed at build time.
-- Symptoms at scale: p95 similarity query latency climbing past ~200ms.
--
-- Monthly maintenance (run in SQL editor or pg_cron):
--
--   -- 1. Reclaim dead tuples & refresh planner stats
--   VACUUM ANALYZE public.food_semantic_cache;
--
--   -- 2. Rebuild the ANN index with lists tuned to current size.
--   --    Rule of thumb: lists ≈ rows / 1000 (min 100, max 2000)
--   REINDEX INDEX CONCURRENTLY idx_semantic_cache_embedding;
--
--   -- 3. At >100k rows, recreate with more lists:
--   -- DROP INDEX idx_semantic_cache_embedding;
--   -- CREATE INDEX idx_semantic_cache_embedding
--   --   ON public.food_semantic_cache
--   --   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 300);
--
--   -- 4. Evict stale entries never hit in 6 months (cache hygiene):
--   -- DELETE FROM public.food_semantic_cache
--   -- WHERE hit_count = 0 AND created_at < NOW() - INTERVAL '6 months';
-- =============================================================================
