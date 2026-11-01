import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { coachApi } from '../../lib/coachApi';
import { track } from '../../lib/analytics';

interface Rec { id: string; reason: string; evidence: string[]; confidence: string; action: string; expected_outcome: string; follow_up_at: string | null; status: string }
interface Data {
  signal: { headline: string; detail: string }; progress: { calories: number; protein: number; target_cal: number; target_protein: number };
  learned: string | null; recommendations: Rec[];
  smart_meal: { meal: string; items: Array<{ name: string; cal: number; protein: number }>; total: { cal: number; protein: number }; why: string; note?: string } | null;
}

const bar = (v: number, t: number) => Math.min(100, Math.round((v / Math.max(t, 1)) * 100));

/** The new Today (2.1): what matters, your progress, what NutriSmart learned, what to do next, a meal that fits. Hidden until the server says it is on. */
export function DailyIntelligence() {
  const [d, setD] = useState<Data | null>(null);
  const [done, setDone] = useState<Record<string, 'accepted' | 'dismissed'>>({});

  const load = useCallback(async () => {
    const r = await coachApi<Data>('/api/intel-refresh', {});
    if (r.ok && r.data.signal) setD(r.data as Data); else setD(null);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: 'accepted' | 'dismissed') {
    const r = await coachApi('/api/rec-action', { rec_id: id, action });
    if (r.ok) { setDone(x => ({ ...x, [id]: action })); track('recommendation_' + action, {}); }
  }
  if (!d) return null;
  const rec = d.recommendations[0];
  return (
    <section aria-label="Your day" className="space-y-3">
      <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-[#C8F75E]/20">
        <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Today's signal</h2>
        <p className="text-base font-semibold mt-1">{d.signal.headline}</p>
        <p className="text-sm text-[#C7C7CC] mt-0.5">{d.signal.detail}</p>
      </div>

      <div className="bg-[#1C1C1E] rounded-2xl p-4">
        <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Your progress</h2>
        {([['Calories', d.progress.calories, d.progress.target_cal, 'kcal', '#C8F75E'], ['Protein', d.progress.protein, d.progress.target_protein, 'g', '#30D158']] as const).map(([label, v, t, unit, color]) => (
          <div key={label} className="mt-2">
            <div className="flex justify-between text-xs text-[#8E8E93] mb-1"><span>{label}</span><span>{v} / {t} {unit}</span></div>
            <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${bar(v, t)}%`, background: color }} /></div>
          </div>
        ))}
      </div>

      {d.learned && (
        <Link to="/app/learned" className="block bg-[#1C1C1E] rounded-2xl p-4 min-h-[44px]">
          <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">What NutriSmart learned</h2>
          <p className="text-sm mt-1">{d.learned}</p>
          <p className="text-xs text-[#8E8E93] mt-1 underline">See everything we have learned</p>
        </Link>
      )}

      {rec && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4">
          <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">What to do next</h2>
          <p className="text-sm font-semibold mt-1">{rec.reason}</p>
          <p className="text-xs text-[#8E8E93] mt-1">{rec.evidence[0]}</p>
          <p className="text-sm mt-2">{rec.action}</p>
          <p className="text-xs text-[#8E8E93] mt-1">Expected: {rec.expected_outcome} <span className="uppercase">· {rec.confidence} confidence</span></p>
          {done[rec.id] ? (
            <p role="status" className="text-xs text-[#30D158] mt-3">{done[rec.id] === 'accepted' ? 'Noted. We will check how it went.' : 'Okay, we will not suggest this again for a week.'}</p>
          ) : (
            <div className="flex gap-2 mt-3">
              <button onClick={() => act(rec.id, 'accepted')} className="px-4 min-h-[44px] rounded-full bg-[#C8F75E] text-[#111113] text-sm font-semibold">I will try this</button>
              <button onClick={() => act(rec.id, 'dismissed')} className="px-4 min-h-[44px] rounded-full bg-[#242426] text-sm">Not now</button>
            </div>
          )}
        </div>
      )}

      {d.smart_meal && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4">
          <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Smart meal</h2>
          <p className="text-sm font-semibold mt-1 capitalize">{d.smart_meal.meal}: {d.smart_meal.items.map(i => i.name).join(' with ')}</p>
          <p className="text-xs text-[#8E8E93] mt-1">About {d.smart_meal.total.cal} kcal and {Math.round(d.smart_meal.total.protein)}g protein. {d.smart_meal.why}</p>
          {d.smart_meal.note && <p className="text-xs text-[#FFB347] mt-1">{d.smart_meal.note}</p>}
        </div>
      )}
    </section>
  );
}
