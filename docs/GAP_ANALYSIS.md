# NutriSmart 2.1 gap analysis

Status key: DONE / PARTIAL / BROKEN / MISSING / REMOVE / KEEP / REFACTOR. Nothing is rewritten for tidiness.

## 1. Existing features
| Feature | Status | Note |
|---|---|---|
| Indian food DB, search, My Usuals, recents | DONE, KEEP | core asset |
| Kitchen Intelligence, home vs restaurant | DONE, KEEP | |
| Flexible meals | DONE, KEEP | needs "use foods from history" (P3) |
| Energy and mood check-ins, patterns, experiments | DONE, KEEP | hunger/fullness/sleep/stress/digestion not captured yet (P6) |
| Morning verdict, nudges, push | PARTIAL | rules and caps exist; no decision log, fatigue score or learning |
| Weekly and monthly AI review | PARTIAL | structured metrics feed the LLM; no pattern/baseline inputs |
| Coach dashboard, Needs Attention, timeline | PARTIAL | answers who and why; not "what changed" or intervention outcome |
| Adherence | PARTIAL | logging and calorie; protein/plan/behaviour adherence not separate |
| Photo food search | REMOVE | see section 2 |
| Voice logging | KEEP | |
| Billing, plans | KEEP | not touched before P9 |

## 2. Photo dependencies (P0)
Photo-only, safe to remove: camera button, hidden file input, photo review card and `handlePhotoSelect`/`handlePhotoDishConfirm` in `DashboardLogging.tsx`; `functions/api/ai-vision.ts`; `src/lib/photoEstimate.ts` and `PhotoEstimate.test.ts`; flag `v2_photo` (migration 029); `photo` kind of the daily limit in `functions/_shared/auth.ts` (`RateKind`, one-second-offset row); `'photo_recognition'` in `proGatekeeper.ts`; photo model rows and "photo" labels in free-tier/admin screens; `docs/PHOTO.md`.
Shared, must stay: `get-upload-url.ts` and the storage bucket (also used for payment proof); `extract-utr.ts` (reads payment screenshots); `ai_call_log` endpoint values `vision`/`vision_lookup` (old rows); events with `method = 'photo'` in history (admin charts keep reading them, labelled as past use); `photoLoading` and `photoError` state in `DashboardLogging.tsx` is ALSO used by the typed "Search with AI" button, so it is renamed, not deleted.

## 3. Gaps against the 2.1 design
- Analytics: daily and weekly SQL aggregates exist; no rolling 1/7/14/30/90-day features, baselines, deltas, trends, sample size or confidence per feature. MISSING.
- Recommendations: only `personalFoodIntelligence.ts` suggestions; no Reason, Evidence, Confidence, Action, Expected outcome, Follow-up record, no acceptance tracking. MISSING.
- Adaptive meal plans: `plans` is the subscription catalog, not a meal plan. MISSING.
- Notifications: no "why selected", open/action/outcome tracking, no fatigue score, no per-user timing learning. PARTIAL.
- Messaging: nudges only; no message store with sender type, linked recommendation, response. MISSING.
- Reports: weekly and monthly review exist; no daily report, no personal learning report, no coach report beyond the dashboard. PARTIAL.
- Personal learning: none stored. MISSING.
- Coach intelligence: no "what changed", no suggested question, no previous intervention outcome. PARTIAL.
- Home screen: still a tracker layout. REFACTOR in P2.

## 4. Order of work
P0 audit and photo removal (in progress) -> P1 feature store and rolling features (migration 040+, deterministic functions, tests) -> P2 Today redesign -> P3 recommendations and adaptive meals -> P4 smart notifications and messaging -> P5 reports -> P6 energy intelligence -> P7 coach loop -> P8 predictive (not before P1-P7) -> P9 billing.
