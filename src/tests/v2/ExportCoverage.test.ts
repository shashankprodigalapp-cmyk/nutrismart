import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keeps "download my data" in step with the database. Any new table that points at a person
 * must either be exported or be listed here with the reason it is not.
 */
const NOT_EXPORTED: Record<string, string> = {
  rate_limits: 'server counter, no personal content',
  v2_rate_limits: 'server counter, no personal content',
  ai_call_log: 'technical log of AI calls, no meal or personal content',
  ai_search_log: 'technical log of AI searches',
  admin_audit: 'internal admin log',
  audit_logs: 'internal security log, anonymised when the person is deleted',
  processed_webhooks: 'payment provider bookkeeping',
  search_review: 'internal moderation queue',
  sync_queue: 'temporary offline queue, emptied once synced',
  attention_actions: 'a coach’s own snooze notes about a client; not the client’s data',
  ai_insights: 'evidence lines are already inside the exported reviews',
  admin_users: 'admin accounts cannot be deleted by themselves',
  users: 'exported as users',
};

const root = process.cwd();
const sql = readdirSync(join(root, 'supabase/migrations')).sort()
  .map(f => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const exported = new Set([...readFileSync(join(root, 'functions/api/export-my-data.ts'), 'utf8').matchAll(/table: '(\w+)'/g)].map(m => m[1]));

const personTables: string[] = [];
for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  if (/REFERENCES\s+(public|auth)\.users/i.test(m[2])) personTables.push(m[1]);
}

describe('export covers every table that holds a person’s data', () => {
  it('found the tables', () => { expect(personTables.length > 20).toBe(true); });
  for (const t of [...new Set(personTables)]) {
    it(t, () => { expect(exported.has(t) || t in NOT_EXPORTED).toBe(true); });
  }
  it('the allow-list has no stale entries', () => {
    for (const k of Object.keys(NOT_EXPORTED)) {
      if (k === 'users') continue;
      if (!new RegExp('CREATE TABLE IF NOT EXISTS public\\.' + k + '\\b').test(sql)) expect(`${k} is listed but no longer exists`).toBe('');
    }
  });
});
