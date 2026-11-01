-- NutriSmart 2.1 / P6: two more optional check-in answers. ADDITIVE ONLY. Existing rows and the old check-in keep working.
ALTER TABLE public.daily_checkins ADD COLUMN IF NOT EXISTS fullness  SMALLINT CHECK (fullness BETWEEN 1 AND 5);
ALTER TABLE public.daily_checkins ADD COLUMN IF NOT EXISTS digestion TEXT CHECK (digestion IN ('comfortable','heavy','upset'));
-- The old rule "at least one of the five answers" now also counts the two new answers.
ALTER TABLE public.daily_checkins DROP CONSTRAINT IF EXISTS daily_checkins_check;
ALTER TABLE public.daily_checkins ADD CONSTRAINT daily_checkins_check
  CHECK (energy IS NOT NULL OR mood IS NOT NULL OR hunger IS NOT NULL OR sleep IS NOT NULL OR stress IS NOT NULL OR fullness IS NOT NULL OR digestion IS NOT NULL);
