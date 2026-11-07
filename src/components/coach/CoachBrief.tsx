import { useEffect, useState } from 'react';
import { coachApi } from '../../lib/coachApi';

interface Outcome { at: string; label: string; status: string; text: string }
interface Brief { needsAttention: boolean; headline: string; reasons: string[]; whatChanged: string[]; evidence: string[]; questions: string[]; actions: string[]; draft: string | null; outcomes: Outcome[] }
const OUT: Record<string, string> = { too_early: 'Too early to tell', improved: 'Improved', no_change: 'No change', declined: 'Declined' };

/** Coach: who needs me, why, what changed, what to ask, what to do, and what happened after my last message. */
export function CoachBrief({ clientId }: { clientId: string }) {
  const [b, setB] = useState<Brief | null>(null);
  const [fc, setFc] = useState<Array<{ key: string; headline: string; evidence: string[]; confidence: string }>>([]);
  const [draft, setDraft] = useState<{ id: string; body: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { coachApi<{ brief: Brief; forecasts?: Array<{ key: string; headline: string; evidence: string[]; confidence: string }> }>('/api/coach-intel', { client_id: clientId }).then(r => { setB(r.ok ? r.data.brief : null); setFc(r.ok ? r.data.forecasts ?? [] : []); }); }, [clientId]);

  async function makeDraft() {
    setBusy(true); setMsg(null);
    const r = await coachApi<{ draft: { id: string; body: string } | null; message?: string }>('/api/messages', { action: 'draft', client_id: clientId });
    setBusy(false);
    if (r.ok && r.data.draft) setDraft(r.data.draft); else setMsg(r.data.message ?? (r.status === 403 ? 'Messages are not switched on yet.' : 'Could not make a draft.'));
  }
  async function review(decision: 'approve' | 'reject') {
    if (!draft) return;
    setBusy(true);
    const r = await coachApi<{ state?: string; message?: string }>('/api/messages', { action: 'review', message_id: draft.id, decision, text: draft.body });
    setBusy(false);
    if (r.ok) { setMsg(decision === 'reject' ? 'Draft discarded.' : r.data.state === 'sent' ? 'Sent.' : 'Saved. It will arrive when the client\'s notification settings allow.'); setDraft(null); }
    else setMsg(r.data.message ?? 'Could not send.');
  }
  if (!b) return null;
  const list = (title: string, xs: string[]) => xs.length > 0 && (
    <div><p className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{title}</p><ul className="mt-1 space-y-1">{xs.map((x, i) => <li key={i} className="text-sm text-[#EBEBF5]/90">{x}</li>)}</ul></div>
  );
  return (
    <section aria-label="Coach brief" className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
      <div><p className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Who needs me today</p><p className="text-sm font-semibold mt-1">{b.headline}</p></div>
      {list('What changed', b.whatChanged)}{list('Evidence', b.evidence)}{list('What to ask', b.questions)}{list('What you could do', b.actions)}
      {fc.length > 0 && (
        <div data-testid="coach-forecasts"><p className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Looking ahead (patterns so far, not predictions)</p>
          <ul className="mt-1 space-y-1">{fc.map(f => <li key={f.key} className="text-sm text-[#EBEBF5]/90">{f.headline} <span className="text-[#8E8E93] text-xs uppercase">· {f.confidence} confidence</span><span className="block text-xs text-[#8E8E93]">{f.evidence[0]}</span></li>)}</ul></div>
      )}
      {b.outcomes.length > 0 && (
        <div><p className="text-[11px] uppercase tracking-wide text-[#8E8E93]">After your earlier messages</p>
          <ul className="mt-1 space-y-1">{b.outcomes.slice(0, 3).map((o, i) => <li key={i} className="text-sm"><span className="font-semibold">{OUT[o.status] ?? o.status}</span> · {o.label} on {o.at}. <span className="text-[#8E8E93]">{o.text}</span></li>)}</ul></div>
      )}
      {b.draft && !draft && <button disabled={busy} onClick={makeDraft} className="px-4 min-h-[44px] rounded-full bg-[#242426] text-sm">Draft a message for review</button>}
      {draft && (
        <div className="space-y-2">
          <label className="text-xs text-[#8E8E93]" htmlFor="draft-text">Draft (edit before sending, nothing is sent until you approve)</label>
          <textarea id="draft-text" value={draft.body} maxLength={140} onChange={e => setDraft({ ...draft, body: e.target.value })} className="w-full bg-[#242426] rounded-xl p-3 text-sm min-h-[88px]" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => review('approve')} className="px-4 min-h-[44px] rounded-full bg-[#C8F75E] text-[#111113] text-sm font-semibold">Approve and send</button>
            <button disabled={busy} onClick={() => review('reject')} className="px-4 min-h-[44px] rounded-full bg-[#242426] text-sm">Discard</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="text-xs text-[#8E8E93]">{msg}</p>}
    </section>
  );
}
