import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { coachApi } from '../lib/coachApi';
import { useRoles } from '../lib/useRoles';
import { AppSkeleton } from '../components/AppSkeleton';

interface ClientRow { relationship_id: string; client_id: string; client_name: string; status: string; accepted_at: string | null }
interface Invite { id: string; invite_label: string | null; invite_expires_at: string | null }

function Apply({ onDone, open }: { onDone: () => void; open: boolean }) {
  const [name, setName] = useState(''); const [cred, setCred] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await coachApi('/api/coach-apply', { display_name: name, credentials: cred });
    setBusy(false);
    if (r.ok) onDone(); else setMsg(r.data.message ?? 'Could not submit. Try again.');
  };
  if (!open) return <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">Coach accounts are not open yet. Please check back soon.</p>;
  return (
    <form onSubmit={submit} className="bg-[#1C1C1E] rounded-2xl p-5 space-y-3">
      <h2 className="font-semibold">Apply to be a coach</h2>
      <label className="block text-xs text-[#8E8E93]">Your name
        <input value={name} onChange={e => setName(e.target.value)} maxLength={80} required className="mt-1 w-full bg-[#242426] rounded-lg px-3 py-2 text-sm text-white" />
      </label>
      <label className="block text-xs text-[#8E8E93]">Qualification (optional)
        <input value={cred} onChange={e => setCred(e.target.value)} maxLength={200} className="mt-1 w-full bg-[#242426] rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Registered Dietitian" />
      </label>
      {msg && <p role="alert" className="text-sm text-[#FF6B6B]">{msg}</p>}
      <button disabled={busy} className="w-full bg-[#C8F75E] text-[#111113] font-bold rounded-xl py-3 disabled:opacity-50">{busy ? 'Sending…' : 'Apply'}</button>
    </form>
  );
}

export default function CoachPage() {
  const { loading, roles, coachEnabled, coachSignupOpen } = useRoles();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [c, i] = await Promise.all([
      supabase.rpc('coach_clients'),
      supabase.from('coach_client_relationships').select('id, invite_label, invite_expires_at').eq('status', 'invited').order('invited_at', { ascending: false }),
    ]);
    if (c.error || i.error) { setError('Could not load your clients. Try again.'); return; }
    setClients((c.data ?? []) as ClientRow[]);
    setInvites((i.data ?? []) as Invite[]);
  }, []);
  useEffect(() => { if (roles.coach) void load(); }, [roles.coach, load]);

  const createInvite = async () => {
    setBusy(true); setError(null); setLink(null);
    const r = await coachApi<{ link: string }>('/api/coach-invite', { label });
    setBusy(false);
    if (r.ok) { setLink(r.data.link); setLabel(''); void load(); } else setError(r.data.message ?? 'Could not create the invite.');
  };
  const cancelInvite = async (id: string) => {
    const r = await coachApi('/api/coach-relationship', { id, action: 'end' });
    if (!r.ok) setError(r.data.message ?? 'Could not cancel.'); void load();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link ?? ''); } catch { /* user can select the text */ } };

  if (loading) return <AppSkeleton />;
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-bold">Coach</h1>
        <Link to="/app/profile" className="text-xs text-[#8E8E93] underline">Back to app</Link>
      </div>
      {!coachEnabled && !roles.coach && <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">The coach area is not switched on yet.</p>}
      {coachEnabled && !roles.coach && !roles.coach_pending && !applied && <Apply open={coachSignupOpen} onDone={() => setApplied(true)} />}
      {(roles.coach_pending || applied) && !roles.coach && <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#EBEBF5]/80">Thanks. Your application is waiting for approval. We will let you in as soon as it is approved.</p>}
      {roles.coach && (
        <>
          {error && <p role="alert" className="text-sm text-[#FF6B6B]">{error}</p>}
          <div className="bg-[#1C1C1E] rounded-2xl p-5 space-y-3">
            <h2 className="font-semibold">Invite a client</h2>
            <div className="flex gap-2">
              <input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="Client name (only you see this)" aria-label="Client name for this invite" className="flex-1 bg-[#242426] rounded-lg px-3 py-2 text-sm text-white" />
              <button onClick={createInvite} disabled={busy} className="bg-[#C8F75E] text-[#111113] font-bold rounded-lg px-4 text-sm disabled:opacity-50">{busy ? '…' : 'Create link'}</button>
            </div>
            {link && (
              <div className="bg-[#242426] rounded-lg p-3 space-y-2">
                <p className="text-xs text-[#8E8E93]">Send this link to your client. It works once and expires in 14 days. It is shown only now.</p>
                <p className="text-xs break-all select-all">{link}</p>
                <button onClick={copy} className="text-xs underline text-[#C8F75E]">Copy link</button>
              </div>
            )}
            {invites.length > 0 && (
              <ul className="divide-y divide-white/5">
                {invites.map(i => (
                  <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{i.invite_label || 'Invite'} <span className="text-[11px] text-[#8E8E93]">· waiting{i.invite_expires_at ? `, expires ${new Date(i.invite_expires_at).toLocaleDateString('en-IN')}` : ''}</span></span>
                    <button onClick={() => void cancelInvite(i.id)} className="text-xs text-[#FF6B6B]">Cancel</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-[#1C1C1E] rounded-2xl p-5">
            <h2 className="font-semibold mb-2">Your clients ({clients.length})</h2>
            {clients.length === 0
              ? <p className="text-sm text-[#8E8E93]">No clients yet. Create an invite link above and send it to your first client.</p>
              : <ul className="divide-y divide-white/5">{clients.map(c => (
                  <li key={c.relationship_id} className="flex items-center justify-between py-2.5 text-sm">
                    <span>{c.client_name}</span>
                    <span className="text-[11px] text-[#8E8E93]">{c.status === 'paused' ? 'sharing paused' : 'active'}</span>
                  </li>))}</ul>}
          </div>
        </>
      )}
    </div>
  );
}
