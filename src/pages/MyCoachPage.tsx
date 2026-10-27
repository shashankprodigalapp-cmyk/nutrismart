import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { coachApi } from '../lib/coachApi';

interface Rel { id: string; coach_id: string; status: string; share_scope: Record<string, boolean>; accepted_at: string | null }
const LABELS: Record<string, string> = { food: 'Food log', energy: 'Energy', water: 'Water', weight: 'Weight', mood: 'Mood' };

export default function MyCoachPage() {
  const [rels, setRels] = useState<Rel[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: e } = await supabase.from('coach_client_relationships')
      .select('id, coach_id, status, share_scope, accepted_at').in('status', ['active', 'paused']).order('accepted_at', { ascending: false });
    if (e) { setError('Could not load your coach. Try again.'); setLoading(false); return; }
    const list = (data ?? []) as Rel[];
    setRels(list);
    if (list.length) {
      const { data: cps } = await supabase.from('coach_profiles').select('user_id, display_name').in('user_id', list.map(r => r.coach_id));
      setNames(Object.fromEntries((cps ?? []).map((c: { user_id: string; display_name: string }) => [c.user_id, c.display_name])));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: string, share_scope?: Record<string, boolean>) => {
    setBusyId(id); setError(null);
    const r = await coachApi('/api/coach-relationship', { id, action, share_scope });
    setBusyId(null);
    if (!r.ok) setError(r.data.message ?? 'That did not work. Please try again.');
    void load();
  };

  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-bold">My coach</h1>
        <Link to="/app/profile" className="text-xs text-[#8E8E93] underline">Back</Link>
      </div>
      {error && <p role="alert" className="text-sm text-[#FF6B6B]">{error}</p>}
      {loading && <p className="text-sm text-[#8E8E93]">Loading…</p>}
      {!loading && !rels.length && !error && (
        <div className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">You are not linked to a coach. When a coach sends you an invite link, open it to join.</div>
      )}
      {rels.map(r => (
        <div key={r.id} className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{names[r.coach_id] ?? 'Your coach'}</p>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${r.status === 'active' ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-[#FFB347]/15 text-[#FFB347]'}`}>
              {r.status === 'active' ? 'Active' : 'Paused'}
            </span>
          </div>
          <p className="text-xs text-[#8E8E93]">Your coach can see:</p>
          <div className="space-y-1">
            {Object.keys(LABELS).map(k => (
              <label key={k} className="flex items-center justify-between text-sm">
                {LABELS[k]}
                <input type="checkbox" checked={!!r.share_scope[k]} disabled={busyId === r.id}
                  onChange={e => void act(r.id, 'scope', { ...r.share_scope, [k]: e.target.checked })}
                  className="w-5 h-5 accent-[#C8F75E]" aria-label={`Share ${LABELS[k]}`} />
              </label>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            {r.status === 'active'
              ? <button onClick={() => void act(r.id, 'pause')} disabled={busyId === r.id} className="flex-1 bg-[#2C2C2E] rounded-xl py-2.5 text-sm">Pause sharing</button>
              : <button onClick={() => void act(r.id, 'resume')} disabled={busyId === r.id} className="flex-1 bg-[#2C2C2E] rounded-xl py-2.5 text-sm">Resume sharing</button>}
            <button
              onClick={() => { if (window.confirm('Stop working with this coach? They will no longer see your data.')) void act(r.id, 'end'); }}
              disabled={busyId === r.id} className="flex-1 bg-[#FF6B6B]/15 text-[#FF6B6B] rounded-xl py-2.5 text-sm">Leave coach</button>
          </div>
        </div>
      ))}
    </div>
  );
}
