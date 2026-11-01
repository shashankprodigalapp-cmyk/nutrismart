# NutriSmart 2.1 test cases (case studies)

Each case is a short story with the expected result. "Auto" means a test checks it on every push. "Phone" means a person checks it (see MANUAL_TESTS.md).

## Case study A: Asha, who eats light lunches
Asha logs 14 days. Lunch is roti and sabzi (6g protein), dinner dal rice (14g), snacks on alternate days include curd (9g) and paneer (14g). Her goal is 2000 kcal and 100g protein.

| # | What happens | Expected | Checked by |
|---|---|---|---|
| A1 | She asks for a refresh | Features stored for 1/7/14/30/90 days with value, baseline, delta, trend, sample size, confidence, calculated_at. Lunch protein 7-day average is 6 from 7 days | I-01, features.test |
| A2 | Recommendation appears | "Your lunches are light on protein", evidence with numbers, action names paneer or curd (foods she already logs), expected outcome, follow-up date | I-01, recommend.test |
| A3 | Today screen | Five parts: Today's signal, Your progress, What to do next, Smart meal (plus What NutriSmart learned when there is something to say) | I-02 |
| A4 | She taps "I will try this" | Row becomes accepted with a time; screen says "We will check how it went" | I-02, loop.test |
| A5 | Later days show higher lunch protein | Outcome recorded as improved; the monthly report lists it under "What worked" | loop.test, energy_coach_reports.test |
| A6 | She taps "Not now" | Same suggestion is not shown again for a week | recommend.test |
| A7 | Fewer than the minimum days logged | No learned statement is invented; confidence is low | features.test |

## Case study B: notifications that behave
| # | What happens | Expected | Checked by |
|---|---|---|---|
| B1 | Smart tips are off (default) | Nothing is sent | notify.test, security.test |
| B2 | She turns Smart tips on and unticks Protein tips | Preferences stored; protein tips never chosen | I-06, notify.test |
| B3 | Quiet hours, daily cap, cooldown, duplicate | Each one blocks the send and records why | notify.test |
| B4 | She ignores several tips in a row | Fatigue score rises; sending slows or stops | notify.test |
| B5 | She usually opens tips around 8pm | Timing learned from opens | notify.test |
| B6 | Cron job called without the secret | 403 | I-10 |
| B7 | Channel set to in-app | Decision recorded, no push sent | security.test |

## Case study C: her coach
| # | What happens | Expected | Checked by |
|---|---|---|---|
| C1 | Coach opens the client | Coach brief shows reasons and evidence, "Protein is well under the goal." | I-04, energy_coach_reports.test |
| C2 | Coach taps "Draft a message for review" | Draft appears in an editable box; the client sees nothing yet | I-04 |
| C3 | Coach edits and taps "Approve and send" | Client receives exactly the edited text, as a coach message; 140 characters, no links | I-04, security.test |
| C4 | Coach tries to approve it a second time | Refused (404) | I-04 |
| C5 | Client stops sharing food | Brief shows nothing about food | platform.spec P-privacy, security.test |
| C6 | A coach who is not linked | 404 on brief and draft | I-05 |
| C7 | A client calls coach endpoints | 403 | I-05 |
| C8 | After the message, did she improve? | Intervention outcome shown next to the message | energy_coach_reports.test |

## Case study D: energy and feelings, carefully worded
| # | What happens | Expected | Checked by |
|---|---|---|---|
| D1 | Check-in with fullness and digestion | Saved; optional; hidden when the switch is off | I-07 |
| D2 | Fewer than 6 check-ins | No energy statement at all | energy_coach_reports.test |
| D3 | Enough data | Wording like "On 4 of your last 6 logged days ..."; never "causes", "diagnose", "disease" | energy_coach_reports.test (isObservational) |

## Case study E: privacy and safety
| # | What happens | Expected | Checked by |
|---|---|---|---|
| E1 | A stranger reads someone's features, recommendations or messages | Empty | I-05, tests_v2_intel.sql |
| E2 | Browser tries to write features | Refused | I-05, tests_v2_intel.sql |
| E3 | Someone else's recommendation is changed | 404 | I-05 |
| E4 | No login | 401 on all five new endpoints | I-05 |
| E5 | Switch off | Server returns 403 and Today shows no new parts | I-08 |
| E6 | Export my data | Contains the five new data sets, never unsent drafts | I-09 |
| E7 | Photo search | Gone: no camera, no endpoint, no quota | E2eSelectors.test |

## Case study F: the whole loop (master prompt section 18)
Log meals, refresh (analytics update), recommendation appears, decision recorded for the notification, person acts, outcome recorded, weekly report reflects it. Automatic: loop.test (pure), I-01 to I-03 (live).

## Phone checks (about 10 minutes)
1. Install on the phone, log in, open Today with the switches on: five parts readable without zooming.
2. Open Profile, Nudges: Smart tips toggle and the kinds list fit the screen.
3. Open What NutriSmart has learned: three tabs scroll sideways without clipping.
4. As a coach on the phone: Draft, edit, Approve and send, then check the client phone receives it.
5. Turn all ten switches off: the app looks exactly like 2.0.
