/**
 * profileOptions.ts: the five optional profile questions, in plain data.
 * No imports on purpose, so the rules can be tested on their own.
 */
export type ProfileAnswers = {
  age_band: string | null;
  gender: string | null;
  state: string | null;
  goal: string | null;
  diet: string | null;
};

export const BONUS_SEARCHES = 5;

export const AGE_BANDS = [
  { v: '18-24', label: '18 to 24' }, { v: '25-34', label: '25 to 34' }, { v: '35-44', label: '35 to 44' },
  { v: '45-54', label: '45 to 54' }, { v: '55+', label: '55 or older' },
];
export const GENDERS = [
  { v: 'female', label: 'Female' }, { v: 'male', label: 'Male' }, { v: 'other', label: 'Other' }, { v: 'prefer_not', label: 'Prefer not to say' },
];
export const GOALS = [
  { v: 'lose_fat', label: 'Lose fat' }, { v: 'maintain', label: 'Maintain weight' }, { v: 'build_muscle', label: 'Build muscle' },
  { v: 'blood_sugar', label: 'Steady blood sugar' }, { v: 'eat_healthier', label: 'Eat healthier' },
];
export const DIETS = [
  { v: 'eggetarian', label: 'Eggetarian' }, { v: 'vegetarian', label: 'Vegetarian' }, { v: 'vegan', label: 'Vegan' },
  { v: 'jain', label: 'Jain' }, { v: 'non_veg', label: 'Non-vegetarian' },
];
export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry', 'Outside India',
];

export const EMPTY_ANSWERS: ProfileAnswers = { age_band: null, gender: null, state: null, goal: null, diet: null };

/** How many of the five questions have an answer. */
export function answeredCount(a: ProfileAnswers): number {
  return (['age_band', 'gender', 'state', 'goal', 'diet'] as const).filter(k => !!a[k]).length;
}

/** Complete means all five answered and the person agreed to how the answers are used. */
export function isComplete(a: ProfileAnswers, consent: boolean): boolean {
  return consent && answeredCount(a) === 5;
}
