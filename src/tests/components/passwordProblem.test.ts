import { describe, it, expect } from 'vitest';
import { passwordProblem } from '../../pages/LoginPage';

describe('passwordProblem (blueprint 3.1 password rules)', () => {
  it.each([
    ['Ab1!', 'Password must be at least 8 characters.'],
    ['ABCDEFG1!', 'Password needs a lowercase letter.'],
    ['abcdefg1!', 'Password needs an uppercase letter.'],
    ['Abcdefgh!', 'Password needs a number.'],
    ['Abcdefg12', 'Password needs a symbol (e.g. ! @ # $).'],
  ])('%s is refused with the right message', (pw, msg) => { expect(passwordProblem(pw)).toBe(msg); });
  it('accepts a strong password', () => { expect(passwordProblem('Strong#Pass1')).toBeNull(); });
  it('checks length before anything else', () => { expect(passwordProblem('')).toBe('Password must be at least 8 characters.'); });
  it('exactly 8 characters with every class is accepted', () => { expect(passwordProblem('Aa1!aaaa')).toBeNull(); });
});
