// The "Birthday dinner" bug: a coach or admin can READ other people's rows (that is how coaching works), so any screen that asks the database
// for "my rows" without saying whose must filter by the signed-in person. Without it, a coach saw clients' plans on their own Today screen,
// and Skipped / Cancel did nothing because the database (correctly) refused to let them change someone else's row.
// (A change aimed at one row by its id, or experiment days of an experiment the screen already filtered, is allowed.)
// This test reads every customer-facing file and fails if a read or change of a person-owned table has no owner filter.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OWNED = ['daily_logs', 'daily_checkins', 'meal_feelings', 'energy_logs', 'flexible_meals', 'experiments', 'experiment_days', 'daily_nutrition_metrics', 'nudges', 'nudge_preferences', 'daily_adherence', 'user_profile', 'meal_templates'];
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
// admin and coach screens read many people on purpose; sync code writes the owner id inside the row itself
const SKIP = /(\/admin\/|\/tests\/|SyncManager|pages\/coach\/|CoachPage|MyCoachPage|coach\/)/;

describe('person-owned tables are always read with an owner filter', () => {
  const offenders: string[] = [];
  for (const f of walk(join(process.cwd(), 'src')).filter(p => !SKIP.test(p))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\.from\('([a-z_]+)'\)/g)) {
      if (!OWNED.includes(m[1])) continue;
      const rest = s.slice(m.index!, m.index! + 600);
      const stmt = rest.slice(8).split(/;\s*\n|\.from\(/)[0];   // this chain only, not the next query beside it
            if (/user_id|clientId|who\b|uid\b|\.insert\(|\.upsert\(|\.eq\('experiment_id'|\.update\(.*\.eq\('id'/s.test(stmt)) continue;
      if (/\.eq\('user_id', who\)/.test(s.slice(m.index!, m.index! + 700))) continue;   // `who` = the client being coached, or else the signed-in person
      offenders.push(`${f.replace(process.cwd() + '/', '')}:${s.slice(0, m.index!).split('\n').length} ${m[1]}`);
    }
  }
  it('no screen asks for "all my rows" without naming the owner', () => { expect(offenders.join("\n")).toBe(""); });
  it('the flexible meal card filters reads and changes by owner and checks a row was really changed', () => {
    const s = readFileSync(join(process.cwd(), 'src/components/FlexibleMealCard.tsx'), 'utf8');
    expect(s).toContain(".eq('user_id', user.id).eq('planned_for', day)");
    expect(s).toContain(".eq('id', id).eq('user_id', user!.id).select('id')");
    expect(s).toContain('data.length === 0');
  });
});
