# Journey, Food Explorer, Kitchen Detective, Hinglish (Stage C, switches `ui_journey` and `ui_detective`)

Both OFF by default. Migration `050_ui_journey.sql` creates them. Page: `/app/journey` (linked from the Sparks card when `ui_journey` is on).

- **Levels**: the six levels and where you are. Needs `ui_sparks` for your current level.
- **Food Explorer**: eight regional kitchens (South Indian, North Indian, Punjabi, Gujarati, Maharashtrian, Bengali, Rajasthani, Street snacks). A kitchen counts as "tried" when a logged food name matches one of its dish words (`src/lib/regions.ts`). Worked out on the device from the person's own logs. It celebrates trying; it never scores or says what to avoid. One gentle idea from a kitchen not tried yet.
- **Kitchen Detective**: six short lessons in `src/content/lessons.ts`. They are DRAFTS. Until `ui_detective` is switched on, people see "being reviewed by a nutrition professional". **Do not switch `ui_detective` on until a qualified nutrition professional has reviewed and, if needed, corrected every lesson.**
- **Hinglish**: English or Hinglish for the new screens only (Today hero, Sparks card, Journey page). Chosen in Profile → Appearance (when the new look is on) or on the Journey page. Saved on the device. Anything not translated shows in English. The rest of the app stays English for now.

Not built yet: achievements, plate poster, kitchen profile screen, and Stage D (coach challenges, client progress).
