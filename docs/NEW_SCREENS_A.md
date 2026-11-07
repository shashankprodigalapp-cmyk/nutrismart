# New screens, Stage A (switch `ui_screens_a`)

OFF by default. Works best together with `ui_new_design`.

- **Today hero**: today's thali (protein first) and ONE next step, chosen by fixed rules in `src/lib/todayAction.ts`: first meal, add protein after 2 pm if it is under 40%, a glass of water after 11 am if under 40%, protein covered, or "looking steady". No AI, no cost.
- **Navigation icons**: line icons replace the emoji in the bottom bar and the desktop sidebar.
- When the hero is on, the separate "Today's plate" card is hidden, because the hero already shows it.

Rules that must not change: suggest an action, never restraint; never judge calories, carbs or fat; no weight, streak or comparison wording. A test fails the build if the copy breaks this.

Not in Stage A yet: protein-first Log layout, Sparks, levels, quests (Stage B), Kitchen/Explorer/Detective and Hinglish labels (Stage C), coach and challenge screens (Stage D).

Turn on: `update feature_flags set enabled = true where key = 'ui_screens_a';`
