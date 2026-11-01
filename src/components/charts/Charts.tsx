/** Small charts in plain SVG (no chart library). Dark theme, every chart has a text label for screen readers. */
import React from 'react';
import { niceMax, ticks, scaleLinear, linePath, donutSlices, arcPath, heatColor } from '../../lib/chartMath';

export const PALETTE = ['#C8F75E', '#64D2FF', '#FFB340', '#BF5AF2', '#FF6B6B', '#30D158'];
const AXIS = '#636366'; const GRID = 'rgba(255,255,255,0.07)'; const TEXT = '#8E8E93';

export interface Series { name: string; color?: string; values: Array<number | null>; dashed?: boolean }

export function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#C7C7CC] mt-2">{items.map(i => <li key={i.name} className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />{i.name}</li>)}</ul>;
}

export function LineChart({ series, labels, height = 180, label, yMax, yFormat = (v: number) => String(Math.round(v)), target, targetLabel }: {
  series: Series[]; labels: string[]; height?: number; label: string; yMax?: number; yFormat?: (v: number) => string; target?: number | null; targetLabel?: string;
}) {
  const W = 640, H = height, L = 38, R = 8, T = 8, B = 22;
  const all = series.flatMap(s => s.values).filter((v): v is number => v != null);
  const max = yMax ?? niceMax(Math.max(...all, target ?? 0, 1));
  const x = (i: number) => labels.length <= 1 ? (L + W - R) / 2 : L + (i / (labels.length - 1)) * (W - L - R);
  const y = scaleLinear(0, max, H - B, T);
  const step = Math.max(1, Math.ceil(labels.length / 7));
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? PALETTE[i % PALETTE.length] }));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
        <title>{label}</title>
        {ticks(max).map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={TEXT}>{yFormat(t)}</text></g>)}
        {labels.map((l, i) => i % step === 0 || i === labels.length - 1 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill={TEXT}>{l}</text> : null)}
        {target != null && <g><line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="#C8F75E" strokeDasharray="4 4" opacity="0.55" />{targetLabel && <text x={W - R} y={y(target) - 4} textAnchor="end" fontSize="10" fill="#C8F75E">{targetLabel}</text>}</g>}
        {colored.map(s => <g key={s.name}>
          <path d={linePath(s.values, x, y)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          {s.values.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={labels.length > 20 ? 1.5 : 2.5} fill={s.color}><title>{`${s.name}, ${labels[i]}: ${yFormat(v)}`}</title></circle>)}
        </g>)}
      </svg>
      {series.length > 1 && <Legend items={colored.map(s => ({ name: s.name, color: s.color }))} />}
    </div>
  );
}

export function BarChart({ values, labels, color = '#C8F75E', height = 160, label, yFormat = (v: number) => String(Math.round(v)), highlightLast }: {
  values: Array<number | null>; labels: string[]; color?: string; height?: number; label: string; yFormat?: (v: number) => string; highlightLast?: boolean;
}) {
  const W = 640, H = height, L = 38, R = 8, T = 8, B = 22;
  const max = niceMax(Math.max(...values.map(v => v ?? 0), 1));
  const bw = (W - L - R) / Math.max(values.length, 1);
  const y = scaleLinear(0, max, H - B, T);
  const step = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
      <title>{label}</title>
      {ticks(max).map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={TEXT}>{yFormat(t)}</text></g>)}
      {values.map((v, i) => v == null ? null : <rect key={i} x={L + i * bw + bw * 0.15} y={y(v)} width={bw * 0.7} height={Math.max(0, H - B - y(v))} rx="2" fill={highlightLast && i === values.length - 1 ? '#FFFFFF' : color}><title>{`${labels[i]}: ${yFormat(v)}`}</title></rect>)}
      {labels.map((l, i) => i % step === 0 ? <text key={i} x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={TEXT}>{l}</text> : null)}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke={AXIS} />
    </svg>
  );
}

export function Donut({ slices, center, sub, label }: { slices: Array<{ label: string; value: number; color: string }>; center: string; sub?: string; label: string }) {
  const parts = donutSlices(slices.map(s => s.value));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 120 120" className="w-32 h-32 shrink-0" role="img" aria-label={label}>
        <title>{label}</title>
        {total === 0 ? <circle cx="60" cy="60" r="44" fill="none" stroke="#2A2A2D" strokeWidth="18" /> :
          parts.map((p, i) => p.frac > 0 ? <path key={i} d={arcPath(60, 60, 35, 52, p.start, p.end)} fill={slices[i].color}><title>{`${slices[i].label}: ${slices[i].value}`}</title></path> : null)}
        <text x="60" y={sub ? 58 : 65} textAnchor="middle" fontSize="20" fontWeight="800" fill="#FFFFFF">{center}</text>
        {sub && <text x="60" y="74" textAnchor="middle" fontSize="9" fill={TEXT}>{sub}</text>}
      </svg>
      <ul className="text-xs text-[#C7C7CC] space-y-1">{slices.map(s => <li key={s.label} className="flex items-center gap-2"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}<b className="text-white ml-1">{s.value}</b></li>)}</ul>
    </div>
  );
}

/** Rows of cells (one per day). Each cell is a 0..1 share, or null for "no data". */
export function Heatmap({ rows, colLabels, label, cellTitle }: {
  rows: Array<{ label: string; cells: Array<number | null>; href?: string }>; colLabels: string[]; label: string; cellTitle?: (row: string, col: string, v: number | null) => string;
}) {
  const cw = 18, ch = 16, gap = 2, lw = 130;
  const W = lw + colLabels.length * (cw + gap), H = rows.length * (ch + gap) + 20;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 520) }} className="w-full h-auto" role="img" aria-label={label}>
        <title>{label}</title>
        {colLabels.map((c, i) => i % 2 === 0 ? <text key={i} x={lw + i * (cw + gap) + cw / 2} y={10} textAnchor="middle" fontSize="8" fill={TEXT}>{c}</text> : null)}
        {rows.map((r, ri) => <g key={r.label}>
          <text x={lw - 6} y={20 + ri * (ch + gap) + 11} textAnchor="end" fontSize="9.5" fill="#C7C7CC">{r.label.length > 20 ? r.label.slice(0, 19) + '…' : r.label}</text>
          {r.cells.map((v, ci) => <rect key={ci} x={lw + ci * (cw + gap)} y={16 + ri * (ch + gap)} width={cw} height={ch} rx="3" fill={heatColor(v)}><title>{cellTitle ? cellTitle(r.label, colLabels[ci], v) : `${r.label}, ${colLabels[ci]}`}</title></rect>)}
        </g>)}
      </svg>
    </div>
  );
}

export function Sparkline({ values, color = '#C8F75E', width = 90, height = 24, label }: { values: Array<number | null>; color?: string; width?: number; height?: number; label: string }) {
  const nums = values.filter((v): v is number => v != null);
  const max = Math.max(...nums, 1);
  const x = (i: number) => 2 + (i / Math.max(values.length - 1, 1)) * (width - 4);
  const y = scaleLinear(0, max, height - 2, 2);
  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}><path d={linePath(values, x, y)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
