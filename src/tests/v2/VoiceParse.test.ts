import { describe, it, expect } from 'vitest';
import { parseUtterance } from '../../lib/voiceParse';

const names = (t: string) => parseUtterance(t).map(i => `${i.qty}|${i.name}`);

describe('parseUtterance', () => {
  it('splits a simple English meal', () => {
    expect(names('2 roti and dal')).toEqual(['2|roti', '1|dal']);
  });
  it('handles a, an and unit words', () => {
    expect(names('a glass of chai and a bowl of rice')).toEqual(['1|chai', '1|rice']);
    expect(names('two cups of tea')).toEqual(['2|tea']);
  });
  it('strips filler phrases', () => {
    expect(names('I had 3 idli for breakfast')).toEqual(['3|idli']);
    expect(names('maine 2 paratha khaya')).toEqual(['2|paratha']);
  });
  it('understands Hinglish numbers and joiners', () => {
    expect(names('do roti aur ek katori dal')).toEqual(['2|roti', '1|dal']);
    expect(names('aadha paratha, 1 glass lassi')).toEqual(['0.5|paratha', '1|lassi']);
  });
  it('understands Hindi script', () => {
    expect(names('दो रोटी और एक कटोरी दाल')).toEqual(['2|रोटी', '1|दाल']);
    expect(names('३ इडली')).toEqual(['3|इडली']);
  });
  it('fractions and decimals', () => {
    expect(names('1/2 cup poha')).toEqual(['0.5|poha']);
    expect(names('1.5 roti')).toEqual(['1.5|roti']);
  });
  it('a couple of', () => { expect(names('a couple of eggs')).toEqual(['2|eggs']); });
  it('caps items and quantity, ignores empty input', () => {
    expect(parseUtterance('a, b, c, d, e, f, g, h, i, j').length).toBe(0);   // single letters are not foods
    expect(parseUtterance('egg, rice, dal, roti, curd, milk, tea, poha, idli, dosa').length).toBe(8);
    expect(parseUtterance('99 roti')[0].qty).toBe(20);
    expect(parseUtterance('   ')).toEqual([]);
  });
  it('is deterministic', () => { expect(parseUtterance('2 roti and dal')).toEqual(parseUtterance('2 roti and dal')); });
});
