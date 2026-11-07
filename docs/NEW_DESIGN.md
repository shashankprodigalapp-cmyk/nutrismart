# New look (switch `ui_new_design`)

OFF by default. When it is off the app is exactly as before.

## What it changes
- Colours: Evergreen, Sage, Ivory and warm gold, written once as tokens in `src/styles/newdesign.css`. Two themes: Light (ivory) and Dark (deep evergreen).
- Profile gets an **Appearance** card: Light, Dark, or Same as phone (default).
- Page headings use the brand serif. The phone's address-bar colour follows the theme.
- Hard-coded colours already in the screens are re-pointed to the tokens, only while the switch is on. No screen was rewritten, so nothing about how the app works changes.

## How it is switched
`ThemeHost` (mounted once in `AppShell`) reads the switch and sets `data-ui="new"` and `data-theme="light|dark"` on the page. Every rule in the stylesheet starts with that attribute, so removing it removes the new look instantly. The last known state is remembered on the device, so the screen does not flash while the switch loads.

## Guard rails (tested)
- Every text colour has at least 4.5:1 contrast on the page and card colours in both themes (`src/tests/ui26/newdesign.test.ts` reads the stylesheet and checks).
- All rules are scoped to `html[data-ui="new"]`.
- White text stays white on solid red or green buttons; lime buttons keep dark text.

## Not in this step
Layout changes to individual screens (thali on Today, protein-first Log, Hinglish labels, Kitchen screens). Those are built screen by screen on top of this base.

## Turning it on
`update feature_flags set enabled = true where key = 'ui_new_design';` Then Profile → Appearance. Turn it off with `enabled = false`.
