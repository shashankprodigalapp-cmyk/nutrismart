import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { coachApi } from '../lib/coachApi';

interface Section { heading: string; lines: string[] }
interface Report { title: string; period_start: string; period_end: string; based_on_days: number; sections: Section[] }
const TABS = [['learning', 'What we have learned'], ['weekly', 'Your week'], ['monthly', 'Your month']] as const;

export default function LearnedPage() {
  const [tab, setTab] = useState<typeof TABS[number][0]>('learning');
  const [rep, setRep] = useState<Report | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  useEffect(() => {
    let live = true; setState('loading');
    coachApi<{ report: Report }>('/api/intel-report', { period: tab }).then(r => {
      if (!live) return;
      if (r.ok && r.data.report) { setRep(r.data.report); setState('ready'); } else setState(r.status === 403 ? 'off' : 'error');
    });
    return () => { live = false; };
  }, [tab]);
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4">
      <Link to="/app" className="text-xs text-[#8E8E93] underline">← Back</Link>
      <h1 className="text-xl font-bold">What NutriSmart has learned</h1>
      <div role="tablist" className="flex gap-2 overflow-x-auto">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 min-h-[40px] rounded-full text-sm whitespace-nowrap ${tab === k ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{label}</button>
        ))}
      </div>
      {state === 'loading' && <p className="text-sm text-[#8E8E93]">Loading…</p>}
      {state === 'off' && <p className="text-sm text-[#8E8E93]">This report is not switched on yet.</p>}
      {state === 'error' && <p role="alert" className="text-sm text-[#FF6B6B]">Could not load. Check your connection and try again.</p>}
      {state === 'ready' && rep && (
        <>
          <p className="text-xs text-[#8E8E93]">{rep.period_start} to {rep.period_end} · based on {rep.based_on_days} logged days</p>
          {rep.sections.map(s => (
            <section key={s.heading} className="bg-[#1C1C1E] rounded-2xl p-4">
              <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{s.heading}</h2>
              <ul className="mt-2 space-y-1.5">{s.lines.map((l, i) => <li key={i} className="text-sm text-[#EBEBF5]/90">{l}</li>)}</ul>
            </section>
          ))}
          <p className="text-[11px] text-[#636366]">Built from your own logs. General guidance, not medical advice.</p>
        </>
      )}
    </div>
  );
}
