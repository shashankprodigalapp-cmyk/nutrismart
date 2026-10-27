# Photo logging improvements (Phase 12)

Unchanged: upload, `/api/ai-vision` (identify dishes), daily limits, add sheet to confirm. Nothing is saved without the person confirming in the add sheet.

Added (flag `v2_photo`, default off; with it off the 1.0 card behaves as before):
- **Food-list matching.** Each dish name is matched against the local food list. A good match (Fuse score 0.25 or better) is shown first as "from our food list" with its verified numbers. "Use the AI estimate instead" is always one tap away.
- **Ranges, not single numbers.** AI numbers show as "AI estimate: about 400 kcal (300 to 500)". The range is +-15% (high confidence), +-25% (medium), +-40% (low).
- **Uncertainty notes.** Low confidence: "Not sure about this one. Check the dish and the portion." Medium or a clarifying question: a short prompt to check.
- **Disagreement warning.** If the AI estimate is more than 40% away from the food-list value, the card says so.
- Analytics: `photo_dish_picked` (confidence, source); `food_logged` method `photo` for both sources.
Code: `src/lib/photoEstimate.ts` (tests: `PhotoEstimate.test.ts`, 8). Server unchanged.
Not done: portion estimation from the image itself (the model's portion guess is still text); multi-dish "add all" (deliberately, to avoid silent saves).
