# Consolidated test case: everything together

Run it with one command. Fast checks (about a minute, no network): `npm run test:all`. Full run against the preview as well: `npm run test:all:live` (needs the four secrets, see docs/SIMULATION.md). In GitHub: Actions → "Browser e2e" → Run workflow, or push to `v2`.

## Order and what each step proves

| Step | Command | Proves |
|---|---|---|
| 1 | `npx vitest run` | Logic, components, every word/route quoted in the blueprint (BlueprintContract), every word/role the browser tests rely on (E2eSelectors), password rules |
| 2 | `npm run build` | Types compile and the app builds |
| 3 | `npx playwright test e2e/v2` | Real API, security, screens and journeys against the preview |

Pass rule: all steps green. A skipped test (switch off, or phone-only) is reported, not hidden.

## Cases in the live run

| File | Case |
|---|---|---|
| platform.spec | log three meals; stored daily totals match the arithmetic |
| platform.spec | daily check-in saves and reads back |
| platform.spec | flexible meal can be planned and marked eaten |
| platform.spec | a person cannot read or write another person's data |
| platform.spec | plans, export and weekly review respond correctly |
| platform.spec | a client cannot use coach or admin endpoints |
| platform.spec | visitors without a login are refused everywhere |
| platform.spec | dashboard shows the client with the numbers the client logged |
| platform.spec | coach sees only linked clients |
| platform.spec | privacy: when the client stops sharing food, the coach sees nothing |
| platform.spec | chart numbers: 14 days for the client, today matches what was logged |
| platform.spec | snooze and clear an attention signal |
| platform.spec | nudges: allowed text queues, links are refused, strangers are refused |
| platform.spec | coach can open the client's weekly review, a stranger cannot |
| platform.spec | metrics, analytics, plans, coaches and audit load with sensible numbers |
| platform.spec | chart numbers for the admin Trends screen are complete |
| platform.spec | feature switch flips, is audited, and is restored |
| platform.spec | a coach cannot use admin endpoints |
| platform.spec | client sees Today and the logged calories |
| platform.spec | coach sees the dashboard with the client |
| platform.spec | admin sees every section |
| platform.spec | a non-admin is turned away from the admin screen |
| screens.spec | CU-01 sign-in form: fields, mode switch, and the sign-up name field |
| screens.spec | CU-02 sign-up needs the 18+ tick, then enforces every password rule (no account is created) |
| screens.spec | CU-03 wrong password and empty-email reset show the documented messages |
| screens.spec | CU-04 a new person is sent to the kitchen questions, finishes them, and lands on Today |
| screens.spec | CU-05 four tabs navigate and stay healthy |
| screens.spec | CU-06 Today shows the logged totals and the four summary labels |
| screens.spec | CU-07 Today links to the weekly review and Energy and mood when those switches are on |
| screens.spec | CU-08 Log screen: search box is there, typing finds a food, clearing works |
| screens.spec | CU-09 Profile: sections, footer, and the very-low-calorie warning |
| screens.spec | CU-10 Data and Privacy: AI notice is shown; delete needs the word DELETE |
| screens.spec | CU-11 sign out returns to the login page and protects the app |
| screens.spec | CU-12 the extra pages load without errors |
| screens.spec | CU-13 nudge settings show the three controls (switch on) |
| screens.spec | CU-14 a bad invite link says so |
| screens.spec | CU-15 the app is installable: manifest, service worker, icons |
| screens.spec | CO-01 dashboard: client row, search, status filter, sort and window controls |
| screens.spec | CO-02 invite: create a link, see the one-time warning, see it pending, cancel it |
| screens.spec | CO-03 client detail: tabs open, timeline filter toggles, no errors |
| screens.spec | CO-04 nudge from the screen: preset fills the box, Send queues it, a second one the same day is refused |
| screens.spec | CO-05 consent in the browser: the client pauses sharing and the coach sees "Sharing paused" |
| screens.spec | CO-06 a coach is turned away from the admin console |
| screens.spec | CO-07 a client is turned away from the coach area data |
| screens.spec | AD-01 all ten tabs open, are not blank and show no error |
| screens.spec | AD-02 the tab bar links to every screen |
| screens.spec | AD-03 admin never sees a person's food log |
| screens.spec | AD-04 platform sections: every section button opens without an error |
| screens.spec | AD-05 Trends charts draw (svg with a name) and the totals match the day the client logged |
| screens.spec | AD-06 the Free tier tab shows the watch card |
| screens.spec | X-01 security headers are served on the app page |
| screens.spec | X-02 signed-out visitors are sent to the login page from every protected area |
| screens.spec | X-03 every server function refuses a visitor who is not signed in |
| screens.spec | X-04 phone-size screens: sideways scrolling is reported (advisory) |
| screens.spec | X-05 coach and admin screens at phone width (advisory) |
| screens.spec | X-06 the AI endpoints refuse bad input from a signed-in person without crashing |
| screens.spec | X-07 an unknown address shows the app, not a server error |
| workflows.spec | W-01 flexible meal: plan, eat, skip, cancel, custom calories, close |
| workflows.spec | W-02 daily check-in: nothing to save until a tap, saves, shows saved, can be edited |
| workflows.spec | W-03 meal feeling: one note per meal, saved, the meal leaves the list |
| workflows.spec | W-04 water: add and remove glasses, and the count survives a reload |
| workflows.spec | W-05 save a usual meal from a pattern, and dismiss another suggestion |
| workflows.spec | W-06 apply to be a coach, admin approves, the new coach gets the coach area |
| workflows.spec | W-07 accept an invite through the real link: choose what to share, join, link is single-use |
| workflows.spec | W-08 weekly review: coach approves, edits, rejects; the client sees the edited version |
| workflows.spec | W-09 gift Pro to a person, then revoke it |
| workflows.spec | W-10 contributions: approve one food, reject another with a reason |
| workflows.spec | W-11 search review: block, unblock, dismiss; approve and remove AI foods |
| workflows.spec | W-12 delete my account: needs DELETE, removes the person and their data, sign-in no longer works |
| workflows.spec | W-13 an admin account cannot be deleted from the Profile screen |
| workflows.spec | W-14 deleting needs the exact word, and a visitor cannot delete anyone |

## Still manual (needs a real phone)

See docs/MANUAL_TESTS.md (12 cases): install on iPhone/Android, offline logging and sync, camera photo search, voice, push notification delivery, verification and reset emails.

## When a browser test fails

1. Read the DIAGNOSTIC line in the log: it prints the page address and the words on screen.
2. Compare with the source: run `npx vitest run src/tests/v2/E2eSelectors.test.ts` first. If it fails, the app and the tests disagree on a word or place.
3. Fix the test or the app, never both blindly. Tests must only use words that exist in the source.

