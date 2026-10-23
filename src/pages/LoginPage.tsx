/**
 * LoginPage.tsx — Auth entry point (Google OAuth + Email)
 * Redirects to location.state.from after successful login.
 */
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** Returns a human message if the password is too weak, otherwise null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8)        return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(pw))    return 'Password needs a lowercase letter.';
  if (!/[A-Z]/.test(pw))    return 'Password needs an uppercase letter.';
  if (!/[0-9]/.test(pw))    return 'Password needs a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a symbol (e.g. ! @ # $).';
  return null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from     = (location.state as any)?.from?.pathname ?? '/app/log';

  const [mode,     setMode]     = useState<'login' | 'signup'>('login');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: `${window.location.origin}${from}` },
    });
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const weak = passwordProblem(password);
        if (weak) throw new Error(weak);
        const { data, error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { name }, emailRedirectTo: `${window.location.origin}/app/log` },
        });
        if (err) throw err;
        // No session = Supabase is waiting for the user to click the email link.
        // (Also the case for an already-registered address: identities is empty.)
        if (!data.session) {
          if (data.user && (data.user.identities?.length ?? 0) === 0) {
            throw new Error('This email is already registered. Please sign in instead.');
          }
          setNotice(`We sent a verification link to ${email}. Click it, then come back and sign in.`);
          setMode('login');
          setPassword('');
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err?.message?.includes('already registered')) {
          setMode('login'); throw new Error('Account exists — signing you in');
        }
        if (err) throw err;
      }
      navigate(from, { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#111113] flex flex-col items-center justify-center px-5 py-10">
      <div className="text-5xl mb-4">🥗</div>
      <h1 className="font-['Playfair_Display'] text-4xl font-black text-white mb-2">nutrismart</h1>
      <p className="text-[13px] text-[#636366] mb-10 text-center max-w-[260px]">
        The only tracker that knows how your kitchen cooks
      </p>

      {/* Google */}
      <button onClick={handleGoogle} disabled={loading}
        className="w-full max-w-sm bg-white text-[#111113] font-bold text-[14px] rounded-2xl py-4 flex items-center justify-center gap-3 mb-3 disabled:opacity-50">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 w-full max-w-sm mb-3">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-[11px] text-[#636366]">or</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Email form */}
      <form onSubmit={handleEmail} className="w-full max-w-sm flex flex-col gap-3">
        {/* Mode toggle */}
        <div className="flex bg-[#1C1C1E] rounded-xl p-1 gap-1">
          {(['login','signup'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-[12px] font-semibold capitalize transition-all ${m === mode ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366]'}`}>
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {mode === 'signup' && (
          <input value={name} onChange={e => setName(e.target.value)} required
            placeholder="Your name" type="text"
            className="bg-[#1C1C1E] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white outline-none placeholder-[#636366] focus:border-[#C8F75E]/50" />
        )}
        <input value={email} onChange={e => setEmail(e.target.value)} required
          placeholder="Email address" type="email"
          className="bg-[#1C1C1E] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white outline-none placeholder-[#636366] focus:border-[#C8F75E]/50" />
        <input value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
          placeholder={mode === 'signup' ? 'Password (8+ chars, Aa, 1, !)' : 'Password'} type="password"
          className="bg-[#1C1C1E] border border-white/10 rounded-xl px-4 py-3 text-[14px] text-white outline-none placeholder-[#636366] focus:border-[#C8F75E]/50" />

        {error  && <p className="text-[12px] text-[#FF6B6B] text-center">{error}</p>}
        {notice && <p className="text-[12px] text-[#C8F75E] text-center">{notice}</p>}

        <button type="submit" disabled={loading}
          className="bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-4 disabled:opacity-50 mt-1">
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <p className="text-[11px] text-[#636366] mt-8 text-center max-w-[300px]">
        By continuing you agree to our Terms of Service and Privacy Policy.
        DPDP Act 2023 compliant. Your data stays on your device.
      </p>
    </div>
  );
}
