# Simulation: 100 made-up people, one week of data

Purpose: fill the database with realistic made-up people so every module (coach dashboard, needs-attention, weekly review, patterns, experiments, plans, nudges, admin) has something to show, and check the numbers against answers worked out independently.

## What gets created
- 100 people (emails end `@sim.nutrismart.invalid`, cannot log in) + 5 made-up coaches (3 active, 1 waiting for approval, 1 suspended).
- About two weeks of meals, water, energy check-ins and mood check-ins each (three weeks for pattern people).
- Types of people: steady, over-eater, low-protein, weekend binge, drifting, sparse logger, silent, new today, low mood, energy dropper, pattern-rich, mixed.
- Extras: Pro / expired Pro / provisional Pro, flexible meals, experiments, evening reminders, 33 coach-client links (paused and ended included).

## Files (supabase/sim/)
| File | What it does |
|---|---|
| 01_seed_100.sql | Creates everyone. Refuses to run twice. |
| 02_link_me.sql | Optional. Edit the email line to YOUR account; makes you the coach of 24 made-up clients so you can see them in your Coach area. |
| 04_scorecard.sql | 79 checks. Read the PASS/FAIL table at the bottom. |
| 03_cleanup.sql | Removes every made-up person and their traces. |

## Steps (Supabase → SQL Editor)
1. Open the file in Terminal: `pbcopy < supabase/sim/01_seed_100.sql`, paste in a new query, Run.
2. Optional: edit `my_email` in 02_link_me.sql, copy, paste, Run.
3. `pbcopy < supabase/sim/04_scorecard.sql`, paste, Run. Top row shows TOTAL; any FAIL row names the problem.
4. Look around the app (Coach area, Admin → Platform 2.0). Turn on feature switches one group at a time.
5. When finished: `pbcopy < supabase/sim/03_cleanup.sql`, paste, Run.

## Warnings
- 1.0 and 2.0 share one database. While the made-up people exist, admin user counts and analytics include them. Clean up afterwards.
- Your own coach profile (if you used step 2) stays after cleanup; the made-up clients do not.
- The scorecard refreshes weekly/monthly summary tables; harmless.
- Made-up people cannot log in, so phone-feature tests (voice, photo, push) still need your real account.
- AI wording (Gemini) is not exercised by the SQL checks.

## Tested so far
Seed, link, scorecard (79/79) and cleanup pass on a clean Postgres 16 test database. `node scripts/sim/ts-checks.mjs` runs the app's own coach-status, needs-attention and nudge rules against the same people (30/30). The real Supabase login schema and the screens have not been tested by a browser here.

## Automated testing and test mode
- `scripts/test-all.sh` does everything in one command with no manual steps: unit tests, all migrations, 180 SQL tests, the 100-person seed, the 79-check scorecard, the app-rule checks, test mode on/off, cleanup. It uses a scratch database only. GitHub runs it on every push to v2 (Actions tab shows green or red).
- `05_test_mode_on.sql` switches every 2.0 feature on in one go (remembering what was on); `06_test_mode_off.sql` restores exactly that. Run in Supabase SQL Editor.
- Add `TEST_MODE` = `on` in Cloudflare → Settings → Variables → **Preview only** to switch off the "too many tries" limiter while testing. Delete it afterwards. Never add it to Production.
- Kept on purpose, even in test: login, role checks and data privacy rules. Removing those would make the test results meaningless and expose real users' data in the shared database.
