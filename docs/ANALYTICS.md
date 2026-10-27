# 2.0 analytics (Phase 18)

Admin, Platform 2.0, "Feature use". Choose 7, 30 or 90 days.

- People using each feature: food logging, voice, photo, check-ins, meal notes, flexible meals, experiments, weekly and monthly reviews. Each person counts once.
- Coach funnel (all time): applied, approved, invited someone, has an active client, a client logged this week. Plus invites sent and accepted in the period and coach messages sent.
- Reviews: share approved, edited, rejected among decided reviews; whether rules or AI wrote them; experiment outcomes.
- Sign-up cohorts: last 6 IST weeks, how many logged in week 1 and how many came back a week or more later. Under 5 people shows counts only.

## How
`admin_v2_analytics(days)` (migration 035) counts from the real tables. Only the service role can call it, through `GET /api/admin-v2-analytics`. Helpers in `src/lib/v2Analytics.ts`.

## Privacy
Counts only. No food names, notes, moods or ratings leave the database. Events written by the app (`events` table) are unchanged and still hold labels and numbers only.

## Limits
Voice and photo use are counted from `food_logged` events, so they only cover people who were online when logging. Coach funnel is not split by date. No charts yet.

## Tests
`V2Analytics.test.ts` (7), `supabase/tests_v2_analytics.sql` (11).
