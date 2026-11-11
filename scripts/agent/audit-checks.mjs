// Audit checks as code. Each check names the audit finding it comes from. Read-only: it only reads files in the repo.
// Usage: node scripts/agent/audit-checks.mjs [repoRoot]   -> returns an array of { id, finding, name, status, evidence }
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function runAuditChecks(root = process.cwd()) {
  const R = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
  const walk = (d, out = []) => { for (const n of readdirSync(join(root, d))) { const p = join(d, n); if (n === 'node_modules' || n === '.git') continue; statSync(join(root, p)).isDirectory() ? walk(p, out) : out.push(p); } return out; };
  const out = []; const add = (id, finding, name, ok, evidence, manual = false) => out.push({ id, finding, name, status: manual ? 'MANUAL' : ok ? 'PASS' : 'FAIL', evidence });

  // ---- things that were strong in the audit: these must stay true ----
  const mig = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  const tabs = new Set(), rls = new Set();
  for (const f of mig) { const s = R('supabase/migrations/' + f);
    for (const m of s.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/gi)) tabs.add(m[1]);
    for (const m of s.matchAll(/alter table (?:public\.)?(\w+)\s+enable row level security/gi)) rls.add(m[1]); }
  const noRls = [...tabs].filter(t => !rls.has(t));
  add('S01', 'RLS', 'Every table has row level security', noRls.length === 0, `${tabs.size} tables, ${noRls.length} without RLS ${noRls.join(', ')}`);

  const fns = readdirSync(join(root, 'functions/api')).filter(f => f.endsWith('.ts'));
  const AUTH = /verifyJWT|requireRole|requireAdmin|requireCoach|CRON_SECRET|verifyRazorpaySignature|crypto\.subtle/;
  const open = fns.filter(f => !AUTH.test(R('functions/api/' + f)));
  add('S02', 'AUTH', 'Every API function checks who is calling', open.length === 0, `${fns.length} functions, open: ${open.join(', ') || 'none'}`);

  const src = walk('src').filter(p => /\.(tsx?|css)$/.test(p) && !p.includes('/tests/'));
  const xss = src.filter(p => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(R(p)));
  add('S03', 'XSS', 'No raw HTML injection in the app', xss.length === 0, xss.join(', ') || 'none found');

  const keyHits = walk('.').filter(p => /\.(ts|tsx|js|mjs|yml|json)$/.test(p) && !p.includes('node_modules') && !p.includes('/tests/') && /(AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{24,}|eyJhbGciOi[A-Za-z0-9_-]{20,})/.test(R(p)));
  add('S04', 'SECRETS', 'No API keys committed', keyHits.length === 0, keyHits.join(', ') || 'none found');

  const sp = R('src/lib/sparks.ts'); const ledger = R('supabase/migrations/049_sparks.sql');
  add('S05', 'GAMIFICATION', 'Sparks never depend on calories, weight or speed', !/calorie|weight|\bfast(ing)?\b|kcal/i.test(sp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\/.*$/gm, '')), 'src/lib/sparks.ts has no calorie, weight or fasting inputs');
  add('S06', 'GAMIFICATION', 'Sparks ledger blocks duplicates and browser writes', /UNIQUE \(user_id, day, kind, ref\)/.test(ledger) && !/FOR (INSERT|UPDATE|DELETE|ALL)/.test(ledger), 'migration 049: unique key, select-only policy');
  add('S07', 'WEBHOOK', 'Payment webhook compares signatures in constant time', /constantTimeEqual/.test(R('functions/api/razorpay-webhook.ts')), 'functions/api/razorpay-webhook.ts');

  // ---- the audit findings: these FAIL today and should turn PASS when fixed ----
  const ai = R('functions/api/ai-search.ts');
  add('F02', 'F02', 'AI food prompt does not claim IFCT or "verified" provenance', !/"source":"IFCT"|IFCT verified/.test(ai), 'functions/api/ai-search.ts prompt');
  const join_ = R('src/pages/JoinPage.tsx');
  add('F03', 'F03', 'Coach sharing starts switched off', !/useState<Record<string, boolean>>\(\{ food: true, energy: true/.test(join_), 'src/pages/JoinPage.tsx initial scope');
  const roles = R('functions/_shared/roles.ts');
  add('F04', 'F04', 'Rate limiter blocks when its counter fails', !/Fails open/i.test(roles) && !/TEST_MODE/.test(roles), 'functions/_shared/roles.ts throttle()');
  add('F09a', 'F09', 'Old Netlify functions removed', !existsSync(join(root, 'netlify')), existsSync(join(root, 'netlify')) ? 'netlify/ folder still present' : 'removed');
  const stray = readdirSync(root).filter(f => /^v2-\d+.*\.py$/.test(f));
  add('F09b', 'F09', 'No patch scripts left in the repo root', stray.length === 0, stray.join(', ') || 'none');
  const dg = R('DEPLOY_GUIDE.md'); const nl = (dg.match(/netlify/gi) || []).length;
  add('F09c', 'F09', 'Deploy guide no longer tells people to use Netlify', nl === 0, `${nl} mentions`);
  add('F10', 'F10', 'Billing routes are switched off while the product is free', /flagOn|feature_flags|billing_enabled/.test(R('functions/api/submit-payment.ts')), 'functions/api/submit-payment.ts');
  add('F11', 'F11', 'Content Security Policy is enforced, not report-only', !/Content-Security-Policy-Report-Only/.test(R('public/_headers')), 'public/_headers');
  const cr = ['cron-intel', 'cron-nudges', 'cron-morning-verdict', 'energy-checkin-cron'].map(n => R(`functions/api/${n}.ts`)).join('\n');
  add('F12', 'F12', 'Cron secret compared in constant time', !/!== env\.CRON_SECRET/.test(cr), 'cron-*.ts');
  add('F13', 'F13', 'Gemini key sent in a header, not the URL', !/\?key=\$\{env\.GEMINI_API_KEY\}/.test(ai) && !/keyDiag\(env\)\}/.test(ai), 'functions/api/ai-search.ts');
  add('F16', 'F16', 'No "first" marketing claim in the app manifest', !/first nutrition app/i.test(R('vite.config.ts')), 'vite.config.ts');
  add('F20', 'F20', 'Legal pages use the current product name', !/Nutri Smart/.test(walk('public/legal').map(p => R(p)).join('\n')), 'public/legal');
  add('F06', 'F06', 'Offline sync checks versions before overwriting', /updated_at|version/.test(R('src/lib/SyncManager.ts').split('upsert_template')[0].slice(-3000)), 'src/lib/SyncManager.ts');
  add('F07', 'F07', 'Error tracking is configured', /sentry|logflare|datadog/i.test(R('package.json') + R('src/main.tsx')), 'package.json, src/main.tsx');
  add('F08', 'F08', 'Backup and restore steps are written down', /point-in-time|PITR|restore drill/i.test(R('docs/RUNBOOK.md')), 'docs/RUNBOOK.md');
  add('F01', 'F01', 'Preview uses a different database from production', false, 'cannot be read from code: confirm in Cloudflare and Supabase settings', true);
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('audit-checks.mjs')) console.log(JSON.stringify(runAuditChecks(process.argv[2] || process.cwd()), null, 2));
