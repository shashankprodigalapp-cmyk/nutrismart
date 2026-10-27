import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { coachApi } from '../../lib/coachApi';
import { track } from '../../lib/analytics';
import { NudgeBox } from '../nudge/NudgeBox';
import { buildAttention, type AttentionAction, type ScoredClient } from '../../lib/attention';

export function AttentionPanel({ clients, onChanged }: { clients: ScoredClient[]; onChanged?: () => void }) {
  const [actions, setActions] = useState<AttentionAction[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadActions = useCallback(async () => {
    const { data, error } = await supabase.from('attention_actions').select('client_id, signal, action, severity, until_at');
    if (error) { setErr('Could not load your snoozed items.'); setActions([]); return; }
    setActions((data ?? []) as AttentionAction[]);
  }, []);
  useEffect(() => { void loadActions(); }, [loadActions]);

  const items = useMemo(() => buildAttention(clients, actions ?? []), [clients, actions]);
  const hiddenCount = useMemo(() => (actions ?? []).filter(a => a.action === 'dismissed' || (a.until_at && new Date(a.until_at) > new Date())).length, [actions]);

  async function act(client_id: string, signal: string, severity: string, action: 'snooze' | 'dismiss', days?: number) {
    const key = client_id + signal; setBusy(key); setErr(null);
    const r = await coachApi('/api/attention-action', { client_id, signal, severity, action, days });
    setBusy(null);
    if (!r.ok) { setErr(r.data.message ?? 'Could not save that. Try again.'); return; }
    track('attention_' + action, { signal });
    await loadActions(); onChanged?.();
  }

  if (actions === null) return null;
  return (
    <section aria-label="Needs attention" className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Needs your attention {items.length > 0 && <span className="text-[#FF6B6B]">({items.length})</span>}</h2>
        {hiddenCount > 0 && <span className="text-[11px] text-[#8E8E93]">{hiddenCount} snoozed or dismissed</span>}
      </div>
      {err && <p role="alert" className="text-xs text-[#FF6B6B]">{err}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-[#8E8E93]">Nobody needs attention right now.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(it => (
            <li key={it.client_id} className="bg-[#242426] rounded-xl p-3">
              <Link to={`/coach/client/${it.client_id}`} className="font-medium text-sm underline decoration-white/20">{it.client_name}</Link>
              <ul className="mt-2 space-y-2">
                {it.reasons.map(r => (
                  <li key={r.signal} className="text-xs">
                    <p className={r.severity === 'attention' ? 'text-[#FF6B6B]' : 'text-[#FFB347]'}>{r.text}</p>
                    <div className="flex gap-2 mt-1">
                      <button disabled={busy === it.client_id + r.signal} onClick={() => act(it.client_id, r.signal, r.severity, 'snooze', 3)} className="px-3 min-h-[36px] rounded-full bg-[#1C1C1E] text-[#C7C7CC]">Snooze 3 days</button>
                      <button disabled={busy === it.client_id + r.signal} onClick={() => act(it.client_id, r.signal, r.severity, 'dismiss')} className="px-3 min-h-[36px] rounded-full bg-[#1C1C1E] text-[#C7C7CC]">Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2"><NudgeBox clientId={it.client_id} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
