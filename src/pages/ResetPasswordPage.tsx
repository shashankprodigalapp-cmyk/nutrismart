/**
 * ResetPasswordPage.tsx — set a new password after clicking the emailed reset link.
 * Supabase puts a recovery session in the URL; supabase-js picks it up automatically.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { passwordProblem } from './LoginPage';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready,    setReady]    = useState<boolean | null>(null); // null = checking
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (alive && (event === 'PASSWORD_RECOVERY' || session)) setReady(true);
    });
    // Give supabase-js a moment to exchange the link for a session
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (alive) setReady(prev => prev ?? !!data.session);
    }, 1500);
    return () => { alive = false; clearTimeout(t); subscription.unsubscribe(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const weak = passwordProblem(password);
    if (weak) return setError(weak);
    if (password !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) return setError(err.message);
    navigate('/app/today', { replace: true });
  };

  const input = 'bg-[#1C1C1E] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white outline-none placeholder-[#636366] focus:border-[#C8F75E]/50';

  return (
    <div className="min-h-dvh bg-[#111113] flex flex-col items-center justify-center px-5 py-10">
      <h1 className="font-['Playfair_Display'] text-3xl font-black text-white mb-6">Set a new password</h1>
      {ready === null && <p className="text-[13px] text-[#636366]">Checking your link…</p>}
      {ready === false && (
        <div className="text-center max-w-sm">
          <p className="text-[13px] text-[#FF6B6B] mb-4">This reset link is invalid or has expired.</p>
          <button onClick={() => navigate('/login', { replace: true })}
            className="bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl px-6 py-3">
            Back to sign in
          </button>
        </div>
      )}
      {ready && (
        <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="New password (8+ chars, Aa, 1, !)" className={input} />
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
            placeholder="Confirm new password" className={input} />
          {error && <p className="text-[12px] text-[#FF6B6B] text-center">{error}</p>}
          <button type="submit" disabled={loading}
            className="bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-4 disabled:opacity-50">
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </form>
      )}
    </div>
  );
}
