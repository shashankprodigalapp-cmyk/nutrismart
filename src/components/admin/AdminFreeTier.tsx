/**
 * AdminFreeTier.tsx: are Gemini, Supabase and Cloudflare still inside their free plans?
 */
import React, { useEffect, useState } from 'react';
import { saveGeminiLimits, useAdminInsights } from './useAdminInsights';
import { Bars, Card, Empty, Meter, STATUS_STYLE, fmtBytes, fmtNum } from './adminUi';

const MODELS = [
  { model: 'gemini-3.5-flash-lite', label: 'Flash Lite', what: 'name search and photo nutrition' },
  { model: 'gemini-3.8-flash', label: '3.8 Flash', what: 'photo identify' },
  { model: 'gemini-embedding-001', label: 'Embedding', what: 'matching similar foods' },
];

const shortDate = (d: string) => { const [, m, day] = d.split('-'); return `${Number(day)}/${Number(m)}`; };

export function AdminFreeTier() {
  const { data, error, loading, reload } = useAdminInsights(30);
  const [lim, setLim] = useState<Record<string, { rpd: string; rpm: string }>>({});
  const [saved, setSaved] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (!data) return;
    const next: Record<string, { rpd: string; rpm: string }> = {};
    for (const m of MODELS) {
      const v = data.settings.model_limits?.[m.model];
      next[m.model] = { rpd: v?.rpd ? String(v.rpd) : '', rpm: v?.rpm ? String(v.rpm) : '' };
    }
    setLim(next);
  }, [data?.generated_at]);

  const save = async () => {
    const toNum = (s: string) => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return n > 0 ? n : null; };
    const payload: Record<string, { rpd: number | null; rpm: number | null }> = {};
    for (const m of MODELS) payload[m.model] = { rpd: toNum(lim[m.model]?.rpd ?? ''), rpm: toNum(lim[m.model]?.rpm ?? '') };
    const ok = await saveGeminiLimits(payload);
    setSaved(ok ? 'ok' : 'fail');
    if (ok) void reload();
  };

  const ins = data?.insights;
  const overall = data ? STATUS_STYLE[data.health] : null;
  const tokens = ins ? ins.ai_daily.reduce((a, d) => ({ i: a.i + d.input_tokens, o: a.o + d.output_tokens }), { i: 0, o: 0 }) : { i: 0, o: 0 };

  return (
    <div className="px-4 md:px-8 py-5 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Free tier watch</h2>
          <p className="text-xs text-[#8E8E93]">Are you still inside the free plans?{data ? ` Provider limits checked on ${data.limits_checked_on}.` : ''}</p>
        </div>
        <button onClick={() => void reload()} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1C1C1E] text-white">Refresh</button>
      </div>

      {loading && !data && <Empty>Loading...</Empty>}
      {error && <div className="rounded-2xl bg-[#2a1717] border border-[#FF5D5D]/40 text-sm text-[#ffb3b3] p-4">{error}</div>}

      {data && ins && overall && (
        <>
          <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1C1C1E] flex items-center gap-3">
            <i className={`inline-block w-3 h-3 rounded-full ${overall.dot}`} />
            <p className="text-sm text-white">
              {data.health === 'ok' && 'Everything measured is comfortably inside the free plans.'}
              {data.health === 'warn' && 'Something is getting close to its free limit. See the amber card below.'}
              {data.health === 'critical' && 'A free limit is hit or almost hit. See the red card below and the steps at the bottom.'}
              {data.health === 'unknown' && 'Nothing could be measured yet.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.meters.map(m => (
              <Meter key={m.key} label={m.label} used={m.used} limit={m.limit} status={m.status} note={m.note} link={m.link}
                projected={m.projected} format={n => (m.unit === 'bytes' ? fmtBytes(n) : fmtNum(n))} />
            ))}
          </div>

          <Card title="Your Gemini limits" hint="Read from Google AI Studio (Rate limits page) on 2026-10-25 and filled in for you. If Google changes them, or you move to a paid plan, edit and save. Leave a box empty if you do not know it.">
            <div className="space-y-3">
              {MODELS.map(m => (
                <div key={m.model} className="grid sm:grid-cols-[1fr_120px_120px] gap-3 items-end">
                  <div>
                    <p className="text-sm text-white font-semibold">{m.label}</p>
                    <p className="text-[11px] text-[#8E8E93]">{m.what}</p>
                  </div>
                  <label className="text-xs text-[#8E8E93]">Per day
                    <input inputMode="numeric" value={lim[m.model]?.rpd ?? ''}
                      onChange={e => { setLim(l => ({ ...l, [m.model]: { ...(l[m.model] ?? { rpd: '', rpm: '' }), rpd: e.target.value } })); setSaved('idle'); }}
                      className="mt-1 w-full rounded-xl bg-[#111113] border border-white/[0.1] px-3 py-2 text-sm text-white" />
                  </label>
                  <label className="text-xs text-[#8E8E93]">Per minute
                    <input inputMode="numeric" value={lim[m.model]?.rpm ?? ''}
                      onChange={e => { setLim(l => ({ ...l, [m.model]: { ...(l[m.model] ?? { rpd: '', rpm: '' }), rpm: e.target.value } })); setSaved('idle'); }}
                      className="mt-1 w-full rounded-xl bg-[#111113] border border-white/[0.1] px-3 py-2 text-sm text-white" />
                  </label>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={() => void save()} className="px-4 py-2 rounded-xl bg-[#C8F75E] text-[#111113] text-sm font-bold">Save</button>
              <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer" className="text-xs text-[#C8F75E] underline">Open AI Studio</a>
              {saved === 'ok' && <span className="text-xs text-[#C8F75E]">Saved.</span>}
              {saved === 'fail' && <span className="text-xs text-[#FF5D5D]">Could not save. Try again.</span>}
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="AI calls per day (last 15 days)" hint="Real calls to Google or Anthropic. Days follow Google's clock: US Pacific.">
              {ins.ai_daily.length === 0 ? <Empty>No AI calls recorded yet. They appear after the update is live and someone uses AI search.</Empty> : (
                <Bars height={130}
                  items={ins.ai_daily.map(d => ({ label: shortDate(d.day), values: [d.ok, d.limited, d.errors] }))}
                  parts={[{ name: 'Worked', color: '#C8F75E' }, { name: 'Refused by Google (limit)', color: '#FF5D5D' }, { name: 'Other errors', color: '#FFB340' }]} />
              )}
              <p className="text-xs text-[#8E8E93] mt-3">
                Tokens used in these days: <b className="text-white">{fmtNum(tokens.i)}</b> in, <b className="text-white">{fmtNum(tokens.o)}</b> out.
                Shared-cache answers cost no AI calls: <b className="text-white">{fmtNum(ins.ai_cache.cache_hits)}</b> of {fmtNum(ins.ai_cache.lookups)} lookups.
              </p>
            </Card>

            <Card title="Where the AI calls go" hint="Last 30 days.">
              {ins.ai_endpoints.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[#8E8E93]"><th className="py-1 font-semibold">What</th><th className="font-semibold">By</th><th className="font-semibold">Calls</th><th className="font-semibold">Worked</th><th className="font-semibold">Avg time</th></tr></thead>
                  <tbody>
                    {ins.ai_endpoints.map(e => (
                      <tr key={e.endpoint + e.provider} className="border-t border-white/[0.06] text-white">
                        <td className="py-1.5">{({ name: 'Food name lookup', describe: 'Describe a meal', vision: 'Photo identify', vision_lookup: 'Photo nutrition', embed: 'Cache matching' } as Record<string, string>)[e.endpoint] ?? e.endpoint}</td>
                        <td>{e.provider === 'gemini' ? 'Gemini' : 'Claude'}</td><td>{fmtNum(e.calls)}</td>
                        <td>{e.calls ? Math.round((e.ok / e.calls) * 100) : 0}%</td><td>{(e.avg_ms / 1000).toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="Biggest tables in your database" hint="If the database meter turns amber, these are what to trim first.">
            {ins.system.tables.map(t => (
              <div key={t.name} className="flex justify-between text-xs py-1.5 border-t first:border-t-0 border-white/[0.06]">
                <span className="text-white">{t.name}</span><span className="text-[#8E8E93]">{fmtBytes(t.bytes)}, about {fmtNum(t.rows)} rows</span>
              </div>
            ))}
          </Card>

          <Card title="What to do if a card turns red">
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-[#E5E5EA]">
              <li><b>Gemini limit hit:</b> the app still works. People see "could not identify" for new AI lookups until Google's day resets (about 12:30 or 13:30 IST). Repeat searches stay free through the cache. Fix: lower the daily allowance per user (5 AI searches, 1 photo), or turn on paid billing in Google AI Studio.</li>
              <li><b>Database near 500 MB:</b> old log rows are trimmed automatically. If it keeps growing, tell Claude which table is the biggest from the list above.</li>
              <li><b>Cloudflare or Supabase transfer:</b> not measurable here. Open the provider link on the card now and then.</li>
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

export default AdminFreeTier;
