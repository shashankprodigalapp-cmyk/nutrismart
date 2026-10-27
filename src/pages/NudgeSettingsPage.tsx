import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Prefs { log_reminders: boolean; coach_nudges: boolean; quiet_start: number; quiet_end: number; max_per_day: number }
const DEFAULTS: Prefs = { log_reminders: false, coach_nudges: true, quiet_start: 1290, quiet_end: 450, max_per_day: 2 };
interface Nudge { id: string; kind: string; title: string; body: string; status: string; created_at: string }

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromTime = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export default function NudgeSettingsPage() {
  const [p, setP] = useState<Prefs | null>(null);
  const [recent, setRecent] = useState<Nudge[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { setState('error'); return; }
      const [a, b] = await Promise.all([
        supabase.from('nudge_preferences').select('log_reminders, coach_nudges, quiet_start, quiet_end, max_per_day').eq('user_id', uid).maybeSingle(),
        supabase.from('nudges').select('id, kind, title, body, status, created_at').eq('user_id', uid).eq('status', 'sent').order('created_at', { ascending: false }).limit(10),
      ]);
      if (a.error || b.error) { setState('error'); return; }
      setP({ ...DEFAULTS, ...(a.data ?? {}) }); setRecent((b.data ?? []) as Nudge[]); setState('ready');
    })();
  }, []);

  async function save(next: Prefs) {
    setP(next); setSaved(null);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('nudge_preferences').upsert({ user_id: u.user!.id, ...next, updated_at: new Date().toISOString() });
    setSaved(error ? 'Could not save. Try again.' : 'Saved');
  }

  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4">
      <Link to="/app" className="text-xs text-[#8E8E93] underline">← Back</Link>
      <h1 className="text-xl font-bold">Reminders and messages</h1>
      {state === 'loading' && <p className="text-sm text-[#8E8E93]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-sm text-[#FF6B6B]">Could not load your settings. Check your connection and try again.</p>}
      {state === 'ready' && p && (
        <>
          <div className="bg-[#1C1C1E] rounded-2xl divide-y divide-white/[0.06]">
            <label className="flex items-center gap-3 p-4 min-h-[56px]">
              <span className="flex-1"><span className="block text-sm">Evening log reminder</span><span className="block text-xs text-[#8E8E93]">Only if you have not logged anything by 7 pm, and only on days you usually log.</span></span>
              <input type="checkbox" checked={p.log_reminders} onChange={e => save({ ...p, log_reminders: e.target.checked })} className="w-6 h-6" />
            </label>
            <label className="flex items-center gap-3 p-4 min-h-[56px]">
              <span className="flex-1"><span className="block text-sm">Messages from my coach</span><span className="block text-xs text-[#8E8E93]">Short notes. Never more than one a day from the same coach.</span></span>
              <input type="checkbox" checked={p.coach_nudges} onChange={e => save({ ...p, coach_nudges: e.target.checked })} className="w-6 h-6" />
            </label>
            <div className="p-4 space-y-3">
              <p className="text-sm">Quiet hours</p>
              <div className="flex items-center gap-2 text-sm">
                <input type="time" aria-label="Quiet hours start" value={toTime(p.quiet_start)} onChange={e => save({ ...p, quiet_start: fromTime(e.target.value) })} className="bg-[#242426] rounded-lg px-2 py-2" />
                <span className="text-[#8E8E93]">to</span>
                <input type="time" aria-label="Quiet hours end" value={toTime(p.quiet_end)} onChange={e => save({ ...p, quiet_end: fromTime(e.target.value) })} className="bg-[#242426] rounded-lg px-2 py-2" />
              </div>
              <label className="flex items-center gap-2 text-sm">Most per day
                <select value={p.max_per_day} onChange={e => save({ ...p, max_per_day: Number(e.target.value) })} className="bg-[#242426] rounded-lg px-2 py-2">
                  {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
                </select></label>
            </div>
          </div>
          {saved && <p role="status" className={`text-xs ${saved === 'Saved' ? 'text-[#30D158]' : 'text-[#FF6B6B]'}`}>{saved}</p>}
          <p className="text-xs text-[#8E8E93]">Daily reminders for meals and energy are separate and are not affected here.</p>
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-[#8E8E93]">Recent</h2>
            {recent.length === 0 ? <p className="text-sm text-[#8E8E93]">Nothing sent yet.</p> : recent.map(n => (
              <div key={n.id} className="bg-[#1C1C1E] rounded-xl p-3"><p className="text-xs text-[#8E8E93]">{n.title} · {new Date(n.created_at).toLocaleDateString('en-IN')}</p><p className="text-sm">{n.body}</p></div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
