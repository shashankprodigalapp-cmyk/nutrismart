# Voice logging (Phase 11)

Flow: mic button -> the browser's speech recognition (English India or Hindi, switchable) -> `parseUtterance` (plain rules, `src/lib/voiceParse.ts`) -> each item is matched against the local food list -> "What I heard" card -> the person taps "Review and add" for each item, which opens the normal add sheet with the quantity pre-filled -> confirm.

Design choices
- Nothing is logged without the person confirming each item in the existing add sheet, so a mis-heard word can never silently add food.
- No AI and no server call: parsing is deterministic and free. Unmatched items offer "Search" (the normal search; AI search stays where it was).
- Audio is handled only by the browser's speech service (on Chrome that is Google's service). NutriSmart never receives or stores audio; the card says so. Add this to the privacy policy before switching on for everyone.
- Browsers without speech recognition (for example some iOS/Firefox setups) simply do not show the mic.
- Understands: digits, English and Hinglish number words, Hindi script, fractions ("1/2", "aadha"), "a glass of", "a couple of", and joiners (and, aur, with, comma). Max 8 items, quantity capped at 20.
- Analytics events: `voice_used` (items, matched) and `food_logged` with method `voice`.
- Flag `v2_voice` (default off, migration 028). Tests: `VoiceParse.test.ts` (9).
Known limits: quantity words are multiplied against the food's standard portion ("2 cups of tea" becomes 2 portions), and the sheet lets the person adjust it. Not tested on real devices yet.
