import { describe, it, expect } from 'vitest';
import { niceMax, ticks, scaleLinear, linePath, donutSlices, arcPath, shortDay, heatColor, pctOf, mean } from '../../lib/chartMath';

describe('chart maths', () => {
  it('rounds the top of an axis up to a tidy number', () => {
    expect(niceMax(0)).toBe(1); expect(niceMax(7)).toBe(10); expect(niceMax(86)).toBe(100); expect(niceMax(2100)).toBe(2500); expect(niceMax(0.34)).toBe(0.5);
  });
  it('makes evenly spaced ticks', () => { expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100]); });
  it('scales linearly and survives a flat range', () => {
    const s = scaleLinear(0, 10, 100, 0); expect(s(0)).toBe(100); expect(s(10)).toBe(0); expect(s(5)).toBe(50);
    expect(scaleLinear(5, 5, 0, 10)(5)).toBe(5);
  });
  it('leaves a gap for missing values instead of drawing zero', () => {
    const d = linePath([1, null, 3, 4], i => i * 10, v => 100 - v);
    expect(d).toBe('M0.0,99.0M20.0,97.0L30.0,96.0');
    expect(linePath([null, null], i => i, v => v)).toBe('');
  });
  it('splits a donut by share and handles all zero', () => {
    const s = donutSlices([1, 1, 2]); expect(s.map(x => x.frac)).toEqual([0.25, 0.25, 0.5]);
    expect(s[2].end).toBeCloseTo(2 * Math.PI);
    expect(donutSlices([0, 0]).every(x => x.frac === 0)).toBe(true);
  });
  it('draws a full ring as a valid path', () => { expect(arcPath(60, 60, 30, 50, 0, 2 * Math.PI)).toMatch(/^M[\d.]+,[\d.]+ A/); });
  it('formats days in plain words', () => { expect(shortDay('2026-11-01')).toBe('1 Nov'); expect(shortDay('2026-01-15')).toBe('15 Jan'); });
  it('colours: no data is dark grey, none logged is grey, full is lime', () => {
    expect(heatColor(null)).toBe('#2A2A2D'); expect(heatColor(0)).toBe('#3A3A3C'); expect(heatColor(1)).toBe('#C8F75E');
  });
  it('percent and mean ignore missing values', () => {
    expect(pctOf(50, 200)).toBe(25); expect(pctOf(null, 200)).toBeNull(); expect(pctOf(5, 0)).toBeNull();
    expect(mean([1, null, 3])).toBe(2); expect(mean([null])).toBeNull(); expect(mean([])).toBeNull();
  });
});
