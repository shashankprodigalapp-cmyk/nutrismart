/**
 * SubscriptionModerator.tsx — Module 7: Subscription Validation Panel
 *
 * Lists payment_submissions, filterable by status.
 * Shows UTR + proof screenshot. Approve → approve_upi_payment RPC
 * (atomic: marks approved + grants Pro). Reject → reject_upi_payment with reason.
 * Realtime refresh when new submissions arrive.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth }  from '../../context/AuthContext';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface Submission {
  id:             string;
  user_id:        string;
  transaction_id: string;
  proof_url:      string | null;
  amount_inr:     number;
  status:         'pending' | 'approved' | 'rejected';
  reviewed_at:    string | null;
  reject_reason:  string | null;
  created_at:     string;
  submitter_email?: string;
}

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

function fmtIST(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

// ── SUBMISSION ROW ────────────────────────────────────────────────────────────

function SubmissionRow({
  sub, adminId, onRefresh,
}: { sub: Submission; adminId: string; onRefresh: () => void }) {
  const [expanded,     setExpanded]     = useState(sub.status === 'pending');
  const [rejectMode,   setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');

  const approve = async () => {
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc('approve_upi_payment', {
      p_calling_admin_id: adminId,
      p_submission_id:    sub.id,
      p_days:             31,
    });
    setBusy(false);
    if (err || !data?.success) { setError(err?.message ?? data?.error ?? 'Approval failed'); return; }
    onRefresh();
  };

  const reject = async () => {
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc('reject_upi_payment', {
      p_calling_admin_id: adminId,
      p_submission_id:    sub.id,
      p_reason:           rejectReason || null,
    });
    setBusy(false);
    if (err || !data?.success) { setError(err?.message ?? data?.error ?? 'Rejection failed'); return; }
    setRejectMode(false);
    onRefresh();
  };

  const badge = {
    pending:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    approved: 'bg-green-500/15 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  }[sub.status];

  return (
    <div className={`bg-[#1C1C1E] border rounded-2xl overflow-hidden mb-3 ${
      sub.status === 'pending' ? 'border-yellow-500/25' : 'border-white/[0.07]'}`}>

      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold font-mono text-[#F5F5F5]">{sub.transaction_id}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border capitalize ${badge}`}>{sub.status}</span>
          </div>
          <p className="text-[11px] text-[#636366] mt-0.5 truncate">
            {sub.submitter_email ?? sub.user_id} · ₹{sub.amount_inr} · {fmtIST(sub.created_at)}
          </p>
        </div>
        <span className={`text-[#636366] text-[18px] transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.07] pt-3">

          {/* Proof screenshot */}
          {sub.proof_url ? (
            <a href={sub.proof_url} target="_blank" rel="noopener noreferrer"
              className="block bg-[#242426] rounded-xl overflow-hidden mb-3">
              <img src={sub.proof_url} alt="Payment proof"
                className="w-full max-h-72 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <p className="text-[11px] text-[#C8F75E] text-center py-2 underline">Open proof in new tab ↗</p>
            </a>
          ) : (
            <div className="bg-[#242426] rounded-xl p-3 mb-3 text-center">
              <p className="text-[11px] text-[#636366]">No screenshot attached — verify UTR in your UPI app</p>
            </div>
          )}

          {/* Verification checklist */}
          <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3 mb-3">
            <p className="text-[11px] font-bold text-yellow-400 mb-1">Verify before approving:</p>
            <p className="text-[11px] text-[#A1A1A1]">
              ✓ UTR <strong className="font-mono text-[#F5F5F5]">{sub.transaction_id}</strong> appears in your UPI app
              <br />✓ Amount received is exactly <strong className="text-[#F5F5F5]">₹{sub.amount_inr}</strong>
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-3 text-[12px] text-red-400">{error}</div>
          )}

          {/* Actions */}
          {sub.status === 'pending' && !rejectMode && (
            <div className="flex gap-2">
              <button onClick={approve} disabled={busy}
                className="flex-1 bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl py-3 disabled:opacity-50">
                {busy ? '⟳ Approving…' : '✓ Approve & Grant Pro'}
              </button>
              <button onClick={() => setRejectMode(true)} disabled={busy}
                className="flex-1 bg-red-500/10 text-red-400 border border-red-500/25 font-semibold text-[13px] rounded-xl py-3">
                ✗ Reject
              </button>
            </div>
          )}

          {rejectMode && (
            <div>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason (e.g. UTR not found in payments, wrong amount)…" rows={2}
                className="w-full bg-[#242426] border border-red-500/25 rounded-xl px-3 py-2.5 text-[13px] text-[#F5F5F5] outline-none resize-none placeholder-[#636366] mb-3" />
              <div className="flex gap-2">
                <button onClick={reject} disabled={busy}
                  className="flex-1 bg-red-500/15 text-red-400 border border-red-500/25 font-bold text-[13px] rounded-xl py-3">
                  {busy ? '⟳…' : 'Confirm Rejection'}
                </button>
                <button onClick={() => setRejectMode(false)} className="flex-1 py-3 text-[13px] text-[#636366]">Cancel</button>
              </div>
            </div>
          )}

          {sub.status !== 'pending' && (
            <div className="bg-[#242426] rounded-xl px-3 py-2.5 text-[11px] text-[#636366]">
              Reviewed {fmtIST(sub.reviewed_at)}
              {sub.reject_reason && <p className="text-red-400 mt-1">Reason: {sub.reject_reason}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export function SubscriptionModerator() {
  const { user }              = useAuth();
  const [subs,     setSubs]    = useState<Submission[]>([]);
  const [filter,   setFilter]  = useState<Filter>('pending');
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState<string | null>(null);
  const [isAdmin,  setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from('admin_users').select('role').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  const fetchSubs = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError(null);
    let q = supabase
      .from('payment_submissions')
      .select('*, users:user_id(email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (filter !== 'all') q = q.eq('status', filter);

    const { data, error: err } = await q;
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSubs((data ?? []).map((r: any) => ({ ...r, submitter_email: r.users?.email })));
  }, [isAdmin, filter]);

  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  // Realtime — new submissions appear without refresh
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel('payment_submissions_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_submissions' },
        () => fetchSubs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, fetchSubs]);

  const counts = useMemo(() => ({
    pending:  subs.filter(s => s.status === 'pending').length,
    approved: subs.filter(s => s.status === 'approved').length,
    rejected: subs.filter(s => s.status === 'rejected').length,
  }), [subs]);

  if (!isAdmin) return (
    <div className="min-h-dvh bg-[#111113] flex items-center justify-center">
      <div className="text-center"><p className="text-3xl mb-3">🔒</p><p className="text-[14px] text-[#A1A1A1]">Admin access required</p></div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#111113] pb-10">
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5]">Subscription Validation</h1>
        <p className="text-[12px] text-[#636366] mt-1">Approve or reject manual UPI payment submissions</p>
      </div>

      {/* Stats */}
      <div className="px-4 grid grid-cols-3 gap-3 mb-4">
        {([['pending', counts.pending, '#FFD93D'], ['approved', counts.approved, '#6BCB77'], ['rejected', counts.rejected, '#FF6B6B']] as const).map(
          ([label, n, color]) => (
            <div key={label} className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-3 text-center">
              <div className="text-[22px] font-black" style={{ color }}>{n}</div>
              <div className="text-[9px] text-[#636366] uppercase tracking-[0.5px] mt-0.5 capitalize">{label}</div>
            </div>
          ))}
      </div>

      {/* Filter */}
      <div className="px-4 mb-4">
        <div className="flex bg-[#1C1C1E] rounded-xl p-1 gap-1">
          {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold capitalize ${
                filter === f ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366]'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-center">
            <p className="text-[13px] text-red-400">{error}</p>
            <button onClick={fetchSubs} className="mt-2 text-[12px] text-[#C8F75E]">Retry</button>
          </div>
        ) : subs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[32px] mb-2">📭</p>
            <p className="text-[13px] text-[#636366]">No {filter !== 'all' ? filter : ''} submissions</p>
          </div>
        ) : (
          subs.map(s => (
            <SubmissionRow key={s.id} sub={s} adminId={user!.id} onRefresh={fetchSubs} />
          ))
        )}
      </div>
    </div>
  );
}

export default SubscriptionModerator;
