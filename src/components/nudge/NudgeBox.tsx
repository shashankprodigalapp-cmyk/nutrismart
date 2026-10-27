import React, { useState } from 'react';
import { coachApi } from '../../lib/coachApi';
import { track } from '../../lib/analytics';
import { useFlag } from '../../lib/useFlag';

const PRESETS = [
  'Nice work this week. Keep it going!',
  'How is the week going? A quick log helps me help you.',
  'Remember your protein at lunch today.',
];

export function NudgeBox({ clientId }: { clientId: string }) {
  const on = useFlag('v2_nudges');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!on) return null;

  async function send() {
    setBusy(true); setMsg(null);
    const r = await coachApi<{ message?: string }>('/api/nudge-send', { client_id: clientId, text });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.data.message ?? (r.ok ? 'Sent.' : 'Could not send. Try again.') });
    if (r.ok) { track('coach_nudge_sent'); setText(''); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="px-3 min-h-[36px] rounded-full bg-[#1C1C1E] text-xs text-[#C8F75E]">Send a nudge</button>;
  return (
    <div className="bg-[#1C1C1E] rounded-xl p-3 space-y-2 mt-2">
      <label className="block text-xs text-[#8E8E93]">Short message (max 140 characters, no links)
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={140} rows={2} className="mt-1 w-full bg-[#242426] rounded-xl p-3 text-sm text-white" /></label>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => <button key={p} onClick={() => setText(p)} className="px-2.5 min-h-[32px] rounded-full bg-[#242426] text-[11px] text-[#C7C7CC]">{p.length > 28 ? p.slice(0, 28) + '…' : p}</button>)}
      </div>
      {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-[#30D158]' : 'text-[#FF6B6B]'}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !text.trim()} onClick={send} className="px-4 min-h-[40px] rounded-full bg-[#C8F75E] text-[#111113] font-semibold text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="px-4 min-h-[40px] rounded-full bg-[#242426] text-sm">Close</button>
      </div>
    </div>
  );
}
