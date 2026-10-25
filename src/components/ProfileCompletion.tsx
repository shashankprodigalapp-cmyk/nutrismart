/**
 * ProfileCompletion.tsx: five optional questions that earn 5 extra AI searches a day.
 * Lives in the Profile tab (and a gentle nudge on Today). Sign-in stays exactly as easy as before.
 * The database decides whether a profile counts as complete, so the bonus cannot be faked.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import {
  AGE_BANDS, GENDERS, GOALS, DIETS, STATES, BONUS_SEARCHES, EMPTY_ANSWERS, answeredCount, isComplete, type ProfileAnswers,
} from '../lib/profileOptions';

const UPDATED = 'ns-profile-updated';

export function useProfileStatus() {
  const { user } = useAuth();
  const [answers, setAnswers] = useState<ProfileAnswers>(EMPTY_ANSWERS);
  const [completed, setCompleted] = useState(false);
  const [hasRow, setHasRow] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data } = await supabase.from('user_profile')
        .select('age_band, gender, state, goal, diet, completed_at').eq('user_id', user.id).maybeSingle();
      setHasRow(!!data);
      setAnswers({
        age_band: data?.age_band ?? null, gender: data?.gender ?? null, state: data?.state ?? null,
        goal: data?.goal ?? null, diet: data?.diet ?? null,
      });
      setCompleted(!!data?.completed_at);
    } catch { /* leave as is */ }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener(UPDATED, on);
    return () => window.removeEventListener(UPDATED, on);
  }, [reload]);

  return { answers, completed, hasRow, loading, reload };
}

function Chips({ options, value, onPick }: { options: { v: string; label: string }[]; value: string | null; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o.v} type="button" onClick={() => onPick(o.v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border active:scale-95 transition-transform ${
            value === o.v ? 'bg-[#C8F75E]/15 border-[#C8F75E]/60 text-[#C8F75E]' : 'bg-white/[0.04] border-white/[0.08] text-white'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ProfileCompletionCard() {
  const { user } = useAuth();
  const { answers: saved, completed, hasRow, loading, reload } = useProfileStatus();
  const [a, setA] = useState<ProfileAnswers>(EMPTY_ANSWERS);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { setA(saved); setConsent(hasRow); }, [saved.age_band, saved.gender, saved.state, saved.goal, saved.diet, hasRow]);

  if (loading || !user) return null;

  const n = answeredCount(a);
  const set = (k: keyof ProfileAnswers, v: string) => { setA(p => ({ ...p, [k]: v })); setMsg(null); };

  const save = async () => {
    if (!consent) { setMsg({ ok: false, text: 'Please tick the box to agree before saving.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('user_profile').upsert({
      user_id: user.id, ...a, consent_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: 'Could not save. Check your connection and try again.' }); return; }
    track('profile_saved', { answered: n });
    if (isComplete(a, consent)) track('profile_completed');
    setMsg({ ok: true, text: isComplete(a, consent)
      ? `Done! You now get ${5 + BONUS_SEARCHES} AI searches every day.`
      : `Saved. ${5 - n} more to go.` });
    window.dispatchEvent(new Event(UPDATED));
    void reload();
  };

  const remove = async () => {
    setBusy(true);
    await supabase.from('user_profile').delete().eq('user_id', user.id);
    setBusy(false);
    setA(EMPTY_ANSWERS); setConsent(false);
    setMsg({ ok: true, text: 'Your answers were deleted.' });
    window.dispatchEvent(new Event(UPDATED));
    void reload();
  };

  return (
    <div className={`rounded-2xl p-4 ${completed ? 'bg-[#1C1C1E]' : 'bg-[#C8F75E]/10 border border-[#C8F75E]/30'}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">
            {completed ? `Profile complete. ${5 + BONUS_SEARCHES} AI searches a day unlocked` : `Complete your profile, get ${BONUS_SEARCHES} more AI searches every day`}
          </p>
          <p className="text-xs text-[#8E8E93] mt-0.5">{completed ? 'Tap to review or change your answers' : `${n} of 5 answered. Takes about 30 seconds.`}</p>
        </div>
        <span className="text-[#C8F75E] text-lg">{open ? '−' : '+'}</span>
      </button>
      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden mt-3">
        <div className="h-full bg-[#C8F75E] transition-all" style={{ width: `${(n / 5) * 100}%` }} />
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div><p className="text-xs text-[#8E8E93] mb-1.5">Age</p><Chips options={AGE_BANDS} value={a.age_band} onPick={v => set('age_band', v)} /></div>
          <div><p className="text-xs text-[#8E8E93] mb-1.5">Gender</p><Chips options={GENDERS} value={a.gender} onPick={v => set('gender', v)} /></div>
          <div>
            <p className="text-xs text-[#8E8E93] mb-1.5">State</p>
            <select value={a.state ?? ''} onChange={e => set('state', e.target.value)}
              className="w-full rounded-xl bg-[#111113] border border-white/[0.1] px-3 py-2 text-sm text-white">
              <option value="">Choose your state</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><p className="text-xs text-[#8E8E93] mb-1.5">Main goal</p><Chips options={GOALS} value={a.goal} onPick={v => set('goal', v)} /></div>
          <div><p className="text-xs text-[#8E8E93] mb-1.5">Diet</p><Chips options={DIETS} value={a.diet} onPick={v => set('diet', v)} /></div>

          <label className="flex items-start gap-2 text-[11px] text-[#8E8E93] leading-snug">
            <input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setMsg(null); }} className="mt-0.5" />
            <span>I agree that NutriSmart may use these answers, only as anonymous totals, to improve the app. They are never sold or shared, and I can change or delete them here at any time. NutriSmart is for adults, 18 and over.</span>
          </label>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy}
              className="px-4 py-2 rounded-xl bg-[#C8F75E] text-[#111113] text-sm font-bold disabled:opacity-50">{busy ? 'Saving...' : 'Save'}</button>
            {hasRow && <button type="button" onClick={() => void remove()} disabled={busy} className="text-xs text-[#8E8E93] underline">Delete my answers</button>}
          </div>
          {msg && <p className={`text-xs ${msg.ok ? 'text-[#C8F75E]' : 'text-[#FF5D5D]'}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

/** A small dismissible banner for the Today screen. Hidden once the profile is complete. */
export function ProfileNudge() {
  const { user } = useAuth();
  const { completed, loading } = useProfileStatus();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem('ns_profile_nudge_until') ?? 0) > Date.now(); } catch { return false; }
  });
  if (loading || completed || hidden || !user) return null;
  const ageDays = user.created_at ? (Date.now() - new Date(user.created_at).getTime()) / 86_400_000 : 0;
  if (ageDays < 1) return null;

  const dismiss = () => {
    try { localStorage.setItem('ns_profile_nudge_until', String(Date.now() + 7 * 86_400_000)); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <div className="rounded-2xl bg-[#C8F75E]/10 border border-[#C8F75E]/30 p-3 flex items-center gap-3">
      <button type="button" className="flex-1 text-left" onClick={() => { track('profile_nudge_tapped'); navigate('/app/profile'); }}>
        <p className="text-sm font-semibold text-white">Get {BONUS_SEARCHES} more AI searches every day</p>
        <p className="text-xs text-[#8E8E93]">Answer 5 quick questions in your profile. About 30 seconds.</p>
      </button>
      <button type="button" onClick={dismiss} aria-label="Hide for a week" className="text-[#8E8E93] text-lg px-1">×</button>
    </div>
  );
}
