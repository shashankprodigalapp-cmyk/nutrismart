/** TODAY'S SIGNAL: the one thing that matters now, in plain words. Deterministic. */
export interface SignalInput {
  hour: number; targets: { cal: number; protein: number }; totals: { calories: number; protein: number; meals: number };
  flexReservedCal: number; topReason?: string; streak: number;
}
export function todaySignal(i: SignalInput): { headline: string; detail: string } {
  if (i.flexReservedCal > 0) return { headline: 'You have a flexible meal planned', detail: `${i.flexReservedCal} kcal are set aside for it. The rest of the day fits around that.` };
  if (i.topReason) return { headline: i.topReason, detail: 'This comes from your own logs.' };
  if (i.totals.meals === 0 && i.hour >= 11) return { headline: 'Nothing logged yet today', detail: 'One entry is enough to keep the day accurate.' };
  if (i.totals.calories > i.targets.cal * 1.1) return { headline: 'You are above your calorie goal today', detail: 'A lighter next meal keeps the week on track. No need to skip it.' };
  if (i.hour >= 17 && i.totals.protein < i.targets.protein * 0.6) return { headline: 'Protein is behind today', detail: `${Math.round(i.targets.protein - i.totals.protein)}g to go. A familiar protein food at dinner helps.` };
  if (i.streak >= 5) return { headline: `${i.streak} days of logging in a row`, detail: 'Steady data makes every tip sharper.' };
  return { headline: 'You are on track', detail: 'Log your next meal as you eat it.' };
}
