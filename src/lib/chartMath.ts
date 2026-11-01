/** Pure helpers for the charts (no React, easy to test). */
export const niceMax = (v: number): number => {
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * pow;
};
export const ticks = (max: number, n = 4): number[] => Array.from({ length: n + 1 }, (_, i) => +((max / n) * i).toFixed(4));
export const scaleLinear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
/** Line path with gaps wherever a value is missing (null), so missing data is never drawn as zero. */
export function linePath(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let d = ''; let pen = false;
  values.forEach((v, i) => {
    if (v == null || !isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
  });
  return d;
}
export function donutSlices(values: number[]): Array<{ start: number; end: number; frac: number }> {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  let acc = 0;
  return values.map(v => { const frac = total > 0 ? Math.max(0, v) / total : 0; const s = { start: acc * 2 * Math.PI, end: (acc + frac) * 2 * Math.PI, frac }; acc += frac; return s; });
}
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) a1 = a0 + 2 * Math.PI - 1e-4; // a full ring cannot be drawn as one arc
  const p = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map(n => n.toFixed(2));
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (iso: string): string => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`; };
/** Heat colour for a 0..1 share: grey (nothing) -> amber -> lime. null = no data. */
export function heatColor(v: number | null): string {
  if (v == null) return '#2A2A2D';
  if (v <= 0) return '#3A3A3C';
  if (v < 0.5) return '#7A5A1E';
  if (v < 0.85) return '#B58A2E';
  return '#C8F75E';
}
export const pctOf = (a: number | null | undefined, b: number | null | undefined): number | null => (a == null || !b ? null : Math.round((a / b) * 100));
/** Average of the non-null values; null when there is nothing to average. */
export const mean = (xs: Array<number | null | undefined>): number | null => { const v = xs.filter((x): x is number => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
