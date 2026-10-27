# Things only a real phone can check

I tested logic, database rules and permissions automatically. These need you, on your phone with the app installed (Add to Home Screen). Tick as you go. Switch the matching feature on first (RELEASE_2_0.md).

## Everyone
- [ ] Sign in, log a meal the normal way; Today totals update.
- [ ] Airplane mode: log a meal, turn network back on; it appears once.
- [ ] Profile, Download my data: file opens, has your meals and check-ins.

## Voice (v2_voice)
- [ ] Tap the mic, say "two idli and one cup sambar" in English. The "What I heard" card shows both items with quantities.
- [ ] Say it in Hindi or Hinglish ("do roti aur ek katori dal").
- [ ] Deny microphone permission: the app says so politely and nothing breaks.
- [ ] On iPhone Safari voice may be unavailable: the button should be hidden or explain why.

## Photo (v2_photo)
- [ ] Photograph a plate: you get a calorie range, not a single exact number; you can pick the food-list match or the AI estimate.
- [ ] A blurry or non-food photo: sensible message.

## Check-in and mood (v2_checkins)
- [ ] Daily check-in saves; editing the same day updates it.
- [ ] Meal feeling card after a meal saves.
- [ ] After ~3 days the Energy and mood page shows careful wording ("tends to"), never "causes".

## Flexible meal (v2_flexible_meals)
- [ ] Plan a 900 kcal dinner; the rest of the day and week adjust and the numbers add up by hand.

## Reviews and experiments
- [ ] After 3 logged days a weekly review appears with the numbers you recognise.
- [ ] Start an experiment, tick a step, stop it.

## Coach (use two of your own accounts)
- [ ] Account A applies as coach; admin approves under Platform 2.0, Coaches.
- [ ] A creates an invite; account B opens the link and accepts, choosing what to share.
- [ ] A sees B's dashboard only for what B shared; switch a category off and A loses it.
- [ ] B ends the link; A no longer sees anything.
- [ ] A sends a nudge to B (needs notifications allowed on B's phone).

## Notifications (v2_nudges)
- [ ] Turn on evening reminder in Profile, Nudge settings; with nothing logged by 19:00 to 21:00 you get one reminder.
- [ ] Nothing arrives between 21:30 and 07:30.

## Admin
- [ ] Platform 2.0: every section loads. Flip a harmless switch on and off; the Audit log shows both.
- [ ] Users and Payments pages still work (they were touched by the security fix).
