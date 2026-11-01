import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decideNudge, DEFAULT_PREFS } from '../../../functions/_shared/nudgeRules';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const NEW_USER = ['intel-refresh', 'rec-action', 'intel-report'];
const NEW_COACH = ['coach-intel', 'messages'];

describe('2.1 security and permissions (checked in the source)', () => {
  it('every new person-facing endpoint checks the sign-in, limits the rate and gates on a switch', () => {
    for (const f of [...NEW_USER, ...NEW_COACH]) {
      const s = read(`functions/api/${f}.ts`);
      expect(s, f).toContain('verifyJWT'); expect(s, f).toContain('throttle(');
      if (f !== 'rec-action') expect(s, f).toMatch(/flagOn\(/);          // rec-action only updates the caller's own rows
    }
  });
  it('a person can only ever touch their own rows', () => {
    expect(read('functions/api/rec-action.ts')).toMatch(/\.eq\('user_id', auth\.userId\)/g);
    expect((read('functions/api/rec-action.ts').match(/\.eq\('user_id', auth\.userId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(read('functions/api/intel-refresh.ts')).not.toMatch(/client_id/);          // no way to ask for someone else
    expect(read('functions/api/intel-report.ts')).not.toMatch(/client_id/);
  });
  it('coach endpoints need the coach role, an active link and shared food; energy only if shared', () => {
    for (const f of NEW_COACH) {
      const s = read(`functions/api/${f}.ts`);
      expect(s).toContain('getRoles'); expect(s).toContain("'active'"); expect(s).toContain('share_scope');
    }
    const ci = read('functions/api/coach-intel.ts');
    expect(ci).toContain('energy: !!rel.share_scope?.energy'); expect(ci).toContain('rel.share_scope?.food');
  });
  it('a coach message is never sent without approval, and the text rules apply', () => {
    const s = read('functions/api/messages.ts');
    expect(s).toContain("status: 'draft'");                       // drafts are created as drafts
    expect(s).toContain("m.status !== 'draft'");                  // only drafts can be approved
    expect(s).toContain('cleanDraft(');                           // no links, 140 characters
    expect(s).not.toMatch(/status: 'sent'[^}]*\n[^]*action === 'draft'/);
    expect(s.indexOf("action === 'review'")).toBeLessThan(s.indexOf("deliverNudge(env"));
  });
  it('the notification job needs the secret and the switch; the cron schedule exists', () => {
    const s = read('functions/api/cron-intel.ts');
    expect(s).toContain("x-cron-secret"); expect(s).toContain("flagOn(env, 'smart_notifications')");
    expect(read('.github/workflows/cron.yml')).toContain('/api/cron-intel');
  });
  it('smart notifications are opt-in: muted unless the person switched them on', () => {
    const base = { kind: 'smart' as const, now: new Date('2026-11-01T06:30:00Z'), sentToday: 0, lastSentAt: null, hasDevice: true };
    expect(decideNudge({ ...base, prefs: { ...DEFAULT_PREFS } })).toEqual({ ok: false, reason: 'muted' });
    expect(decideNudge({ ...base, prefs: { ...DEFAULT_PREFS, smart_nudges: true } })).toEqual({ ok: true });
  });
  it('every new table has row security on, only a read-own policy, and no browser write policy', () => {
    const sql = ['041_intelligence_core', '042_notifications_messages'].map(n => read(`supabase/migrations/${n}.sql`)).join('\n');
    for (const t of ['personal_features', 'recommendations', 'intel_reports', 'notification_decisions', 'intel_messages']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
    }
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(sql).toContain("status = 'sent'");                      // a recipient never sees a draft
  });
  it('the person can export and delete their new data', () => {
    const ex = read('functions/api/export-my-data.ts');
    for (const t of ['personal_features', 'recommendations', 'intel_reports', 'notification_decisions', 'intel_messages']) expect(ex).toContain(`table: '${t}'`);
    expect(ex).toContain("filter: ['status', 'sent']");           // unsent drafts stay out of the export
    const sql = read('supabase/migrations/041_intelligence_core.sql') + read('supabase/migrations/042_notifications_messages.sql');
    expect((sql.match(/REFERENCES public\.users\(id\) ON DELETE CASCADE/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it('pure intelligence modules import nothing from the browser or the server', () => {
    for (const f of readdirSync(join(process.cwd(), 'src/lib/intel'))) {
      const imports = [...read(`src/lib/intel/${f}`).matchAll(/from '([^']+)'/g)].map(m => m[1]);
      for (const i of imports) expect(i.startsWith('./'), `${f} imports ${i}`).toBe(true);
    }
  });
  it('the LLM never decides a number: no AI call in the intelligence modules or endpoints', () => {
    for (const p of ['functions/_shared/intelServer.ts', 'functions/api/intel-refresh.ts', 'functions/api/intel-report.ts', 'functions/api/cron-intel.ts', 'functions/api/messages.ts', 'functions/api/coach-intel.ts']) {
      expect(read(p), p).not.toMatch(/aiFetch|generativelanguage|anthropic/i);
    }
  });
  it('photo search stays removed', () => { expect(existsSync(join(process.cwd(), 'functions/api/ai-vision.ts'))).toBe(false); });
});
