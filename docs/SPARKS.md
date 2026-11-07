# Sparks, levels and daily quests (Stage B, switch `ui_sparks`)

OFF by default. Migration `049_sparks.sql` creates the ledger and the switch.

## How points work
| What you do | Sparks |
|---|---|
| Log a meal (each of breakfast, lunch, snack, dinner, once a day) | 5 |
| Drink 4 glasses of water | 5 |
| Finish both daily quests (log two meals, drink 4 glasses) | 5 bonus |

Daily cap: 30. Nothing is ever taken away. No streak. No ranking. Nothing rewards eating less, skipping, weight or speed.

## Levels
Beginner (0), Food Explorer (50), Kitchen Detective (150), Nutrition Navigator (320), Habit Master (600), Nutrition Pro (1000). At the cap this is about 2, 5, 11, 20 and 34 days. Level names are labels for now; the Food Explorer and Kitchen Detective features come in Stage C.

## Why it is safe
- **The server decides.** `/api/progress` reads the person's own saved logs and water, works out what is owed, and writes it. The app cannot claim points: the request body is ignored.
- **One award per day, kind and meal** (database unique rule), so refreshing or retrying never double-counts. The daily cap is enforced in code.
- **Read-own only.** Row security lets a person read their own rows. There is no browser write policy.
- **Included in "export my data"**, deleted with the account.
- Points are pure rules in `src/lib/sparks.ts`. No AI.

## Where the code is
`src/lib/sparks.ts` (rules), `functions/api/progress.ts` (server), `src/components/sparks/SparksCard.tsx` (Today card), `supabase/migrations/049_sparks.sql`.

## Turning it on
Run the migration, then in Admin → Platform 2.0 → Feature switches turn on `ui_sparks` (or `update feature_flags set enabled = true where key = 'ui_sparks';`).
