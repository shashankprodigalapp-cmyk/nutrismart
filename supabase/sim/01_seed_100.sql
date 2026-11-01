-- NutriSmart simulation: 100 made-up people, two weeks of data each (3 weeks for pattern people).
-- SAFE TO REMOVE: every person has an email ending @sim.nutrismart.invalid, cannot log in, and 03_cleanup.sql deletes them all.
-- Deterministic: running it twice on a clean database gives identical data. It refuses to run if people are already seeded.
-- Run in the Supabase SQL Editor. Takes a few seconds.
--
-- Behaviour types (person number -> type):
--   1-15 steady          16-23 over_eater       24-31 low_protein_under   32-39 weekend_binge
--   40-49 drifting       50-57 sparse           58-65 silent              66-69 new_today
--   70-75 low_mood       76-81 energy_dropper   82-93 pattern_rich        94-100 mixed
-- Layers on top: pro (every 7th), expired pro (every 23rd), provisional pro (every 29th), coached (every 3rd, by 3 sim coaches),
--   flexible meals (people ending in 4), experiments (pattern people), evening reminders (every 4th from 1).

DO $seed$
DECLARE
  d0 DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  i INT; off INT; j INT; maxoff INT;
  arch TEXT; uid UUID; day DATE; dow INT;
  tcal INT; tpro INT; tfat INT; tier INT;
  logged BOOLEAN; m NUMERIC; pm NUMERIC; h BIGINT; jit NUMERIC;
  cal_total INT; pro_total INT; shares NUMERIC[]; meals TEXT[] := ARRAY['breakfast','lunch','snack','dinner'];
  names TEXT[]; ports TEXT[]; pick INT;
  cal_j INT; pro_j INT; fat_j INT; carb_j INT; used_cal INT; used_pro INT; nmeals INT;
  ts TIMESTAMPTZ; mtimes INT[][] := ARRAY[[8,30],[13,15],[17,0],[20,30]];
  heavy BOOLEAN; lvl TEXT; ec TEXT; fl TEXT; mc TEXT; mood INT; en INT;
  coach_ids UUID[]; cidx INT; scope JSONB; rstatus TEXT;
  n_existing INT;
  b_names TEXT[] := ARRAY['Poha','Egg bhurji','Idli sambar','Upma'];  b_ports TEXT[] := ARRAY['1 plate','2 eggs','3 idli','1 bowl'];
  l_names TEXT[] := ARRAY['Dal rice','Roti sabzi','Egg curry rice','Paneer wrap']; l_ports TEXT[] := ARRAY['1 plate','3 roti','1 plate','1 wrap'];
  s_names TEXT[] := ARRAY['Roasted chana','Fruit bowl','Chai and biscuits','Fried samosa']; s_ports TEXT[] := ARRAY['1 handful','1 bowl','1 cup','2 pieces'];
  d_names TEXT[] := ARRAY['Khichdi','Paneer bhurji roti','Dal roti','Egg fried rice']; d_ports TEXT[] := ARRAY['1 bowl','3 roti','3 roti','1 plate'];
  exp_start DATE; exp_status TEXT;
