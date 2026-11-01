-- SCORECARD: checks every module against answers worked out independently from the raw rows.
-- Run after 01_seed_100.sql (and optionally 02_link_me.sql). Safe: it only reads, apart from refreshing weekly and monthly summary tables.
-- The last result table lists every check with PASS or FAIL. The first row is the total.
-- Works in the Supabase SQL Editor (it needs the elevated role the editor runs as).

DROP TABLE IF EXISTS pg_temp.sim_results;
CREATE OR REPLACE FUNCTION pg_temp.simn(email TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN email ~ '^p[0-9]{3}@sim\.nutrismart\.invalid$' THEN substring(email from 2 for 3)::int END $f$;
CREATE TEMP TABLE sim_results (n SERIAL, module TEXT, check_name TEXT, expected TEXT, actual TEXT, ok BOOLEAN);

DROP TABLE IF EXISTS pg_temp.exp_day, pg_temp.exp_week;
DROP VIEW IF EXISTS pg_temp.sim;

DO $score$
DECLARE
  d0 DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  wk DATE := date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::date;   -- Monday of this week
  lwk DATE := date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::date - 7;
  mth DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  pmth DATE := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
  v BIGINT; w BIGINT; r RECORD; coach UUID; cj INT; own BIGINT; other BIGINT; txt TEXT;

BEGIN
  -- helper closure via temp view of sim people
  CREATE TEMP VIEW sim AS
    SELECT u.id, pg_temp.simn(u.email) AS n, regexp_replace(u.name, '^Sim [0-9]+ ', '') AS arch, u.target_cal, u.target_protein, u.target_fat
      FROM public.users u WHERE u.email ~ '^p[0-9]{3}@sim\.nutrismart\.invalid$';

  -- ───── 1. The simulated data itself ─────
  SELECT COUNT(*) INTO v FROM sim;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'people created', '100', v::text, v = 100);
  SELECT COUNT(*) INTO v FROM public.coach_profiles WHERE display_name LIKE 'Sim Coach %';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'sim coaches created', '5', v::text, v = 5);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'silent' AND EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = s.id);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'silent people have no meals', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'steady'
     AND (SELECT COUNT(DISTINCT log_date) FROM public.daily_logs l WHERE l.user_id = s.id AND l.log_date > d0 - 7) <> 7;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'steady people logged all of the last 7 days (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'drifting'
     AND (SELECT COUNT(DISTINCT log_date) FROM public.daily_logs l WHERE l.user_id = s.id AND l.log_date > d0 - 7) <> 4;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'drifting people logged 4 of the last 7 days (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'sparse'
     AND (SELECT COUNT(DISTINCT log_date) FROM public.daily_logs l WHERE l.user_id = s.id AND l.log_date > d0 - 7) <> 2;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Data', 'sparse people logged 2 of the last 7 days (exceptions)', '0', v::text, v = 0);

  -- ───── 2. Daily totals and adherence: recomputed independently from raw meals ─────
  CREATE TEMP TABLE exp_day AS
  WITH tot AS (
    SELECT l.user_id, l.log_date AS day, SUM(l.cal) c, SUM(l.protein) p, SUM(l.fat) f, COUNT(*) items
      FROM public.daily_logs l JOIN sim s ON s.id = l.user_id GROUP BY 1, 2),
  tg AS (
    SELECT t.*, s.target_cal AS own_cal, s.target_protein AS own_pro, s.target_fat AS own_fat,
           (SELECT nt.calories FROM public.nutrition_targets nt WHERE nt.client_id = t.user_id AND nt.effective_from < ((t.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY nt.effective_from DESC LIMIT 1) AS co_cal,
           (SELECT nt.protein_g FROM public.nutrition_targets nt WHERE nt.client_id = t.user_id AND nt.effective_from < ((t.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY nt.effective_from DESC LIMIT 1) AS co_pro,
           (SELECT nt.fat_g FROM public.nutrition_targets nt WHERE nt.client_id = t.user_id AND nt.effective_from < ((t.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY nt.effective_from DESC LIMIT 1) AS co_fat
      FROM tot t JOIN sim s ON s.id = t.user_id),
  eff AS (SELECT user_id, day, c, p, f, items, COALESCE(co_cal, own_cal) tc, COALESCE(co_pro, own_pro) tp, COALESCE(co_fat, own_fat) tf FROM tg),
  r AS (SELECT *, c / tc AS rc, f / NULLIF(tf, 0) AS rf FROM eff)
  SELECT user_id, day, c, p, f, items, tc, tp, tf,
    CASE WHEN rc BETWEEN 0.9 AND 1.1 THEN 100 WHEN rc <= 0.5 OR rc >= 1.5 THEN 0 WHEN rc < 0.9 THEN ROUND(((rc - 0.5) / 0.4) * 100, 1) ELSE ROUND(((1.5 - rc) / 0.4) * 100, 1) END AS exp_cal_adh,
    LEAST(ROUND(p / NULLIF(tp, 0) * 100, 1), 100) AS exp_pro_adh
  FROM r;

  SELECT COUNT(*) INTO v FROM exp_day;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'person-days with meals to check', '> 1000', v::text, v > 1000);
  SELECT COUNT(*) INTO v FROM exp_day e LEFT JOIN public.daily_nutrition_metrics m ON m.user_id = e.user_id AND m.day = e.day
     WHERE m.user_id IS NULL OR ABS(m.calories - e.c) > 0.2 OR ABS(m.protein_g - e.p) > 0.2 OR m.items <> e.items;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'stored daily calories, protein and item counts match the meals (mismatches)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e LEFT JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day
     WHERE a.user_id IS NULL OR a.calorie_adherence IS NULL OR ABS(a.calorie_adherence - e.exp_cal_adh) > 0.15;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'calorie adherence equals the independent calculation (mismatches)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e LEFT JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day
     WHERE a.protein_adherence IS NULL OR ABS(a.protein_adherence - e.exp_pro_adh) > 0.15;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'protein adherence equals the independent calculation (mismatches)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.daily_adherence a JOIN sim s ON s.id = a.user_id
     WHERE a.logging_adherence = 0 AND a.calorie_adherence IS NOT NULL;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'days with no meals show missing, not a score (violations)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e JOIN sim s ON s.id = e.user_id WHERE s.arch = 'over_eater' AND s.n % 6 <> 0 AND e.exp_cal_adh <> 0;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'over-eaters score 0 on calories every day (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day JOIN sim s ON s.id = e.user_id
     WHERE s.arch = 'low_protein_under' AND s.n % 6 <> 0 AND ABS(a.protein_adherence - 40) > 1.5;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'low-protein people score about 40% on protein (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day JOIN sim s ON s.id = e.user_id
     WHERE s.arch = 'steady' AND s.n % 6 <> 0 AND a.calorie_adherence < 100;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'steady people on target score 100 on calories (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day JOIN sim s ON s.id = e.user_id
     WHERE s.arch = 'weekend_binge' AND s.n % 6 <> 0 AND EXTRACT(dow FROM e.day) IN (0, 6) AND a.calorie_adherence <> 0;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'weekend binges score 0 on Saturday and Sunday (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM exp_day e JOIN public.daily_adherence a ON a.user_id = e.user_id AND a.day = e.day
     WHERE a.target_cal IS DISTINCT FROM e.tc;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Adherence', 'coach-set targets override the person''s own targets (mismatches)', '0', v::text, v = 0);

  -- ───── 3. Weekly and monthly summaries ─────
  FOR r IN SELECT id FROM sim LOOP
    PERFORM public.compute_weekly_metrics(r.id, wk);
    PERFORM public.compute_weekly_metrics(r.id, lwk);
    PERFORM public.compute_monthly_metrics(r.id, mth);
    PERFORM public.compute_monthly_metrics(r.id, pmth);
  END LOOP;
  CREATE TEMP TABLE exp_week AS
    SELECT s.id AS user_id, ws.ws,
           (SELECT COUNT(DISTINCT l.log_date) FROM public.daily_logs l WHERE l.user_id = s.id AND l.log_date BETWEEN ws.ws AND LEAST(ws.ws + 6, d0)) AS days_logged,
           (SELECT ROUND(AVG(t.c), 1) FROM exp_day t WHERE t.user_id = s.id AND t.day BETWEEN ws.ws AND LEAST(ws.ws + 6, d0)) AS avg_cal,
           (SELECT ROUND(AVG(t.p), 1) FROM exp_day t WHERE t.user_id = s.id AND t.day BETWEEN ws.ws AND LEAST(ws.ws + 6, d0)) AS avg_pro
      FROM sim s CROSS JOIN (VALUES (wk), (lwk)) ws(ws);
  SELECT COUNT(*) INTO v FROM exp_week e JOIN public.weekly_metrics m ON m.user_id = e.user_id AND m.week_start = e.ws
     WHERE m.days_logged <> e.days_logged OR m.avg_calories IS DISTINCT FROM e.avg_cal OR m.avg_protein IS DISTINCT FROM e.avg_pro;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Weekly review', 'weekly days logged and averages match the raw meals, this and last week (mismatches)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.weekly_metrics m JOIN sim s ON s.id = m.user_id WHERE m.week_start IN (wk, lwk);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Weekly review', 'weekly rows exist for every person and both weeks', '200', v::text, v = 200);
  SELECT COUNT(*) INTO v FROM public.weekly_metrics m JOIN sim s ON s.id = m.user_id WHERE s.arch = 'silent' AND m.days_logged <> 0;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Weekly review', 'silent people show 0 days logged (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.weekly_metrics m JOIN sim s ON s.id = m.user_id WHERE s.arch = 'silent' AND (m.avg_calories IS NOT NULL OR m.calorie_adherence IS NOT NULL);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Weekly review', 'silent people have no calorie average, not a zero (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.weekly_metrics m JOIN sim s ON s.id = m.user_id WHERE m.week_start = wk AND m.days_elapsed <> (d0 - wk + 1);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Weekly review', 'this week counts only the days that have happened (exceptions)', '0', v::text, v = 0);

  SELECT COUNT(*) INTO v FROM public.monthly_metrics m JOIN sim s ON s.id = m.user_id
     WHERE m.month_start = pmth AND m.days_logged <> (SELECT COUNT(DISTINCT l.log_date) FROM public.daily_logs l WHERE l.user_id = s.id AND l.log_date >= pmth AND l.log_date < mth);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Monthly review', 'last month days logged match the raw meals (mismatches)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.monthly_metrics m JOIN sim s ON s.id = m.user_id WHERE m.month_start IN (mth, pmth);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Monthly review', 'monthly rows exist for every person and both months', '200', v::text, v = 200);

  -- ───── 4. Check-ins, feelings, energy ─────
  SELECT COUNT(*) INTO v FROM public.daily_checkins c JOIN sim s ON s.id = c.user_id WHERE s.arch = 'low_mood' AND (c.mood > 2 OR c.energy > 2);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Check-ins', 'low-mood people rate mood and energy 1 to 2 every day (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(DISTINCT c.user_id) INTO v FROM public.daily_checkins c JOIN sim s ON s.id = c.user_id WHERE s.arch = 'low_mood';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Check-ins', 'low-mood people with check-ins', '6', v::text, v = 6);
  SELECT COUNT(*) INTO v FROM public.meal_feelings f JOIN sim s ON s.id = f.user_id WHERE s.arch <> 'pattern_rich';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Check-ins', 'meal feelings exist only for pattern people', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM public.energy_logs e JOIN sim s ON s.id = e.user_id WHERE s.arch = 'energy_dropper' AND e.log_date > d0 - 7 AND e.level <> 'low';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Energy', 'energy droppers are low every day this week (exceptions)', '0', v::text, v = 0);

  -- ───── 5. Patterns ─────
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'pattern_rich'
     AND (SELECT COUNT(*) FROM public.meal_feelings f WHERE f.user_id = s.id AND f.meal = 'lunch') <> 21;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Patterns', 'pattern people have 21 lunch feelings (exceptions)', '0', v::text, v = 0);
  -- Heavy lunches (over 700 kcal) should be followed by "lower" about 5 times in 6; light lunches almost never
  WITH x AS (
    SELECT f.user_id, l.cal >= 700 AS big, f.energy_change
      FROM public.meal_feelings f
      JOIN (SELECT user_id, log_date, SUM(cal) cal FROM public.daily_logs WHERE meal = 'lunch' GROUP BY 1, 2) l ON l.user_id = f.user_id AND l.log_date = f.log_date
      JOIN sim s ON s.id = f.user_id WHERE f.meal = 'lunch')
  SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE big AND energy_change = 'lower') / NULLIF(COUNT(*) FILTER (WHERE big), 0)),
         ROUND(100.0 * COUNT(*) FILTER (WHERE NOT big AND energy_change = 'lower') / NULLIF(COUNT(*) FILTER (WHERE NOT big), 0))
    INTO v, w FROM x;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Patterns', 'planted pattern: share of big lunches followed by lower energy', '75 to 100', v::text, v BETWEEN 75 AND 100);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Patterns', 'planted pattern: share of light lunches followed by lower energy', '0 to 10', w::text, w BETWEEN 0 AND 10);

  -- ───── 6. Experiments ─────
  SELECT COUNT(*) INTO v FROM public.experiments e JOIN sim s ON s.id = e.user_id;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Experiments', 'experiments created', '6', v::text, v = 6);
  SELECT COUNT(*) INTO v FROM public.experiments e JOIN sim s ON s.id = e.user_id WHERE e.status = 'active';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Experiments', 'active experiments', '4', v::text, v = 4);
  SELECT COUNT(*) INTO v FROM (SELECT user_id FROM public.experiments e JOIN sim s ON s.id = e.user_id WHERE e.status = 'active' GROUP BY 1 HAVING COUNT(*) > 1) q;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Experiments', 'nobody has two active experiments', '0', v::text, v = 0);

  -- ───── 7. Flexible meals ─────
  SELECT COUNT(*) INTO v FROM public.flexible_meals f JOIN sim s ON s.id = f.user_id;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Flexible meals', 'flexible meals created', '25', v::text, v = 25);
  SELECT COUNT(*) INTO v FROM public.weekly_metrics m JOIN sim s ON s.id = m.user_id WHERE m.week_start IN (wk, lwk) AND s.n % 10 = 4 AND m.flexible_planned < 1 AND
     EXISTS (SELECT 1 FROM public.flexible_meals f WHERE f.user_id = s.id AND f.planned_for BETWEEN m.week_start AND m.week_start + 6);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Flexible meals', 'weekly summary counts the planned flexible meals (exceptions)', '0', v::text, v = 0);

  -- ───── 8. Timeline ─────
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch <> 'silent' AND NOT EXISTS (SELECT 1 FROM public.timeline_events t WHERE t.user_id = s.id);
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Timeline', 'everyone who logged anything has timeline events (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.arch = 'silent' AND EXISTS (SELECT 1 FROM public.timeline_events t WHERE t.user_id = s.id AND t.source_table = 'daily_logs');
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Timeline', 'silent people have no meal events', '0', v::text, v = 0);

  -- ───── 9. Plans ─────
  SELECT COUNT(*) INTO v FROM sim s WHERE public.effective_client_plan(s.id) = 'pro';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Plans', 'people on Pro (14 paid + 3 provisional)', '17', v::text, v = 17);
  SELECT COUNT(*) INTO v FROM sim s WHERE s.n % 23 = 0 AND s.n % 7 <> 0 AND public.effective_client_plan(s.id) <> 'free';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Plans', 'expired Pro is treated as free (exceptions)', '0', v::text, v = 0);
  SELECT COUNT(*) INTO v FROM sim s WHERE public.effective_client_plan(s.id) = 'pro' AND (public.entitlements_for(s.id)->'entitlements'->>'ai_daily_limit')::int <> 200;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Plans', 'Pro people get the Pro AI limit of 200 (exceptions)', '0', v::text, v = 0);

  -- ───── 10. Reminder preferences ─────
  SELECT COUNT(*) INTO v FROM public.nudge_preferences p JOIN sim s ON s.id = p.user_id;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Nudges', 'people with reminder preferences', '25', v::text, v = 25);

  -- ───── 11. Coach dashboard: what each coach may and may not see ─────
  FOR cj IN 1..3 LOOP
    coach := md5('nutrismart-sim-coach-' || cj)::uuid;
    PERFORM set_config('request.jwt.claim.sub', coach::text, false);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7);
    SELECT COUNT(*) INTO w FROM public.coach_client_relationships x WHERE x.coach_id = coach AND x.status IN ('active', 'paused');
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Coach dashboard', 'Sim Coach ' || chr(64 + cj) || ' sees exactly their active and paused clients', w::text, v::text, v = w);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d JOIN public.coach_client_relationships x ON x.id = d.relationship_id
       WHERE x.status = 'ended';
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Coach dashboard', 'Sim Coach ' || chr(64 + cj) || ' does not see ended links', '0', v::text, v = 0);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d
       WHERE NOT COALESCE((d.share_scope->>'food')::boolean, FALSE) AND (d.days_logged IS NOT NULL OR d.avg_cal IS NOT NULL OR d.avg_protein IS NOT NULL);
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Privacy', 'Sim Coach ' || chr(64 + cj) || ': no food numbers where food is not shared (leaks)', '0', v::text, v = 0);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d
       WHERE NOT COALESCE((d.share_scope->>'energy')::boolean, FALSE) AND (d.energy_checkins IS NOT NULL OR d.energy_avg IS NOT NULL);
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Privacy', 'Sim Coach ' || chr(64 + cj) || ': no energy numbers where energy is not shared (leaks)', '0', v::text, v = 0);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d WHERE d.link_status = 'paused' AND (d.days_logged IS NOT NULL OR d.energy_avg IS NOT NULL);
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Privacy', 'Sim Coach ' || chr(64 + cj) || ': paused clients show no numbers (leaks)', '0', v::text, v = 0);
    -- steady coached client: averages close to target
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d JOIN public.users u ON u.id = d.client_id
       WHERE u.name LIKE '% steady' AND pg_temp.simn(u.email) % 6 <> 0 AND d.link_status = 'active' AND COALESCE((d.share_scope->>'food')::boolean, FALSE)
         AND ABS(d.avg_cal / d.target_cal - 1) > 0.06;
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Coach dashboard', 'Sim Coach ' || chr(64 + cj) || ': steady clients average within 6% of target (exceptions)', '0', v::text, v = 0);
    SELECT COUNT(*) INTO v FROM public.coach_dashboard(7) d JOIN public.users u ON u.id = d.client_id
       WHERE pg_temp.simn(u.email) % 6 = 0 AND d.target_cal <> u.target_cal + 200;
    INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Coach dashboard', 'Sim Coach ' || chr(64 + cj) || ': shows the coach-set target where the coach changed it (exceptions)', '0', v::text, v = 0);
  END LOOP;

  -- ───── 12. Row-level security with real database roles ─────
  -- A sim person sees only their own rows; a sim coach sees a client's rows only for the categories shared.
  FOR r IN SELECT s.id, s.n FROM sim s WHERE s.n IN (1, 16, 70, 82) LOOP
    PERFORM set_config('request.jwt.claim.sub', r.id::text, false);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO own FROM public.daily_logs WHERE user_id = r.id;
    SELECT COUNT(*) INTO other FROM public.daily_logs WHERE user_id <> r.id;
    RESET ROLE;
    INSERT INTO sim_results(module, check_name, expected, actual, ok)
      VALUES ('Privacy', 'person ' || r.n || ' sees only their own meals', 'own > 0, others 0', own || ' own, ' || other || ' others', own > 0 AND other = 0);
  END LOOP;
  -- coached client whose coach may NOT see food (person number ending in 2 among multiples of 3: 12, 42, 72, 102...): food rows hidden, energy rows visible
  FOR r IN SELECT s.id, s.n, x.coach_id FROM sim s JOIN public.coach_client_relationships x ON x.client_id = s.id AND x.status = 'active'
            WHERE s.n % 10 = 2 AND s.n % 3 = 0 AND s.n % 15 <> 0 AND s.n % 17 <> 0 AND x.coach_id IN (SELECT user_id FROM public.coach_profiles WHERE display_name LIKE 'Sim Coach %') LOOP
    PERFORM set_config('request.jwt.claim.sub', r.coach_id::text, false);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO own FROM public.daily_logs WHERE user_id = r.id;
    SELECT COUNT(*) INTO other FROM public.energy_logs WHERE user_id = r.id;
    RESET ROLE;
    INSERT INTO sim_results(module, check_name, expected, actual, ok)
      VALUES ('Privacy', 'coach of person ' || r.n || ' (energy only): meals hidden, energy visible', 'meals 0, energy > 0 (or none logged)', own || ' meals, ' || other || ' energy',
              own = 0 AND (other > 0 OR NOT EXISTS (SELECT 1 FROM public.energy_logs WHERE user_id = r.id)));
  END LOOP;
  -- client sharing food with their coach: coach can read the meals
  FOR r IN SELECT s.id, s.n, x.coach_id FROM sim s JOIN public.coach_client_relationships x ON x.client_id = s.id AND x.status = 'active'
            WHERE s.n % 10 = 3 AND s.n % 3 = 0 AND s.n % 15 <> 0 AND s.n % 17 <> 0 AND s.arch <> 'silent' LOOP
    PERFORM set_config('request.jwt.claim.sub', r.coach_id::text, false);
    SET LOCAL ROLE authenticated;
    SELECT COUNT(*) INTO own FROM public.daily_logs WHERE user_id = r.id;
    SELECT COUNT(*) INTO other FROM public.daily_checkins WHERE user_id = r.id;
    RESET ROLE;
    INSERT INTO sim_results(module, check_name, expected, actual, ok)
      VALUES ('Privacy', 'coach of person ' || r.n || ' (mood not shared): meals visible, check-ins hidden', 'meals > 0, check-ins 0', own || ' meals, ' || other || ' check-ins', own > 0 AND other = 0);
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', false);

  -- ───── 13. Admin numbers ─────
  SELECT (public.admin_platform_metrics()->'users'->>'total')::bigint INTO v;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Admin', 'total users includes the 105 simulated accounts', '>= 105', v::text, v >= 105);
  SELECT (public.admin_platform_metrics()->'coaches'->>'active')::bigint INTO v;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Admin', 'active coaches include the 3 simulated', '>= 3', v::text, v >= 3);
  SELECT (public.admin_platform_metrics()->'coaches'->>'pending')::bigint INTO v;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Admin', 'a coach is waiting for approval', '>= 1', v::text, v >= 1);
  SELECT (public.admin_platform_metrics()->'coaches'->>'suspended')::bigint INTO v;
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Admin', 'a coach is suspended', '>= 1', v::text, v >= 1);
  SELECT (public.admin_v2_analytics(30)->'adoption'->>'daily_checkins')::bigint INTO v;
  SELECT COUNT(DISTINCT user_id) INTO w FROM public.daily_checkins WHERE created_at >= now() - interval '30 days';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Analytics', 'people using check-ins matches a direct count', w::text, v::text, v = w);
  SELECT (public.admin_v2_analytics(30)->'adoption'->>'flexible_meals')::bigint INTO v;
  SELECT COUNT(DISTINCT user_id) INTO w FROM public.flexible_meals WHERE created_at >= now() - interval '30 days';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Analytics', 'people using flexible meals matches a direct count', w::text, v::text, v = w);
  SELECT (public.admin_v2_analytics(30)->'coach'->>'has_active_client')::bigint INTO v;
  SELECT COUNT(DISTINCT coach_id) INTO w FROM public.coach_client_relationships WHERE status = 'active';
  INSERT INTO sim_results(module, check_name, expected, actual, ok) VALUES ('Analytics', 'coaches with an active client matches a direct count', w::text, v::text, v = w);
END
$score$;

SELECT 0 AS n, 'TOTAL' AS module, COUNT(*) || ' checks' AS check_name, '' AS expected, COUNT(*) FILTER (WHERE ok) || ' passed, ' || COUNT(*) FILTER (WHERE NOT ok) || ' failed' AS actual,
       CASE WHEN COUNT(*) FILTER (WHERE NOT ok) = 0 THEN 'PASS' ELSE 'FAIL' END AS result FROM sim_results
UNION ALL
SELECT n, module, check_name, expected, actual, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END FROM sim_results
ORDER BY n;
