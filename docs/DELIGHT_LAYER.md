# Delight layer (Stage 1)

Small, kind moments on top of the existing app. Everything is behind a switch that is OFF by default. No new tables, no points, no levels yet.

## What it does
| Switch | What the person sees |
|---|---|
| `ui_celebrations` | A short pop after a meal is logged: emoji, "Lunch logged", one warm line. Confetti for about a second (still when reduced motion is on). At most one pop per 8 seconds. A "Not for me, turn these off" link stores the choice on that device. |
| `ui_plate` | "Today's plate" on the Today tab: protein first, then carbs, fat, water, with the percentage written next to each colour. One calm sentence. A "Hide calories" button hides the calorie ring card (stored on that device). |
| `ui_welcome_back` | After 3 or more days with no logs, on a day with nothing logged yet, a gentle card with two easy ways back in. Dismiss hides it for the day. A new account never sees it. |

## Rules that must not change
1. Celebrate actions (logging, learning, trying). Never restraint, weight, or speed of change.
2. Never compare one person with another. No rankings.
3. A missed day costs nothing. No streak, no loss wording.
4. Celebration and plate text are written by fixed rules in `src/lib/delight.ts`. There is no AI in these features, so there is no cost and nothing to invent.
5. Every pop can be turned off by the person, and it respects the phone's reduced-motion setting.

A test (`src/tests/ui22/delight.test.ts`) fails the build if any of this copy mentions weight, skipping, streaks, ranking or restriction.

## Where the code is
- `src/lib/delight.ts` pure rules and small preference helpers.
- `src/components/delight/` `CelebrationHost`, `PlateCard`, `WelcomeBackCard`.
- `AppShell.tsx` mounts the host once. `DashboardLogging.tsx` announces a saved meal (not an edit).
- `TodayTab.tsx` shows the plate and the welcome-back card.
- `supabase/migrations/046_ui_flags.sql` creates the three switches (OFF).

## Not in Stage 1 (needs your decisions or data first)
Points and levels (needs a ledger table and daily caps), Food Explorer (needs food region tags), Kitchen Detective (needs reviewed lessons), light theme, achievements, coach challenges.

## Turning it on
In Supabase: `update feature_flags set enabled = true where key = 'ui_celebrations';` (same for `ui_plate`, `ui_welcome_back`). Turn one on, try it on the v2 preview, then the next. Turning a switch off removes the feature instantly.
