-- 016: optional profile answers (age band, gender, state, goal, diet), kept separate from sign-in.
-- Finishing all five earns the person 5 extra AI searches a day. The database, not the app, decides
-- whether a profile counts as complete, so the bonus cannot be faked from the browser.

CREATE TABLE IF NOT EXISTS public.user_profile (
  user_id      UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  age_band     TEXT CHECK (age_band IN ('18-24','25-34','35-44','45-54','55+')),
  gender       TEXT CHECK (gender IN ('female','male','other','prefer_not')),
  state        TEXT CHECK (char_length(state) <= 40),
  goal         TEXT CHECK (goal IN ('lose_fat','maintain','build_muscle','blood_sugar','eat_healthier')),
  diet         TEXT CHECK (diet IN ('eggetarian','vegetarian','vegan','jain','non_veg')),
  consent_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profile_select_own ON public.user_profile;
DROP POLICY IF EXISTS user_profile_insert_own ON public.user_profile;
DROP POLICY IF EXISTS user_profile_update_own ON public.user_profile;
DROP POLICY IF EXISTS user_profile_delete_own ON public.user_profile;
CREATE POLICY user_profile_select_own ON public.user_profile FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY user_profile_insert_own ON public.user_profile FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_profile_update_own ON public.user_profile FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY user_profile_delete_own ON public.user_profile FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- Whatever the app sends, completed_at is set here: all five answers present and consent given.
CREATE OR REPLACE FUNCTION public.user_profile_stamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.age_band IS NOT NULL AND NEW.gender IS NOT NULL AND NEW.state IS NOT NULL
     AND NEW.goal IS NOT NULL AND NEW.diet IS NOT NULL AND NEW.consent_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL THEN
      NEW.completed_at := OLD.completed_at;
    ELSE
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_profile_stamp ON public.user_profile;
CREATE TRIGGER user_profile_stamp BEFORE INSERT OR UPDATE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.user_profile_stamp();

-- Admin view: totals only. Any group of fewer than 10 people is merged into "Small groups".
CREATE OR REPLACE FUNCTION public.admin_demographics()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r JSONB; fields JSONB;
BEGIN
  WITH habit AS (
    SELECT DISTINCT user_id FROM (SELECT user_id, date_trunc('week', log_date) AS w FROM public.daily_logs
                                  GROUP BY 1, 2 HAVING COUNT(DISTINCT log_date) >= 4) z),
  logged AS (SELECT DISTINCT user_id FROM public.daily_logs),
  long AS (
    SELECT 'age_band' AS f, age_band AS k, user_id FROM public.user_profile WHERE age_band IS NOT NULL
    UNION ALL SELECT 'gender', gender, user_id FROM public.user_profile WHERE gender IS NOT NULL
    UNION ALL SELECT 'state',  state,  user_id FROM public.user_profile WHERE state  IS NOT NULL
    UNION ALL SELECT 'goal',   goal,   user_id FROM public.user_profile WHERE goal   IS NOT NULL
    UNION ALL SELECT 'diet',   diet,   user_id FROM public.user_profile WHERE diet   IS NOT NULL),
  g AS (
    SELECT f, k, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE user_id IN (SELECT user_id FROM logged)) AS logged,
           COUNT(*) FILTER (WHERE user_id IN (SELECT user_id FROM habit))  AS habit
    FROM long GROUP BY f, k),
  s AS (
    SELECT f, CASE WHEN n >= 10 THEN k ELSE 'Small groups (under 10 people)' END AS k,
           SUM(n)::INT AS n, SUM(logged)::INT AS logged, SUM(habit)::INT AS habit
    FROM g GROUP BY 1, 2)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'field', f, 'k', k, 'n', n,
           'logged', CASE WHEN n >= 10 THEN logged END, 'habit', CASE WHEN n >= 10 THEN habit END)
         ORDER BY f, n DESC), '[]'::JSONB) INTO fields FROM s;

  SELECT jsonb_build_object(
    'users',     (SELECT COUNT(*) FROM public.users),
    'started',   (SELECT COUNT(*) FROM public.user_profile),
    'completed', (SELECT COUNT(*) FROM public.user_profile WHERE completed_at IS NOT NULL),
    'fields',    fields) INTO r;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_demographics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_demographics() TO service_role;