BEGIN
  SELECT COUNT(*) INTO n_existing FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid';
  IF n_existing > 0 THEN RAISE EXCEPTION 'Simulation people already exist (%). Run 03_cleanup.sql first.', n_existing; END IF;

  -- Three active sim coaches, one waiting for approval, one suspended
  FOR j IN 1..5 LOOP
    uid := md5('nutrismart-sim-coach-' || j)::uuid;
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'coach' || j || '@sim.nutrismart.invalid', '', now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('name', 'Sim Coach ' || chr(64 + j)), now(), now());
    INSERT INTO public.coach_profiles (user_id, display_name, credentials, status, approved_at)
    VALUES (uid, 'Sim Coach ' || chr(64 + j), 'Simulation only', CASE WHEN j <= 3 THEN 'active' WHEN j = 4 THEN 'pending' ELSE 'suspended' END, CASE WHEN j <= 3 THEN now() END);
    IF j <= 3 THEN coach_ids := coach_ids || uid; END IF;
  END LOOP;

  FOR i IN 1..100 LOOP
    uid := md5('nutrismart-sim-' || i)::uuid;
    arch := CASE WHEN i <= 15 THEN 'steady' WHEN i <= 23 THEN 'over_eater' WHEN i <= 31 THEN 'low_protein_under' WHEN i <= 39 THEN 'weekend_binge'
                 WHEN i <= 49 THEN 'drifting' WHEN i <= 57 THEN 'sparse' WHEN i <= 65 THEN 'silent' WHEN i <= 69 THEN 'new_today'
                 WHEN i <= 75 THEN 'low_mood' WHEN i <= 81 THEN 'energy_dropper' WHEN i <= 93 THEN 'pattern_rich' ELSE 'mixed' END;
    tier := i % 3;
    tcal := (ARRAY[1500,1800,2200])[tier + 1]; tpro := (ARRAY[60,75,95])[tier + 1]; tfat := ROUND(tcal * 0.3 / 9);

    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'p' || lpad(i::text, 3, '0') || '@sim.nutrismart.invalid', '', now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('name', 'Sim ' || lpad(i::text, 3, '0') || ' ' || arch), now(), now());
    UPDATE public.users SET name = 'Sim ' || lpad(i::text, 3, '0') || ' ' || arch, target_cal = tcal, target_protein = tpro, target_fat = tfat, target_water = 8,
           created_at = CASE WHEN arch = 'new_today' THEN now() - interval '30 minutes' ELSE ((d0 - 20)::timestamp AT TIME ZONE 'Asia/Kolkata') END,
           tnc_accepted_at = now()
     WHERE id = uid;
    INSERT INTO public.user_profile (user_id, age_band, gender, state, goal, diet, consent_at, completed_at)
    VALUES (uid, (ARRAY['18-24','25-34','35-44','45-54'])[i % 4 + 1], (ARRAY['female','male'])[i % 2 + 1], (ARRAY['Maharashtra','Karnataka','Delhi','Gujarat','Tamil Nadu'])[i % 5 + 1],
            (ARRAY['lose_fat','maintain','build_muscle'])[i % 3 + 1], 'eggetarian', now(), now())
    ON CONFLICT (user_id) DO NOTHING;

    -- Plans
    IF i % 7 = 0 THEN
      INSERT INTO public.subscriptions (user_id, plan, status, valid_until, activated_at, payment_source) VALUES (uid, 'pro', 'active', now() + interval '20 days', now() - interval '10 days', 'upi_manual');
      UPDATE public.users SET plan = 'pro' WHERE id = uid;
    ELSIF i % 23 = 0 THEN
      INSERT INTO public.subscriptions (user_id, plan, status, valid_until, activated_at, payment_source) VALUES (uid, 'pro', 'active', now() - interval '3 days', now() - interval '33 days', 'upi_manual');
    ELSIF i % 29 = 0 THEN
      INSERT INTO public.subscriptions (user_id, plan, status, pro_provisional_until) VALUES (uid, 'free', 'pending_verification', now() + interval '5 hours');
    END IF;

    -- Reminder preferences
    IF i % 4 = 1 THEN
      INSERT INTO public.nudge_preferences (user_id, log_reminders, coach_nudges, max_per_day, quiet_start, quiet_end)
      VALUES (uid, TRUE, (i % 8 <> 1), CASE WHEN i % 9 = 0 THEN 0 ELSE 2 END, CASE WHEN i % 12 = 1 THEN 1380 ELSE 1290 END, 450);
    END IF;

    maxoff := CASE arch WHEN 'pattern_rich' THEN 20 WHEN 'new_today' THEN 0 WHEN 'silent' THEN -1 ELSE 13 END;
    FOR off IN 0..maxoff LOOP
      day := d0 - off; dow := EXTRACT(dow FROM day)::int;
      h := abs(hashtext(i || ':' || off));
      jit := ((h % 7) - 3) / 100.0;
      logged := CASE arch
        WHEN 'drifting' THEN (off IN (0,2,4,6) OR off >= 7)
        WHEN 'sparse'   THEN (off IN (1,5) OR off >= 7)
        WHEN 'mixed'    THEN (h % 5 <> 0)
        ELSE TRUE END;
      IF NOT logged THEN CONTINUE; END IF;
      m := CASE arch WHEN 'over_eater' THEN 1.55 + (i % 5) * 0.02 WHEN 'low_protein_under' THEN 0.62
                     WHEN 'weekend_binge' THEN CASE WHEN dow IN (0,6) THEN 1.7 ELSE 1.0 END
                     WHEN 'mixed' THEN 0.7 + (h % 7) * 0.1 ELSE 1.0 + CASE WHEN arch IN ('steady') THEN jit ELSE 0 END END;
      pm := CASE arch WHEN 'low_protein_under' THEN 0.40 WHEN 'steady' THEN 1.0 + jit ELSE 1.0 END;
      heavy := (arch = 'pattern_rich' AND off % 2 = 0);
      shares := CASE WHEN heavy THEN ARRAY[0.18,0.50,0.08,0.24] WHEN arch = 'pattern_rich' THEN ARRAY[0.28,0.30,0.12,0.30] ELSE ARRAY[0.25,0.35,0.10,0.30] END;
      cal_total := ROUND(tcal * m); pro_total := ROUND(tpro * pm);
      used_cal := 0; used_pro := 0;
      nmeals := CASE arch WHEN 'new_today' THEN 1 ELSE 4 END;
      FOR j IN 1..nmeals LOOP
        IF j < 4 AND arch <> 'new_today' THEN cal_j := ROUND(cal_total * shares[j]); pro_j := ROUND(pro_total * shares[j]);
        ELSIF arch = 'new_today' THEN cal_j := ROUND(cal_total * shares[1]); pro_j := ROUND(pro_total * shares[1]);
        ELSE cal_j := cal_total - used_cal; pro_j := pro_total - used_pro; END IF;
        used_cal := used_cal + cal_j; used_pro := used_pro + pro_j;
        fat_j := ROUND(cal_j * 0.28 / 9.0); carb_j := GREATEST(0, ROUND((cal_j - pro_j * 4 - fat_j * 9) / 4.0));
        pick := (abs(hashtext(i || ':' || off || ':' || j)) % 4) + 1;
        names := CASE j WHEN 1 THEN b_names WHEN 2 THEN l_names WHEN 3 THEN s_names ELSE d_names END;
        ports := CASE j WHEN 1 THEN b_ports WHEN 2 THEN l_ports WHEN 3 THEN s_ports ELSE d_ports END;
        ts := LEAST(now() - interval '2 minutes', ((day::timestamp + make_interval(hours => mtimes[j][1], mins => mtimes[j][2])) AT TIME ZONE 'Asia/Kolkata'));
        INSERT INTO public.daily_logs (user_id, log_date, meal, food_name, portion, qty, is_home, multiplier, cal, protein, carbs, fat, gl, anomaly, created_at, food_source)
        VALUES (uid, day, meals[j], names[pick], ports[pick], 1, TRUE, 1, cal_j, pro_j, carb_j, fat_j, ROUND(carb_j * 0.45, 1), FALSE, ts,
                CASE WHEN arch = 'mixed' AND h % 3 = 0 THEN 'ai' ELSE 'master' END);
        -- A feeling after lunch for pattern people: heavy lunches tend to be followed by lower energy
        IF arch = 'pattern_rich' AND j = 2 THEN
          INSERT INTO public.meal_feelings (user_id, log_date, meal, energy_change, fullness, mood_change)
          VALUES (uid, day, 'lunch', CASE WHEN heavy THEN (CASE WHEN h % 6 = 0 THEN 'same' ELSE 'lower' END) ELSE (CASE WHEN h % 6 = 0 THEN 'same' ELSE 'better' END) END,
                  CASE WHEN heavy THEN 'full' ELSE 'comfortable' END, CASE WHEN heavy THEN 'lower' ELSE 'same' END);
        END IF;
      END LOOP;
      INSERT INTO public.water_logs (user_id, log_date, glasses) VALUES (uid, day, 4 + (h % 6));

      -- Energy check-ins
      lvl := NULL;
      IF arch = 'steady' AND i % 2 = 0 THEN lvl := 'steady';
      ELSIF arch = 'low_mood' THEN lvl := CASE WHEN h % 4 = 0 THEN 'steady' ELSE 'low' END;
      ELSIF arch = 'energy_dropper' THEN lvl := CASE WHEN off >= 7 THEN (CASE WHEN h % 2 = 0 THEN 'high' ELSE 'steady' END) ELSE 'low' END;
      ELSIF arch = 'pattern_rich' THEN lvl := CASE WHEN heavy THEN 'low' ELSE 'steady' END;
      END IF;
      IF lvl IS NOT NULL THEN
        INSERT INTO public.energy_logs (user_id, log_date, log_time, level, meal_before, total_cal, total_gl, skipped)
        VALUES (uid, day, LEAST(now() - interval '1 minute', ((day::timestamp + interval '15 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata')), lvl, 'lunch', cal_total, 0, FALSE);
      END IF;

      -- Daily check-ins (mood, energy, hunger, sleep, stress)
      IF arch = 'low_mood' THEN
        INSERT INTO public.daily_checkins (user_id, log_date, energy, mood, hunger, sleep, stress) VALUES (uid, day, 1 + (h % 2), 1 + (h % 2), 3, 'poor', 'high');
      ELSIF arch = 'steady' AND i % 2 = 1 THEN
        INSERT INTO public.daily_checkins (user_id, log_date, energy, mood, hunger, sleep, stress) VALUES (uid, day, 4, 4, 3, 'good', 'low');
      ELSIF arch = 'pattern_rich' THEN
        INSERT INTO public.daily_checkins (user_id, log_date, energy, mood, hunger, sleep, stress)
        VALUES (uid, day, CASE WHEN heavy THEN 2 ELSE 4 END, CASE WHEN heavy THEN 3 ELSE 4 END, 3, 'okay', 'medium');
      ELSIF arch = 'mixed' AND h % 2 = 0 THEN
        INSERT INTO public.daily_checkins (user_id, log_date, energy, mood, sleep) VALUES (uid, day, 1 + (h % 5), 1 + ((h / 7) % 5), (ARRAY['poor','okay','good'])[h % 3 + 1]);
      END IF;
    END LOOP;

    -- Flexible meals: people ending in 4
    IF i % 10 = 4 THEN
      INSERT INTO public.flexible_meals (user_id, planned_for, planned_time, label, reserved_kcal, status, consumed_kcal)
      VALUES (uid, d0 - 1, '20:00', 'Family dinner out', 900, 'consumed', 950),
             (uid, d0, '20:00', 'Birthday dinner', 900, 'planned', NULL);
      IF i % 20 = 4 THEN
        INSERT INTO public.flexible_meals (user_id, planned_for, planned_time, label, reserved_kcal, status) VALUES (uid, d0 - 2, '13:00', 'Office party lunch', 700, 'skipped');
      END IF;
    END IF;

    -- Experiments: even pattern people run one (every third finished), odd ones none
    IF arch = 'pattern_rich' AND i % 2 = 0 THEN
      exp_status := CASE WHEN i % 6 = 0 THEN 'completed' ELSE 'active' END;
      exp_start := CASE WHEN exp_status = 'completed' THEN d0 - 13 ELSE d0 - 4 END;
      INSERT INTO public.experiments (user_id, template, title, actions, metrics, start_date, duration_days, baseline_days, status, ended_at)
      VALUES (uid, 'afternoon_energy', 'Improve afternoon energy', '["Protein-rich breakfast","Lunch at a regular time"]', '["energy","mood"]', exp_start, 7, 7, exp_status,
              CASE WHEN exp_status = 'completed' THEN now() - interval '6 days' END);
      INSERT INTO public.experiment_days (experiment_id, user_id, day, done)
      SELECT e.id, uid, exp_start + k, '[0,1]'::jsonb FROM public.experiments e, generate_series(0, CASE WHEN exp_status = 'completed' THEN 6 ELSE 4 END) k
       WHERE e.user_id = uid AND e.status = exp_status;
    END IF;

    -- Coached clients: every third person, shared with one of the three active sim coaches
    IF i % 3 = 0 THEN
      cidx := (i / 3) % 3 + 1;
      scope := CASE i % 10 WHEN 1 THEN '{"food":true,"energy":false,"water":false,"weight":false,"mood":false}'
                          WHEN 2 THEN '{"food":false,"energy":true,"water":false,"weight":false,"mood":false}'
                          WHEN 3 THEN '{"food":true,"energy":true,"water":true,"weight":true,"mood":false}'
                          ELSE '{"food":true,"energy":true,"water":true,"weight":true,"mood":true}' END::jsonb;
      rstatus := CASE WHEN i % 15 = 0 THEN 'paused' WHEN i % 17 = 0 THEN 'ended' ELSE 'active' END;
      INSERT INTO public.coach_client_relationships (coach_id, client_id, status, share_scope, invited_at, accepted_at, ended_at)
      VALUES (coach_ids[cidx], uid, rstatus, scope, now() - interval '12 days', now() - interval '10 days', CASE WHEN rstatus = 'ended' THEN now() - interval '1 day' END);
      INSERT INTO public.client_profiles (user_id, goal_type, height_cm) VALUES (uid, (ARRAY['lose_fat','maintain','build_muscle'])[i % 3 + 1], 150 + (i % 35))
      ON CONFLICT (user_id) DO NOTHING;
      IF i % 6 = 0 THEN
        INSERT INTO public.nutrition_targets (client_id, set_by, source, calories, protein_g, fat_g, effective_from)
        VALUES (uid, coach_ids[cidx], 'coach', tcal + 200, tpro + 5, tfat, (d0 - 10)::timestamp AT TIME ZONE 'Asia/Kolkata');
      END IF;
    END IF;
  END LOOP;

  -- Make sure every stored daily number reflects the final rows
  PERFORM public.compute_adherence_day(u.id, g::date)
    FROM public.users u, generate_series(d0 - 20, d0, interval '1 day') g
   WHERE u.email LIKE '%@sim.nutrismart.invalid';
  RAISE NOTICE 'Seeded 100 people and 5 coaches. Today (IST) is %.', d0;
END
$seed$;
