/** Small shared pieces for the admin Insights and Free tier screens. Pure SVG and Tailwind, no chart library. */
import React from 'react';

export type Status = 'ok' | 'warn' | 'critical' | 'unknown';

export const fmtNum = (n: number | null | undefined): string =>
  n == null ? 'n/a' : new Intl.NumberFormat('en-IN').format(Math.round(n));

export const fmtBytes = (b: number | null | undefined): string => {
  if (b == null) return 'n/a';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(b / 1024))} KB`;
};

export const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '0%');

export const STATUS_STYLE: Record<Status, { dot: string; text: string; label: string }> = {
  ok:       { dot: 'bg-[#C8F75E]', text: 'text-[#C8F75E]', label: 'Fine' },
  warn:     { dot: 'bg-[#FFB340]', text: 'text-[#FFB340]', label: 'Getting close' },
  critical: { dot: 'bg-[#FF5D5D]', text: 'text-[#FF5D5D]', label: 'Over or nearly over' },
  unknown:  { dot: 'bg-[#636366]', text: 'text-[#8E8E93]', label: 'Not measured' },
};

export function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#1C1C1E] rounded-2xl p-4 md:p-5 border border-white/[0.06]">
      {title && <h3 className="text-sm font-bold text-white">{title}</h3>}
      {hint && <p className="text-xs text-[#8E8E93] mt-0.5 mb-3">{hint}</p>}
      {!hint && title && <div className="mb-3" />}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-white/[0.06]">
      <p className="text-[11px] uppercase tracking-wide text-[#8E8E93] font-semibold">{label}</p>
      <p className="text-2xl font-extrabold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-[#8E8E93] mt-1">{sub}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#8E8E93] py-3">{children}</p>;
}

/** One horizontal bar with a label and a number. */
export function HBar({ label, value, max, right, tone = 'lime' }: { label: string; value: number; max: number; right?: string; tone?: 'lime' | 'grey' }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-white truncate pr-2">{label}</span>
        <span className="text-[#8E8E93] shrink-0">{right ?? fmtNum(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${tone === 'lime' ? 'bg-[#C8F75E]' : 'bg-[#636366]'}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/** Simple vertical bar chart. `series` bars may be stacked from several parts. */
export function Bars({
  items, height = 120, parts,
}: {
  items: { label: string; values: number[] }[];
  height?: number;
  parts: { name: string; color: string }[];
}) {
  const totals = items.map(i => i.values.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const W = 640, pad = 4, n = Math.max(1, items.length);
  const bw = Math.max(3, (W - pad * (n + 1)) / n);
  const H = height;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Bar chart by day">
        {items.map((it, i) => {
          let y = H;
          const x = pad + i * (bw + pad);
          return (
            <g key={it.label + i}>
              {it.values.map((v, k) => {
                const h = (v / max) * (H - 4);
                y -= h;
                return h > 0 ? <rect key={k} x={x} y={y} width={bw} height={h} rx={2} fill={parts[k]?.color ?? '#C8F75E'} /> : null;
              })}
              {(i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0) && (
                <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="10" fill="#8E8E93">{it.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {parts.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-1">
          {parts.map(p => (
            <span key={p.name} className="flex items-center gap-1 text-[11px] text-[#8E8E93]">
              <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Meter({
  label, used, limit, status, note, link, projected, format,
}: {
  label: string; used: number | null; limit: number | null; status: Status; note: string; link?: string;
  projected?: number | null; format: (n: number | null) => string;
}) {
  const s = STATUS_STYLE[status];
  const ratio = used != null && limit ? Math.min(1, used / limit) : 0;
  return (
    <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-white">{label}</p>
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${s.text}`}>
          <i className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />{s.label}
        </span>
      </div>
      <p className="text-xl font-extrabold text-white mt-2">
        {format(used)}
        <span className="text-sm font-medium text-[#8E8E93]"> {limit ? `of ${format(limit)}` : ''}</span>
      </p>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden mt-2">
        <div className={`h-full rounded-full ${s.dot}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {projected != null && limit ? (
        <p className="text-xs text-[#8E8E93] mt-2">On pace for about {format(projected)} by the end of the day.</p>
      ) : null}
      <p className="text-xs text-[#8E8E93] mt-2">{note}</p>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="inline-block text-xs text-[#C8F75E] mt-2 underline">Open the provider's own page</a>
      )}
    </div>
  );
}
