/**
 * AdminSearchReview.tsx: words the AI said are not foods. Block the bad ones, dismiss the harmless ones.
 * Shows the typed words only, never who typed them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, Empty } from './adminUi';

interface Row { term: string; source: string; hits: number; status: string; last_seen: string }

async function call(init?: RequestInit) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch('/api/admin-search-review', {
    ...init,
    headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
  });
  const j = await res.json().catch(() => ({}));
  return { res, j };
}

export function AdminSearchReview() {
  const [pending, setPending] = useState<Row[]>([]);
  const [blocked, setBlocked] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { res, j } = await call();
      if (res.status === 403) setError('This account is not an admin.');
      else if (j?.error === 'review_unavailable') setError('The database part is not installed yet. Run migration 019 in Supabase, then refresh.');
      else if (!res.ok) setError('Could not load the list. Try again in a minute.');
      else { setPending(j.pending ?? []); setBlocked(j.blocked ?? []); }
    } catch { setError('Could not reach the server. Check your connection.'); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (term: string, action: 'block' | 'dismiss' | 'unblock') => {
    await call({ method: 'POST', body: JSON.stringify({ term, action }) });
    void load();
  };

  const btn = 'text-xs font-semibold px-3 py-1.5 rounded-lg';
  return (
    <div className="px-4 md:px-8 py-5 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Search review</h2>
          <p className="text-xs text-[#8E8E93]">Words the AI said are not foods. Block the bad ones so they never reach the AI again. Dismiss harmless ones.</p>
        </div>
        <button onClick={() => void load()} className={`${btn} bg-[#1C1C1E] text-white`}>Refresh</button>
      </div>
      {error && <p className="text-sm text-[#FF5D5D]">{error}</p>}
      {loading && !error && <Empty>Loading</Empty>}
      <Card title="To review" hint="Most searched first.">
        {pending.length === 0 ? <Empty>Nothing to review.</Empty> : pending.map(r => (
          <div key={r.term} className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.05] last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{r.term}</p>
              <p className="text-[11px] text-[#8E8E93]">{r.hits} {r.hits === 1 ? 'search' : 'searches'}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => void act(r.term, 'block')} className={`${btn} bg-[#FF5D5D] text-[#111113]`}>Block</button>
              <button onClick={() => void act(r.term, 'dismiss')} className={`${btn} bg-[#1C1C1E] text-[#8E8E93] border border-white/10`}>Dismiss</button>
            </div>
          </div>
        ))}
      </Card>
      <Card title="Blocked" hint="These are refused for free. No AI call, no search used.">
        {blocked.length === 0 ? <Empty>Nothing blocked yet.</Empty> : blocked.map(r => (
          <div key={r.term} className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.05] last:border-0">
            <p className="text-sm text-white truncate">{r.term} <span className="text-[11px] text-[#8E8E93]">· {r.hits}</span></p>
            <button onClick={() => void act(r.term, 'unblock')} className={`${btn} bg-[#1C1C1E] text-[#8E8E93] border border-white/10`}>Unblock</button>
          </div>
        ))}
      </Card>
    </div>
  );
}
