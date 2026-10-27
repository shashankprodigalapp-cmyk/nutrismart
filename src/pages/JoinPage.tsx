import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { coachApi } from '../lib/coachApi';

const SWITCHES: Array<[string, string, string]> = [
  ['food', 'Food log', 'Meals and calories you log'],
  ['energy', 'Energy', 'Your energy check-ins'],
  ['water', 'Water', 'Glasses of water'],
  ['weight', 'Weight', 'Weight entries (when added)'],
  ['mood', 'Mood', 'Mood check-ins (when added)'],
];

export default function JoinPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [coach, setCoach] = useState<{ display_name: string; credentials?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<Record<string, boolean>>({ food: true, energy: true, water: true, weight: true, mood: true });

  useEffect(() => {
    let live = true;
    coachApi<{ coach: { display_name: string; credentials?: string | null } }>('/api/coach-accept', { token, preview: true }).then(r => {
      if (!live) return;
      if (r.ok) setCoach(r.data.coach); else setError(r.data.message ?? 'This invite link is not valid.');
    });
    return () => { live = false; };
  }, [token]);

  const accept = async () => {
    setBusy(true); setError(null);
    const r = await coachApi('/api/coach-accept', { token, share_scope: scope });
    setBusy(false);
    if (r.ok) nav('/app/my-coach', { replace: true });
    else setError(r.data.message ?? 'Could not join. Please try again.');
  };

  return (
    <div className="min-h-dvh bg-[#111113] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1C1C1E] rounded-2xl p-5 space-y-4">
        <h1 className="text-xl font-bold">Join your coach</h1>
        {!coach && !error && <p className="text-sm text-[#8E8E93]">Checking your invite…</p>}
        {error && <p role="alert" className="text-sm text-[#FF6B6B]">{error}</p>}
        {coach && (
          <>
            <p className="text-sm text-[#EBEBF5]/80"><b>{coach.display_name}</b>{coach.credentials ? ` (${coach.credentials})` : ''} invited you.</p>
            <p className="text-xs text-[#8E8E93]">Choose what your coach can see. You can change this or leave any time in My coach.</p>
            <div className="space-y-2">
              {SWITCHES.map(([k, label, hint]) => (
                <label key={k} className="flex items-center justify-between gap-3 bg-[#242426] rounded-xl px-3 py-2.5">
                  <span><span className="block text-sm">{label}</span><span className="block text-[11px] text-[#8E8E93]">{hint}</span></span>
                  <input type="checkbox" checked={!!scope[k]} onChange={e => setScope(s => ({ ...s, [k]: e.target.checked }))} className="w-5 h-5 accent-[#C8F75E]" aria-label={`Share ${label}`} />
                </label>
              ))}
            </div>
            <button onClick={accept} disabled={busy} className="w-full bg-[#C8F75E] text-[#111113] font-bold rounded-xl py-3 disabled:opacity-50">
              {busy ? 'Joining…' : 'Accept and join'}
            </button>
          </>
        )}
        <Link to="/app/today" className="block text-center text-xs text-[#8E8E93] underline">Not now</Link>
      </div>
    </div>
  );
}
