import { describe, it, expect } from 'vitest';
import { answeredCount, isComplete, EMPTY_ANSWERS, AGE_BANDS, GENDERS, GOALS, DIETS, STATES } from '../../lib/profileOptions';

const full = { age_band: '25-34', gender: 'female', state: 'Maharashtra', goal: 'lose_fat', diet: 'eggetarian' };

describe('profile completion rules', () => {
  it('counts answers', () => {
    expect(answeredCount(EMPTY_ANSWERS)).toBe(0);
    expect(answeredCount({ ...EMPTY_ANSWERS, age_band: '25-34', goal: 'maintain' })).toBe(2);
    expect(answeredCount(full)).toBe(5);
  });
  it('needs all five answers and consent', () => {
    expect(isComplete(full, true)).toBe(true);
    expect(isComplete(full, false)).toBe(false);
    expect(isComplete({ ...full, diet: null }, true)).toBe(false);
  });
  it('accepts "prefer not to say" as an answer', () => {
    expect(isComplete({ ...full, gender: 'prefer_not' }, true)).toBe(true);
  });
  it('only offers values the database accepts', () => {
    expect(AGE_BANDS.map(x => x.v)).toEqual(['18-24', '25-34', '35-44', '45-54', '55+']);
    expect(GENDERS.map(x => x.v)).toEqual(['female', 'male', 'other', 'prefer_not']);
    expect(GOALS.map(x => x.v)).toEqual(['lose_fat', 'maintain', 'build_muscle', 'blood_sugar', 'eat_healthier']);
    expect(DIETS.map(x => x.v)).toEqual(['eggetarian', 'vegetarian', 'vegan', 'jain', 'non_veg']);
    expect(STATES.every(s => s.length <= 40)).toBe(true);
  });
});
