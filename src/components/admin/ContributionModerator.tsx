/**
 * ContributionModerator.tsx — NutriSmart Admin Food Contribution Review
 * Module 7, Step 7.2
 *
 * FEATURES:
 *   - Fetches pending food_contributions via Supabase (admin read via service role)
 *   - Diff viewer: user-submitted macros vs system validation rules
 *   - Macro sanity check: protein*4 + carbs*4 + fat*9 ≤ calories (±10% tolerance)
 *   - 1-tap approve: calls approve_food_contribution RPC
 *   - Reject with custom text input: calls reject_food_contribution RPC
 *   - Search & filter by status
 *   - Real-time updates via Supabase channel
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth }  from '../../context/AuthContext';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface FoodPayload {
  name:       string;
  portion?:   string;
  calories:   number;
  protein:    number;
  carbs:      number;
  fat:        number;
  gl?:        number;
  gi?:        number;
  source?:    string;
  notes?:     string;
  [key: string]: unknown;
}

interface Contribution {
  id:               string;
  user_id:          string;
  payload:          FoodPayload;
  status:           'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  reviewed_by:      string | null;
  reviewed_at:      string | null;
  created_at:       string;
  // Joined
  submitter_email?: string;
}

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

// ── MACRO SANITY CHECK ────────────────────────────────────────────────────────

interface ValidationIssue {
  field:    string;
  severity: 'error' | 'warning' | 'ok';
  message:  string;
}

function validatePayload(p: FoodPayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Calorie range
  if (p.calories <= 0 || p.calories > 2500) {
    issues.push({ field: 'calories', severity: 'error', message: `Calories (${p.calories}) out of range 1–2500` });
  } else {
    issues.push({ field: 'calories', severity: 'ok', message: `${p.calories} kcal ✓` });
  }

  // Macro energy balance: protein*4 + carbs*4 + fat*9 ≈ calories (±15%)
  const macroCalc  = (p.protein * 4) + (p.carbs * 4) + (p.fat * 9);
  const delta      = Math.abs(macroCalc - p.calories);
  const tolerance  = p.calories * 0.15;
  if (delta > tolerance) {
    issues.push({
      field:    'macro_balance',
      severity: 'warning',
      message:  `Macro sum (${Math.round(macroCalc)} kcal) differs from declared calories by ${Math.round(delta)} kcal. Possible data error.`,
    });
  } else {
    issues.push({ field: 'macro_balance', severity: 'ok', message: `Macro balance within ±15% tolerance ✓` });
  }

  // Protein vs calories (biological ceiling)
  if (p.protein * 4 > p.calories) {
    issues.push({ field: 'protein', severity: 'error', message: `Protein energy (${p.protein * 4} kcal) exceeds total calories — impossible` });
  } else {
    issues.push({ field: 'protein', severity: 'ok', message: `${p.protein}g protein ✓` });
  }

  // GL present?
  if (!p.gl && p.gl !== 0) {
    issues.push({ field: 'gl', severity: 'warning', message: 'Glycemic Load missing — will be estimated from GI×carbs' });
  } else {
    issues.push({ field: 'gl', severity: 'ok', message: `GL ${p.gl} ✓` });
  }

  // Name
  if (!p.name?.trim()) {
    issues.push({ field: 'name', severity: 'error', message: 'Food name is required' });
  } else if (p.name.length > 200) {
    issues.push({ field: 'name', severity: 'error', message: 'Name too long (>200 chars)' });
  } else {
    issues.push({ field: 'name', severity: 'ok', message: `"${p.name}" ✓` });
  }

  return issues;
}

function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some(i => i.severity === 'error');
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Contribution['status'] }) {
  const cfg = {
    pending:  { bg: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', label: 'Pending' },
    approved: { bg: 'bg-green-500/15 text-green-400 border-green-500/30',   label: 'Approved' },
    rejected: { bg: 'bg-red-500/15 text-red-400 border-red-500/30',         label: 'Rejected' },
  }[status];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

// ── CONTRIBUTION ROW ──────────────────────────────────────────────────────────

interface SimilarFood {
  food_id:    string;
  food_name:  string;
  similarity: number;
  calories:   number;
  portion:    string;
}

function ContributionRow({
  item, adminId, onApprove, onReject, onMerged,
}: {
  item:      Contribution;
  adminId:   string;
  onApprove: (id: string) => Promise<void>;
  onReject:  (id: string, reason: string) => Promise<void>;
  onMerged:  () => void;
}) {
  const [expanded,       setExpanded]       = useState(false);
  const [rejectMode,     setRejectMode]     = useState(false);
  const [rejectReason,   setRejectReason]   = useState('');
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectLoading,  setRejectLoading]  = useState(false);
  const [similar,        setSimilar]        = useState<SimilarFood[]>([]);
  const [mergeLoading,   setMergeLoading]   = useState<string | null>(null);
  const [mergeError,     setMergeError]     = useState('');

  // SIMILARITY MERGE (admin efficiency): auto-check on expand of a pending
  // contribution. pg_trgm name similarity against master_foods — duplicates
  // are a lexical problem ("Dal Tadka" vs "dal tadka homemade"); catching
  // them BEFORE the row exists is the cheapest moment to prevent DB
  // fragmentation. Non-blocking: the panel renders while this resolves.
  useEffect(() => {
    if (!expanded || item.status !== 'pending' || similar.length) return;
    supabase.rpc('find_similar_master_foods', {
      p_calling_admin_id: adminId,
      p_name:             item.payload.name,
      p_threshold:        0.5,
      p_limit:            3,
    }).then(({ data }) => {
      if (Array.isArray(data) && data.length) setSimilar(data as SimilarFood[]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleMerge = async (target: SimilarFood) => {
    setMergeLoading(target.food_id);
    setMergeError('');
    const { data, error: err } = await supabase.rpc('merge_contribution_into_food', {
      p_calling_admin_id: adminId,
      p_contribution_id:  item.id,
      p_target_food_id:   target.food_id,
    });
    setMergeLoading(null);
    if (err || !data?.success) {
      setMergeError(err?.message ?? data?.error ?? 'Merge failed');
      return;
    }
    onMerged();
  };

  const issues  = useMemo(() => validatePayload(item.payload), [item.payload]);
  const hasErr  = hasErrors(issues);
  const p       = item.payload;

  const handleApprove = async () => {
    setApproveLoading(true);
    await onApprove(item.id);
    setApproveLoading(false);
  };

  const handleReject = async () => {
    setRejectLoading(true);
    await onReject(item.id, rejectReason);
    setRejectLoading(false);
    setRejectMode(false);
  };

  return (
    <div className={`bg-[#1C1C1E] border rounded-2xl overflow-hidden mb-3 ${
      hasErr ? 'border-red-500/30' : 'border-white/[0.07]'
    }`}>
      {/* Summary row */}
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[#F5F5F5] truncate">{p.name}</span>
            <StatusBadge status={item.status} />
            {hasErr && <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-md">⚠ Errors</span>}
          </div>
          <div className="flex gap-3 mt-1 flex-wrap">
            <span className="text-[11px] text-[#E8D5B0]">{p.calories} kcal</span>
            <span className="text-[11px] text-[#8DB4FF]">P {p.protein}g</span>
            <span className="text-[11px] text-[#FFB347]">F {p.fat}g</span>
            <span className="text-[11px] text-[#FF8FAB]">C {p.carbs}g</span>
            {p.gl !== undefined && <span className="text-[11px] text-[#C4A8FF]">GL {p.gl}</span>}
          </div>
          <p className="text-[10px] text-[#636366] mt-1">
            {new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {item.submitter_email && ` · ${item.submitter_email}`}
          </p>
        </div>
        <span className={`text-[#636366] text-[18px] transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.07]">

          {/* SIMILARITY MERGE suggestions — shown before validation because a
              duplicate should be merged, not validated */}
          {item.status === 'pending' && similar.length > 0 && (
            <div className="mt-3 mb-3 bg-[#C4A8FF]/8 border border-[#C4A8FF]/25 rounded-xl p-3">
              <p className="text-[10px] font-bold text-[#C4A8FF] uppercase tracking-[1px] mb-2">
                ⚠ Possible duplicate{similar.length > 1 ? 's' : ''} in master foods
              </p>
              {similar.map(s => (
                <div key={s.food_id}
                  className="flex items-center justify-between gap-2 py-2 border-b border-white/[0.05] last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#F5F5F5] truncate">{s.food_name}</p>
                    <p className="text-[10px] text-[#636366]">
                      {s.calories} kcal · {s.portion} · {Math.round(s.similarity * 100)}% name match
                    </p>
                  </div>
                  <button
                    onClick={() => handleMerge(s)}
                    disabled={mergeLoading !== null}
                    className="flex-shrink-0 bg-[#C4A8FF]/15 text-[#C4A8FF] border border-[#C4A8FF]/30 text-[11px] font-bold rounded-lg px-3 py-1.5 disabled:opacity-50"
                  >
                    {mergeLoading === s.food_id ? '⟳' : `Merge into this →`}
                  </button>
                </div>
              ))}
              {mergeError && (
                <p className="text-[11px] text-red-400 mt-2">{mergeError}</p>
              )}
              <p className="text-[9px] text-[#636366] mt-2">
                Merging rejects this contribution with a note pointing at the existing entry — master foods stay unfragmented.
              </p>
            </div>
          )}

          {/* Validation issues */}
          <div className="mt-3 mb-3">
            <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">Validation</p>
            <div className="flex flex-col gap-1.5">
              {issues.map((issue) => (
                <div key={issue.field}
                  className={`flex items-start gap-2 text-[11px] px-3 py-2 rounded-lg ${
                    issue.severity === 'error'   ? 'bg-red-500/10 text-red-400' :
                    issue.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-400' :
                                                    'bg-green-500/8 text-green-400'
                  }`}
                >
                  <span className="flex-shrink-0">
                    {issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : '✓'}
                  </span>
                  <span><strong className="capitalize">{issue.field.replace('_', ' ')}:</strong> {issue.message}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Macro diff table */}
          <div className="bg-[#242426] rounded-xl p-3 mb-3">
            <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">Macro breakdown</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {[
                { label: 'Calories',  value: p.calories,       unit: 'kcal',  macro_kcal: null },
                { label: 'Protein',   value: p.protein,        unit: 'g',     macro_kcal: p.protein * 4 },
                { label: 'Carbs',     value: p.carbs,          unit: 'g',     macro_kcal: p.carbs * 4 },
                { label: 'Fat',       value: p.fat,            unit: 'g',     macro_kcal: p.fat * 9 },
                { label: 'GL',        value: p.gl ?? '—',      unit: '',      macro_kcal: null },
                { label: 'Portion',   value: p.portion ?? '—', unit: '',      macro_kcal: null },
              ].map(({ label, value, unit, macro_kcal }) => (
                <div key={label} className="flex justify-between border-b border-white/[0.04] py-1">
                  <span className="text-[#636366]">{label}</span>
                  <span className="text-[#F5F5F5] font-semibold">
                    {value}{unit && ` ${unit}`}
                    {macro_kcal !== null && (
                      <span className="text-[#636366] ml-1">({Math.round(macro_kcal)} kcal)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2 text-[11px]">
              <span className="text-[#636366]">Macro sum</span>
              <span className={`font-bold ${
                Math.abs((p.protein*4)+(p.carbs*4)+(p.fat*9) - p.calories) > p.calories*0.15
                  ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {Math.round((p.protein*4)+(p.carbs*4)+(p.fat*9))} kcal
              </span>
            </div>
          </div>

          {/* Raw payload (collapsible) */}
          {p.notes && (
            <div className="bg-[#242426] rounded-xl p-3 mb-3">
              <p className="text-[10px] font-bold text-[#636366] mb-1">Submitter notes</p>
              <p className="text-[11px] text-[#A1A1A1]">{p.notes}</p>
            </div>
          )}

          {/* Action buttons */}
          {item.status === 'pending' && !rejectMode && (
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={approveLoading || hasErr}
                className={`flex-1 py-3 rounded-xl text-[13px] font-bold transition-all ${
                  hasErr
                    ? 'bg-[#2C2C2E] text-[#636366] cursor-not-allowed'
                    : 'bg-[#C8F75E] text-[#111113] active:scale-[0.98]'
                }`}
                title={hasErr ? 'Fix validation errors before approving' : 'Approve this food'}
              >
                {approveLoading ? '⟳ Approving…' : '✓ Approve'}
              </button>
              <button
                onClick={() => setRejectMode(true)}
                disabled={rejectLoading}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold bg-red-500/10 text-red-400 border border-red-500/25 active:scale-[0.98]"
              >
                ✗ Reject
              </button>
            </div>
          )}

          {/* Reject form */}
          {rejectMode && (
            <div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (shown to submitter)…"
                rows={3}
                className="w-full bg-[#242426] border border-red-500/25 rounded-xl px-3 py-2.5 text-[13px] text-[#F5F5F5] outline-none resize-none placeholder-[#636366] mb-3"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={rejectLoading}
                  className="flex-1 py-3 rounded-xl text-[13px] font-bold bg-red-500/15 text-red-400 border border-red-500/25"
                >
                  {rejectLoading ? '⟳ Rejecting…' : 'Confirm Rejection'}
                </button>
                <button
                  onClick={() => { setRejectMode(false); setRejectReason(''); }}
                  className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-[#636366]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Post-review info */}
          {item.status !== 'pending' && (
            <div className="bg-[#242426] rounded-xl px-3 py-2.5 text-[11px] text-[#636366]">
              Reviewed: {item.reviewed_at
                ? new Date(item.reviewed_at).toLocaleDateString('en-IN')
                : 'N/A'}
              {item.rejection_reason && (
                <p className="text-red-400 mt-1">Reason: {item.rejection_reason}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export function ContributionModerator() {
  const { user }                = useAuth();
  const [contributions,  setContributions]  = useState<Contribution[]>([]);
  const [filter,         setFilter]         = useState<Filter>('pending');
  const [searchQuery,    setSearchQuery]    = useState('');
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [isAdmin,        setIsAdmin]        = useState(false);

  // ── Admin check ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  // ── Fetch contributions ───────────────────────────────────────────────────
  const fetchContributions = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('food_contributions')
        .select('*, users:user_id(email)')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error: err } = await query;
      if (err) throw err;

      const mapped = (data ?? []).map((row: any) => ({
        ...row,
        submitter_email: row.users?.email,
      }));
      setContributions(mapped);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load contributions');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filter]);

  useEffect(() => {
    fetchContributions();
  }, [fetchContributions]);

  // ── Realtime updates ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel('food_contributions_admin')
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'food_contributions',
      }, () => { fetchContributions(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin, fetchContributions]);

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = useCallback(async (id: string) => {
    if (!user) return;
    const { error: err } = await supabase.rpc('approve_food_contribution', {
      p_calling_user_id: user.id,
      p_contribution_id: id,
    });
    if (err) {
      alert(`Approval failed: ${err.message}`);
    } else {
      setContributions(prev =>
        prev.map(c => c.id === id ? { ...c, status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() } : c)
      );
    }
  }, [user]);

  // ── Reject ────────────────────────────────────────────────────────────────
  const handleReject = useCallback(async (id: string, reason: string) => {
    if (!user) return;
    const { error: err } = await supabase.rpc('reject_food_contribution', {
      p_calling_user_id: user.id,
      p_contribution_id: id,
      p_reason:          reason || null,
    });
    if (err) {
      alert(`Rejection failed: ${err.message}`);
    } else {
      setContributions(prev =>
        prev.map(c => c.id === id
          ? { ...c, status: 'rejected', rejection_reason: reason, reviewed_by: user.id, reviewed_at: new Date().toISOString() }
          : c)
      );
    }
  }, [user]);

  // ── Filter & search ───────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let items = contributions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(c =>
        c.payload.name?.toLowerCase().includes(q) ||
        c.submitter_email?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [contributions, searchQuery]);

  const counts = useMemo(() => ({
    pending:  contributions.filter(c => c.status === 'pending').length,
    approved: contributions.filter(c => c.status === 'approved').length,
    rejected: contributions.filter(c => c.status === 'rejected').length,
  }), [contributions]);

  if (!isAdmin) {
    return (
      <div className="min-h-dvh bg-[#111113] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[32px] mb-3">🔒</p>
          <p className="text-[14px] text-[#A1A1A1]">Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#111113] pb-10">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5]">
          Food Contributions
        </h1>
        <p className="text-[12px] text-[#636366] mt-1">Review and moderate community food submissions</p>
      </div>

      {/* Stats */}
      <div className="px-4 grid grid-cols-3 gap-3 mb-4">
        {([['pending', counts.pending, '#FFD93D'], ['approved', counts.approved, '#6BCB77'], ['rejected', counts.rejected, '#FF6B6B']] as const).map(
          ([status, count, color]) => (
            <div key={status} className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-3 text-center">
              <div className="text-[22px] font-black" style={{ color: String(color) }}>{count}</div>
              <div className="text-[9px] text-[#636366] uppercase tracking-[0.5px] mt-0.5 capitalize">{status}</div>
            </div>
          )
        )}
      </div>

      {/* Filter tabs */}
      <div className="px-4 mb-4">
        <div className="flex bg-[#1C1C1E] rounded-xl p-1 gap-1">
          {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold capitalize transition-all ${
                filter === f ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-4">
        <div className="flex items-center gap-2 bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-4 py-2.5">
          <span className="text-[#636366]">🔍</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by food name or submitter…"
            className="flex-1 bg-transparent text-[#F5F5F5] text-[13px] outline-none placeholder-[#636366]"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-center">
            <p className="text-[13px] text-red-400">{error}</p>
            <button onClick={fetchContributions} className="mt-2 text-[12px] text-[#C8F75E]">Retry</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[32px] mb-2">📭</p>
            <p className="text-[13px] text-[#636366]">No {filter !== 'all' ? filter : ''} contributions</p>
          </div>
        ) : (
          visible.map((item) => (
            <ContributionRow
              key={item.id}
              item={item}
              adminId={user!.id}
              onApprove={handleApprove}
              onReject={handleReject}
              onMerged={fetchContributions}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default ContributionModerator;
