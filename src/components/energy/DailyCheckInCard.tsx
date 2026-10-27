import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { todayIST } from '../../lib/kitchenIntelligence';
import { track } from '../../lib/analytics';

type Sleep = 'poor' | 'okay' | 'good'; type Stress = 'low' | 'medium' | 'high';
interface Form { energy: number | null; mood: number | null; hunger: number | null; sleep: Sleep | null; stress: Stress | null }
const EMPTY: Form = { energy: null, mood: null, hunger: null, sleep: null, stress: null };

function Scale({ label, value, onChange, low, high }: { label: string; value: number | null; onChange: (n: number) => void; low: string; high: string }) {
  return (
    <div role="group" aria-label={label}>
      <div className="flex justify-between text-[11px] text-[#8E8E93] mb-1"><span>{label}</span><span>{low} to {high}</span></div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)} aria-pressed={value === n} aria-label={`${label} ${n} of 5`}
            className={`flex-1 min-h-[44px] rounded-xl text-sm ${value === n ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: T[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-[11px] text-[#8E8E93] mb-1">{label}</p>
      <div className="flex gap-1.5">
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)} aria-pressed={value === o}
            className={`flex-1 min-h-[44px] rounded-xl text-sm capitalize ${value === o ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{o}</button>
        ))}
      </div>
    </div>
  );
}

/** Morning check-in. Five taps, under ten seconds. Saved to the person's own row; they can change it all day. */
export function DailyCheckInCard() {
  const [f, setF] = useState<Form>(EMPTY);
  const [state, setState] = useState<'loading' | 'open' | 'saved' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const day = todayIST();

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('daily_checkins').select('energy, mood, hunger, sleep, stress').eq('log_date', day).maybeSingle();
      if (error) { setState('error'); return; }
      if (data) { setF(data as Form); setState('saved'); } else setState('open');
    })();
  }, [day]);

  async function save() {
    setBusy(true); setErr(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setBusy(false); setErr('Please sign in again.'); return; }
    const { error } = await supabase.from('daily_checkins').upsert({ user_id: u.user.id, log_date: day, ...f, updated_at: new Date().toISOString() }, { onConflict: 'user_id,log_date' });
    setBusy(false);
    if (error) { setErr('Could not save. Check your connection and try again.'); return; }
    track('daily_checkin_saved', { fields: Object.values(f).filter(v => v != null).length });
    setState('saved');
  }

  if (state === 'loading') return null;
  if (state === 'error') return null;   // table not there yet or offline: stay out of the way
  const any = Object.values(f).some(v => v != null);
  if (state === 'saved') {
    return (
      <div className="bg-[#1C1C1E] rounded-2xl p-4 flex items-center gap-3">
        <span className="text-xl">🌅</span>
        <div className="flex-1"><p className="text-sm font-semibold">Check-in saved</p><p className="text-xs text-[#8E8E93]">Thanks. It helps spot patterns over time.</p></div>
        <button onClick={() => setState('open')} className="px-3 min-h-[40px] rounded-full bg-[#242426] text-xs">Edit</button>
      </div>
    );
  }
  return (
    <section aria-label="Morning check-in" className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold">How are you feeling today?</p>
      <Scale label="Energy" value={f.energy} onChange={n => setF({ ...f, energy: n })} low="drained" high="great" />
      <Scale label="Mood" value={f.mood} onChange={n => setF({ ...f, mood: n })} low="low" high="great" />
      <Scale label="Hunger" value={f.hunger} onChange={n => setF({ ...f, hunger: n })} low="not hungry" high="very hungry" />
      <Pick<Sleep> label="Sleep last night" value={f.sleep} options={['poor', 'okay', 'good']} onChange={v => setF({ ...f, sleep: v })} />
      <Pick<Stress> label="Stress" value={f.stress} options={['low', 'medium', 'high']} onChange={v => setF({ ...f, stress: v })} />
      {err && <p role="alert" className="text-xs text-[#FF6B6B]">{err}</p>}
      <button disabled={!any || busy} onClick={save} className="w-full min-h-[44px] rounded-full bg-[#C8F75E] text-[#111113] font-semibold text-sm disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
      <p className="text-[11px] text-[#636366]">Answer only what you like. Skip the rest.</p>
    </section>
  );
}
