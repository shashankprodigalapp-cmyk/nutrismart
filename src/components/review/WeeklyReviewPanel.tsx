import React, { useCallback, useEffect, useState } from 'react';
import { coachApi } from '../../lib/coachApi';
import { track } from '../../lib/analytics';
import '../../styles/today.css';
import '../../styles/weekly.css';
import ReviewView, { type ReviewSections, type ReviewFact } from './ReviewView';

interface Review {
  id: string; week_start: string; status: 'draft' | 'approved' | 'edited' | 'rejected'; source: 'ai' | 'rules';
  sections: ReviewSections; facts: ReviewFact[]; generated_at: string; days_logged: number; days_elapsed: number;
}
type Resp = { review?: Review; pending_coach?: boolean; message?: string };

const LABEL = { draft: 'Draft, not yet shared', approved: 'Approved and shared', edited: 'Edited and shared', rejected: 'Rejected' } as const;

// mode 'coach': approve / edit / reject / refresh. mode 'self': read-only view of the person's own review.
export default function WeeklyReviewPanel({ clientId, mode }: { clientId?: string; mode: 'coach' | 'self' }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [week, setWeek] = useState<'last' | 'current'>('last');
  const [state, setState] = useState<'loading' | 'ready' | 'pending' | 'off' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const [rev, setRev] = useState<Review | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReviewSections | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setState('loading'); setMsg('');
    const r = await coachApi<Resp>('/api/weekly-review', { client_id: clientId, period, week, refresh });
    if (r.status === 403 && r.data.error === 'weekly_review_off') { setState('off'); return; }
    if (!r.ok) { setMsg(r.data.message ?? 'Could not load the review.'); setState('error'); return; }
    if (r.data.pending_coach) { setMsg(r.data.message ?? ''); setState('pending'); return; }
    setRev(r.data.review ?? null); setState('ready');
    track(mode === 'self' ? `${period}ly_review_viewed` : 'ai_review_generated', { period, source: r.data.review?.source ?? 'rules' }, 60_000);
  }, [clientId, week, mode, period]);

  useEffect(() => { load(); }, [load]);

  async function decide(action: 'approve' | 'reject' | 'edit') {
    if (!rev) return;
    setBusy(true); setMsg('');
    const r = await coachApi('/api/weekly-review-decision', { id: rev.id, period, action, sections: action === 'edit' ? draft : undefined });
    setBusy(false);
    if (!r.ok) { setMsg(r.data.message ?? 'Could not save. Try again.'); return; }
    track(`ai_review_${action === 'approve' ? 'approved' : action === 'edit' ? 'edited' : 'rejected'}`);
    setEditing(false); load();
  }

  function startEdit() { if (rev) { setDraft(JSON.parse(JSON.stringify(rev.sections))); setEditing(true); } }
  function setItem(key: 'wins' | 'challenges' | 'next_week_focus', i: number, text: string) {
    setDraft(d => d ? { ...d, [key]: d[key].map((it, j) => j === i ? { ...it, text } : it) } : d);
  }

  if (state === 'off') return <p className="nr-note">{period === 'month' ? 'Monthly' : 'Weekly'} reviews are not switched on yet.</p>;
  return (
    <div className="nr-flow">
      <div className="nr-pills">
        {(['week', 'month'] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p}
            className="nr-pill">{p === 'week' ? 'Weekly' : 'Monthly'}</button>
        ))}
      </div>
      <div className="nr-pills">
        {(['last', 'current'] as const).map(w => (
          <button key={w} onClick={() => setWeek(w)} aria-pressed={week === w}
            className="nr-pill">{w === 'last' ? `Last ${period}` : `This ${period} so far`}</button>
        ))}
      </div>
      {state === 'loading' && <p className="nr-meta">Preparing the review…</p>}
      {state === 'error' && (
        <div role="alert" className="nr-err">{msg}
          <button onClick={() => load()} className="ml-3 underline min-h-[44px]">Try again</button></div>
      )}
      {state === 'pending' && <p className="nr-note">{msg}</p>}
      {state === 'ready' && rev && (
        <>
          <p className="nr-meta">
            {period === 'month' ? 'Month starting' : 'Week of'} {rev.week_start} · {rev.days_logged} of {rev.days_elapsed} days logged · {rev.source === 'ai' ? 'Written with AI from your numbers' : 'Written from your numbers'}
            {mode === 'coach' && <> · <strong>{LABEL[rev.status]}</strong></>}
          </p>
          {rev.days_logged < 3 && <p className="nr-note">Fewer than 3 days logged, so this is only a light summary. Patterns need more days.</p>}
          {!editing && <ReviewView sections={rev.sections} facts={rev.facts} showCoachLine={mode === 'coach'} />}
          {editing && draft && (
            <div className="nr-flow nr-edit">
              <label>Headline
                <textarea value={draft.headline.text} onChange={e => setDraft({ ...draft, headline: { ...draft.headline, text: e.target.value } })} maxLength={280} rows={2}
                  /></label>
              {(['wins', 'challenges', 'next_week_focus'] as const).map(k => draft[k].map((it, i) => (
                <label key={k + i}>{k === 'wins' ? 'Went well' : k === 'challenges' ? 'Harder' : 'Next week'} {i + 1}
                  <textarea value={it.text} onChange={e => setItem(k, i, e.target.value)} maxLength={280} rows={2} /></label>
              )))}
              <p className="nr-meta">Other sections stay as generated.</p>
            </div>
          )}
          {msg && <p role="alert" className="nr-err">{msg}</p>}
          {mode === 'coach' && (
            <div className="nr-act">
              {!editing ? (
                <>
                  <button disabled={busy} onClick={() => decide('approve')} className="nr-btn primary">Approve and share</button>
                  <button disabled={busy} onClick={startEdit} className="nr-btn">Edit</button>
                  <button disabled={busy} onClick={() => decide('reject')} className="nr-btn danger">Reject</button>
                  <button disabled={busy} onClick={() => load(true)} className="nr-btn">Refresh</button>
                </>
              ) : (
                <>
                  <button disabled={busy} onClick={() => decide('edit')} className="nr-btn primary">Save and share</button>
                  <button disabled={busy} onClick={() => setEditing(false)} className="nr-btn">Cancel</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
