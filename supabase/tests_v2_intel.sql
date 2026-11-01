-- 2.1 intelligence tables: access rules and constraints. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','client@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),('00000000-0000-0000-0000-00000000000c','other@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;

-- server-side writes (these run as the database owner, like the service role)
INSERT INTO public.personal_features(user_id,feature_key,window_days,value,baseline,delta,trend,sample_size,confidence)
 VALUES ('00000000-0000-0000-0000-00000000000a','protein_avg',7,72.5,80,-7.5,'down',6,'high'),
        ('00000000-0000-0000-0000-00000000000a','protein_avg',30,75,NULL,NULL,'unknown',20,'high'),
        ('00000000-0000-0000-0000-00000000000b','protein_avg',7,90,NULL,NULL,'unknown',5,'medium');
INSERT INTO public.recommendations(user_id,rec_type,rec_key,window_day,reason,evidence,confidence,action,expected_outcome,follow_up_at)
 VALUES ('00000000-0000-0000-0000-00000000000a','protein_addition','protein_lunch','2026-10-26','r','["e"]','medium','a','o','2026-11-04');
INSERT INTO public.intel_reports(user_id,period,period_start,payload) VALUES ('00000000-0000-0000-0000-00000000000a','weekly','2026-10-26','{"x":1}');
INSERT INTO public.notification_decisions(user_id,kind,decision,reason_code,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','missed_logging','send','ok','missed:2026-11-01');
INSERT INTO public.intel_messages(user_id,sender_type,sender_id,reason,body,status) VALUES
 ('00000000-0000-0000-0000-00000000000a','ai_draft','00000000-0000-0000-0000-00000000000b','logging','Hi, could you log one meal a day?','draft'),
 ('00000000-0000-0000-0000-00000000000a','coach','00000000-0000-0000-0000-00000000000b','logging','Hi again','sent'),
 ('00000000-0000-0000-0000-00000000000a','auto',NULL,'streak','Nice streak','sent');

-- constraints
DO $$ BEGIN BEGIN INSERT INTO public.personal_features(user_id,feature_key,window_days) VALUES ('00000000-0000-0000-0000-00000000000a','x',5); RAISE NOTICE 'FAIL : window of 5 days accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : only 1/7/14/30/90 day windows allowed'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.personal_features(user_id,feature_key,window_days) VALUES ('00000000-0000-0000-0000-00000000000a','protein_avg',7); RAISE NOTICE 'FAIL : duplicate feature row accepted';
 EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : one row per person, feature and window'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.recommendations(user_id,rec_type,rec_key,window_day,reason,confidence,action,expected_outcome) VALUES ('00000000-0000-0000-0000-00000000000a','protein_addition','protein_lunch','2026-10-26','r','high','a','o'); RAISE NOTICE 'FAIL : same recommendation twice in a window';
 EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : a recommendation is made once per window'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.recommendations(user_id,rec_type,rec_key,window_day,reason,confidence,action,expected_outcome) VALUES ('00000000-0000-0000-0000-00000000000a','diagnosis','k','2026-10-26','r','high','a','o'); RAISE NOTICE 'FAIL : unknown recommendation type accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : only the nine recommendation types exist'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.notification_decisions(user_id,kind,decision,reason_code,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','missed_logging','send','ok','missed:2026-11-01'); RAISE NOTICE 'FAIL : same decision twice';
 EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : the same moment is decided once'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.intel_messages(user_id,sender_type,reason,body) VALUES ('00000000-0000-0000-0000-00000000000a','coach','r',repeat('x',201)); RAISE NOTICE 'FAIL : message over 200 characters accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : message length limited'; END; END $$;
DO $$ BEGIN INSERT INTO public.nudges(user_id,kind,title,body,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','smart','t','b','smart:1'); RAISE NOTICE 'PASS : smart nudge kind accepted'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL : smart nudge kind refused'; END $$;
DO $$ BEGIN INSERT INTO public.daily_checkins(user_id,log_date,fullness,digestion) VALUES ('00000000-0000-0000-0000-00000000000a','2026-11-01',4,'heavy'); RAISE NOTICE 'PASS : fullness and digestion saved'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL : fullness/digestion refused'; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.daily_checkins(user_id,log_date,fullness) VALUES ('00000000-0000-0000-0000-00000000000a','2026-11-02',9); RAISE NOTICE 'FAIL : fullness 9 accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : fullness must be 1 to 5'; END; END $$;
SELECT pg_temp.expect('all 2.1 switches exist and are off', (SELECT count(*) FROM public.feature_flags WHERE key IN ('analytics_engine','personal_model','recommendations','daily_intelligence','adaptive_meal_plan','weekly_reports','monthly_reports','energy_intelligence','smart_notifications','messaging') AND enabled = false), 10);
SELECT pg_temp.expect('the retired photo switch is gone', (SELECT count(*) FROM public.feature_flags WHERE key = 'v2_photo'), 0);

-- who can see what
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('person sees own features only', (SELECT count(*) FROM public.personal_features), 2);
SELECT pg_temp.expect('person sees own recommendation', (SELECT count(*) FROM public.recommendations), 1);
SELECT pg_temp.expect('person sees own report', (SELECT count(*) FROM public.intel_reports), 1);
SELECT pg_temp.expect('person sees own notification decisions', (SELECT count(*) FROM public.notification_decisions), 1);
SELECT pg_temp.expect('recipient sees sent messages but never a draft', (SELECT count(*) FROM public.intel_messages), 2);
DO $$ BEGIN BEGIN INSERT INTO public.personal_features(user_id,feature_key,window_days) VALUES ('00000000-0000-0000-0000-00000000000a','y',7); RAISE NOTICE 'FAIL : browser wrote a feature';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : browser cannot write features'; END; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.recommendations(user_id,rec_type,rec_key,window_day,reason,confidence,action,expected_outcome) VALUES ('00000000-0000-0000-0000-00000000000a','check_in','k9','2026-11-01','r','high','a','o'); RAISE NOTICE 'FAIL : browser wrote a recommendation';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : browser cannot write recommendations'; END; END $$;
DO $$ DECLARE n int; BEGIN UPDATE public.recommendations SET status='done'; GET DIAGNOSTICS n = ROW_COUNT; IF n = 0 THEN RAISE NOTICE 'PASS : browser cannot change a recommendation'; ELSE RAISE NOTICE 'FAIL : browser changed % recommendation(s)', n; END IF; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.intel_messages(user_id,sender_type,reason,body,status) VALUES ('00000000-0000-0000-0000-00000000000a','coach','r','spoof','sent'); RAISE NOTICE 'FAIL : browser created a message';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : browser cannot create messages'; END; END $$;

SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('another person sees only their own feature row', (SELECT count(*) FROM public.personal_features), 1);
SELECT pg_temp.expect('coach cannot read the client''s recommendations', (SELECT count(*) FROM public.recommendations), 0);
SELECT pg_temp.expect('coach cannot read the client''s reports', (SELECT count(*) FROM public.intel_reports), 0);
SELECT pg_temp.expect('sender sees own draft and sent message', (SELECT count(*) FROM public.intel_messages), 2);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('stranger sees no features', (SELECT count(*) FROM public.personal_features), 0);
SELECT pg_temp.expect('stranger sees no messages', (SELECT count(*) FROM public.intel_messages), 0);
SELECT pg_temp.expect('stranger sees no decisions', (SELECT count(*) FROM public.notification_decisions), 0);
RESET ROLE;
-- deleting the person removes everything
DELETE FROM public.users WHERE id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('deleting a person removes their features, recommendations, reports, decisions and messages',
  (SELECT (SELECT count(*) FROM public.personal_features WHERE user_id='00000000-0000-0000-0000-00000000000a') + (SELECT count(*) FROM public.recommendations WHERE user_id='00000000-0000-0000-0000-00000000000a') + (SELECT count(*) FROM public.intel_reports WHERE user_id='00000000-0000-0000-0000-00000000000a') + (SELECT count(*) FROM public.notification_decisions WHERE user_id='00000000-0000-0000-0000-00000000000a') + (SELECT count(*) FROM public.intel_messages WHERE user_id='00000000-0000-0000-0000-00000000000a')), 0);
