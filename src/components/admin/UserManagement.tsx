/**
 * UserManagement.tsx — Admin User Management Panel
 *
 * Features:
 *   - Search users by email or name
 *   - Filter by plan (free / pro)
 *   - See today's AI search count per user
 *   - Gift Pro for any number of days (with a note/reason)
 *   - Revoke Pro back to free
 *   - See how each user got Pro (paid UPI, gifted, Razorpay)
 *   - Real-time updates via Supabase Realtime
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

interface AdminUser {
  id:                string;
  email:             string;
  name:              string | null;
  plan:              'free' | 'pro';
  created_at:        string;
  sub_status:        string | null;
  valid_until:       string | null;
  payment_source:    string | null;
  gifted_by:         string | null;
  admin_note:        string | null;
  ai_searches_today: number;
  upi_transaction_id?: string | null;  // UTR submitted, pending verification
}

type PlanFilter = 'all' | 'free' | 'pro';

// ── HELPERS ───────────────────────────────────────────────────────────────────

function planBadge(user: AdminUser) {
  if (user.plan === 'pro') {
    const src = user.payment_source;
    const label = src === 'gifted'    ? '⭐ Pro (gifted)'
                : src === 'upi_auto'  ? '💳 Pro (UPI)'
                : src === 'razorpay'  ? '💳 Pro (Razorpay)'
                : '⭐ Pro';
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#C8F75E]/15 text-[#C8F75E] border border-[#C8F75E]/30">{label}</span>;
  }
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#2C2C2E] text-[#636366] border border-white/[0.07]">Free</span>;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

const FREE_AI_LIMIT = 5;

// ── GIFT PRO MODAL ────────────────────────────────────────────────────────────

interface GiftModalProps {
  user:       AdminUser;
  adminId:    string;
  onSuccess:  () => void;
  onClose:    () => void;
}

function GiftProModal({ user, adminId, onSuccess, onClose }: GiftModalProps) {
  const [days,    setDays]    = useState(30);
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleGrant = async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('grant_free_pro', {
      p_calling_admin_id: adminId,
      p_target_user_id:   user.id,
      p_days:             days,
      p_note:             note || null,
    });
    setLoading(false);

    if (err || !data?.success) {
      setError(err?.message ?? data?.error ?? 'Failed to grant Pro');
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#1C1C1E] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-['Playfair_Display'] text-lg font-black text-[#F5F5F5] mb-1">
          Gift Pro Access
        </h3>
        <p className="text-[12px] text-[#636366] mb-4">{user.email}</p>

        {/* Duration selector */}
        <p className="text-[11px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">Duration</p>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[7, 30, 90, 365].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`py-2 rounded-xl text-[12px] font-bold transition-all ${
                days === d
                  ? 'bg-[#C8F75E] text-[#111113]'
                  : 'bg-[#242426] text-[#636366] border border-white/[0.07]'
              }`}
            >
              {d < 30 ? `${d}d` : d < 365 ? `${d/30}mo` : '1yr'}
            </button>
          ))}
        </div>

        {/* Custom days */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[12px] text-[#636366]">Custom days:</span>
          <input
            type="number"
            value={days}
            onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 bg-[#242426] border border-white/[0.07] rounded-xl px-3 py-2 text-[14px] font-bold text-[#F5F5F5] outline-none text-right"
            min={1} max={3650}
          />
        </div>

        {/* Reason note */}
        <p className="text-[11px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">
          Reason (optional)
        </p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Beta tester, referral reward, support issue…"
          rows={2}
          className="w-full bg-[#242426] border border-white/[0.07] rounded-xl px-3 py-2.5 text-[13px] text-[#F5F5F5] outline-none resize-none placeholder-[#636366] mb-4"
        />

        {/* Preview */}
        <div className="bg-[#C8F75E]/8 border border-[#C8F75E]/20 rounded-xl p-3 mb-4 text-[12px]">
          <span className="text-[#C8F75E]">✓ </span>
          <span className="text-[#A1A1A1]">Pro for <strong className="text-[#F5F5F5]">{days} days</strong> · expires{' '}
            <strong className="text-[#F5F5F5]">
              {new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </strong>
          </span>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-3 text-[12px] text-red-400">{error}</div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleGrant}
            disabled={loading}
            className="flex-1 bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl py-3 disabled:opacity-50"
          >
            {loading ? '⟳ Granting…' : '⭐ Grant Pro'}
          </button>
          <button onClick={onClose} className="flex-1 py-3 text-[13px] text-[#636366]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── REVOKE MODAL ──────────────────────────────────────────────────────────────

interface RevokeModalProps {
  user:      AdminUser;
  adminId:   string;
  onSuccess: () => void;
  onClose:   () => void;
}

function RevokeProModal({ user, adminId, onSuccess, onClose }: RevokeModalProps) {
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleRevoke = async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc('revoke_free_pro', {
      p_calling_admin_id: adminId,
      p_target_user_id:   user.id,
      p_note:             note || null,
    });
    setLoading(false);
    if (err || !data?.success) {
      setError(err?.message ?? data?.error ?? 'Failed to revoke Pro');
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#1C1C1E] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-['Playfair_Display'] text-lg font-black text-[#F5F5F5] mb-1">Revoke Pro</h3>
        <p className="text-[12px] text-[#636366] mb-4">{user.email}</p>
        <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-4">
          <p className="text-[12px] text-yellow-400">
            This will immediately downgrade <strong>{user.email}</strong> to Free.
            Their logs and data are preserved.
          </p>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for revoking (optional)"
          rows={2}
          className="w-full bg-[#242426] border border-white/[0.07] rounded-xl px-3 py-2.5 text-[13px] text-[#F5F5F5] outline-none resize-none placeholder-[#636366] mb-4"
        />
        {error && <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-3 text-[12px] text-red-400">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleRevoke}
            disabled={loading}
            className="flex-1 bg-red-500/15 text-red-400 border border-red-500/25 font-bold text-[13px] rounded-xl py-3"
          >
            {loading ? '⟳ Revoking…' : '✗ Revoke Pro'}
          </button>
          <button onClick={onClose} className="flex-1 py-3 text-[13px] text-[#636366]">Cancel</button>
        </div>
      </div>
    </div>
  );
}


// ── ACTIVATE UPI MODAL ────────────────────────────────────────────────────────

interface ActivateUPIModalProps {
  user:      AdminUser;
  adminId:   string;
  onSuccess: () => void;
  onClose:   () => void;
}

function ActivateUPIModal({ user, adminId, onSuccess, onClose }: ActivateUPIModalProps) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleActivate = async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc('activate_upi_payment', {
      p_calling_admin_id: adminId,
      p_target_user_id:   user.id,
      p_days:             31,
    });
    setLoading(false);
    if (err || !data?.success) {
      setError(err?.message ?? data?.error ?? 'Activation failed');
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#1C1C1E] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-['Playfair_Display'] text-lg font-black text-[#F5F5F5] mb-1">
          Verify & Activate UPI
        </h3>
        <p className="text-[12px] text-[#636366] mb-4">{user.email}</p>

        <div className="bg-[#242426] rounded-xl p-4 mb-4">
          <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">
            Transaction to verify
          </p>
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-[#A1A1A1]">UTR / Transaction ID</span>
            <span className="text-[13px] font-bold font-mono text-[#F5F5F5]">
              {user.upi_transaction_id}
            </span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-[12px] text-[#A1A1A1]">Expected amount</span>
            <span className="text-[13px] font-bold text-[#C8F75E]">₹99</span>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-4">
          <p className="text-[12px] text-yellow-400 font-semibold mb-1">Before clicking Activate:</p>
          <p className="text-[11px] text-[#A1A1A1]">
            Open your GPay / PhonePe app → check payment history → confirm UTR{' '}
            <strong className="text-[#F5F5F5] font-mono">{user.upi_transaction_id}</strong>{' '}
            shows ₹99 received.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-3 text-[12px] text-red-400">{error}</div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleActivate}
            disabled={loading}
            className="flex-1 bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl py-3 disabled:opacity-50"
          >
            {loading ? "⟳ Activating…" : "✓ Verified — Activate Pro"}
          </button>
          <button onClick={onClose} className="px-4 py-3 text-[13px] text-[#636366]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── USER ROW ──────────────────────────────────────────────────────────────────

interface UserRowProps {
  user:      AdminUser;
  adminId:   string;
  onRefresh: () => void;
}

function UserRow({ user, adminId, onRefresh }: UserRowProps) {
  const [showGift,        setShowGift]        = useState(false);
  const [showRevoke,      setShowRevoke]      = useState(false);
  const [showActivateUPI, setShowActivateUPI] = useState(false);

  const aiPct      = Math.min((user.ai_searches_today / FREE_AI_LIMIT) * 100, 100);
  const aiOverLimit = user.ai_searches_today >= FREE_AI_LIMIT;
  const isExpiringSoon = user.valid_until
    ? new Date(user.valid_until).getTime() - Date.now() < 5 * 86_400_000
    : false;

  return (
    <>
      <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-2xl p-4 mb-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-[#F5F5F5] truncate">
                {user.name || '—'}
              </span>
              {planBadge(user)}
            </div>
            <p className="text-[11px] text-[#636366] mt-0.5 truncate">{user.email}</p>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          <span className="text-[10px] text-[#636366]">
            Joined {formatDate(user.created_at)}
          </span>
          {user.plan === 'pro' && user.valid_until && (
            <span className={`text-[10px] font-semibold ${isExpiringSoon ? 'text-yellow-400' : 'text-[#636366]'}`}>
              {isExpiringSoon ? '⚠ ' : ''}Expires {formatDate(user.valid_until)}
            </span>
          )}
          {user.admin_note && (
            <span className="text-[10px] text-[#C4A8FF] italic">"{user.admin_note}"</span>
          )}
        </div>

        {/* AI searches today */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-[#636366]">AI searches today</span>
            <span className={`text-[10px] font-bold ${aiOverLimit && user.plan === 'free' ? 'text-red-400' : 'text-[#636366]'}`}>
              {user.ai_searches_today} / {user.plan === 'pro' ? '200' : FREE_AI_LIMIT}
            </span>
          </div>
          <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${user.plan === 'pro' ? Math.min(user.ai_searches_today / 200 * 100, 100) : aiPct}%`,
                background: aiOverLimit && user.plan === 'free' ? '#FF6B6B' : '#C8F75E',
              }}
            />
          </div>
        </div>

        {/* Pending UPI verification banner */}
        {user.sub_status === 'pending_verification' && user.upi_transaction_id && (
          <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold text-yellow-400">⏳ UPI Payment Pending Verification</p>
                <p className="text-[10px] text-[#636366] mt-0.5 font-mono">UTR: {user.upi_transaction_id}</p>
                <p className="text-[10px] text-[#636366] mt-0.5">
                  Check your UPI app for this UTR, then click Activate if it matches ₹99.
                </p>
              </div>
              <button
                onClick={() => setShowActivateUPI(true)}
                className="flex-shrink-0 bg-[#C8F75E] text-[#111113] font-bold text-[11px] rounded-xl px-3 py-2"
              >
                ✓ Activate
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {user.plan === 'free' ? (
            <button
              onClick={() => setShowGift(true)}
              className="flex-1 bg-[#C8F75E]/12 text-[#C8F75E] border border-[#C8F75E]/30 font-semibold text-[12px] rounded-xl py-2.5"
            >
              ⭐ Gift Pro
            </button>
          ) : (
            <>
              <button
                onClick={() => setShowGift(true)}
                className="flex-1 bg-[#C8F75E]/12 text-[#C8F75E] border border-[#C8F75E]/30 font-semibold text-[12px] rounded-xl py-2.5"
              >
                ⭐ Extend
              </button>
              <button
                onClick={() => setShowRevoke(true)}
                className="flex-1 bg-red-500/10 text-red-400 border border-red-500/25 font-semibold text-[12px] rounded-xl py-2.5"
              >
                ✗ Revoke
              </button>
            </>
          )}
        </div>
      </div>

      {showGift && (
        <GiftProModal
          user={user}
          adminId={adminId}
          onSuccess={() => { setShowGift(false); onRefresh(); }}
          onClose={() => setShowGift(false)}
        />
      )}
      {showRevoke && (
        <RevokeProModal
          user={user}
          adminId={adminId}
          onSuccess={() => { setShowRevoke(false); onRefresh(); }}
          onClose={() => setShowRevoke(false)}
        />
      )}

      {/* Activate pending UPI payment */}
      {showActivateUPI && (
        <ActivateUPIModal
          user={user}
          adminId={adminId}
          onSuccess={() => { setShowActivateUPI(false); onRefresh(); }}
          onClose={() => setShowActivateUPI(false)}
        />
      )}
    </>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export function UserManagement() {
  const { user: adminUser } = useAuth();
  const [users,        setUsers]       = useState<AdminUser[]>([]);
  const [search,       setSearch]      = useState('');
  const [planFilter,   setPlanFilter]  = useState<PlanFilter>('all');
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState<string | null>(null);
  const [isAdmin,      setIsAdmin]     = useState(false);

  // Admin guard
  useEffect(() => {
    if (!adminUser) return;
    supabase.from('admin_users').select('role').eq('user_id', adminUser.id).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [adminUser]);

  const fetchUsers = useCallback(async () => {
    if (!adminUser || !isAdmin) return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase.rpc('get_users_for_admin', {
      p_calling_admin_id: adminUser.id,
      p_search:           search.trim() || null,
      p_plan_filter:      planFilter === 'all' ? null : planFilter,
      p_limit:            100,
      p_offset:           0,
    });

    setLoading(false);
    if (err) { setError(err.message); return; }
    setUsers((data as AdminUser[]) ?? []);
  }, [adminUser, isAdmin, search, planFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchUsers(), 400);
    return () => clearTimeout(t);
  }, [search]);

  const counts = useMemo(() => ({
    all:  users.length,
    free: users.filter(u => u.plan === 'free').length,
    pro:  users.filter(u => u.plan === 'pro').length,
    overLimit: users.filter(u => u.plan === 'free' && u.ai_searches_today >= FREE_AI_LIMIT).length,
  }), [users]);

  if (!isAdmin) {
    return (
      <div className="min-h-dvh bg-[#111113] flex items-center justify-center">
        <div className="text-center"><p className="text-3xl mb-3">🔒</p><p className="text-[14px] text-[#A1A1A1]">Admin access required</p></div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#111113] pb-10">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5]">User Management</h1>
        <p className="text-[12px] text-[#636366] mt-1">Gift Pro access · revoke · monitor AI usage</p>
      </div>

      {/* Stats row */}
      <div className="px-4 grid grid-cols-4 gap-2 mb-4">
        {[
          ['Total', counts.all, '#F5F5F5'],
          ['Pro', counts.pro, '#C8F75E'],
          ['Free', counts.free, '#8DB4FF'],
          ['At limit', counts.overLimit, '#FF6B6B'],
        ].map(([label, count, color]) => (
          <div key={String(label)} className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-2.5 text-center">
            <div className="text-[18px] font-black" style={{ color: String(color) }}>{count}</div>
            <div className="text-[8px] text-[#636366] uppercase tracking-[0.5px] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-4 py-2.5">
          <span className="text-[#636366]">🔍</span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email or name…"
            className="flex-1 bg-transparent text-[#F5F5F5] text-[13px] outline-none placeholder-[#636366]"
          />
          {search && <button onClick={() => setSearch('')} className="text-[#636366] text-[16px]">×</button>}
        </div>
      </div>

      {/* Plan filter */}
      <div className="px-4 mb-4">
        <div className="flex bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-1 gap-1">
          {(['all', 'pro', 'free'] as PlanFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setPlanFilter(f)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold capitalize transition-all ${
                planFilter === f ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366]'
              }`}
            >
              {f === 'all' ? `All (${counts.all})` : f === 'pro' ? `Pro (${counts.pro})` : `Free (${counts.free})`}
            </button>
          ))}
        </div>
      </div>

      {/* User list */}
      <div className="px-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-center">
            <p className="text-[13px] text-red-400">{error}</p>
            <button onClick={fetchUsers} className="mt-2 text-[12px] text-[#C8F75E]">Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[32px] mb-2">👥</p>
            <p className="text-[13px] text-[#636366]">No users found</p>
          </div>
        ) : (
          users.map(u => (
            <UserRow
              key={u.id}
              user={u}
              adminId={adminUser!.id}
              onRefresh={fetchUsers}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default UserManagement;
