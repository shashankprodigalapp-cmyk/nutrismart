// One command: node scripts/agent/run.mjs  -> runs audit checks + 28-day simulation, writes test-results/AGENT_RESULTS.md and .json
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runAuditChecks } from './audit-checks.mjs';
const root = process.cwd(); mkdirSync('test-results', { recursive: true });
const checks = runAuditChecks(root);
let sim = null; try { execFileSync('node', [new URL('./sim.mjs', import.meta.url).pathname, root, 'test-results'], { stdio: 'pipe' }); } catch { /* exit 1 = issues found, report still written */ }
if (existsSync('test-results/persona-sim.json')) sim = JSON.parse(readFileSync('test-results/persona-sim.json', 'utf8'));
const c = (s) => checks.filter(x => x.status === s).length;
const md = [`# Agent test results`, `Run: ${new Date().toISOString()}`, '',
 `## Audit checks: ${c('PASS')} pass, ${c('FAIL')} fail, ${c('MANUAL')} need a person`, '', '| Result | Check | Audit item | Evidence |', '|---|---|---|---|',
 ...checks.map(x => `| ${x.status} | ${x.name} | ${x.finding} | ${x.evidence.replace(/\|/g, '/')} |`), '',
 `## 28-day simulation: ${sim ? (sim.pass ? 'PASS' : 'ISSUES FOUND') : 'not run'}`, '',
 sim ? `8 simulated people, ${sim.sentences_scanned} sentences scanned, ${sim.ai_lookups_total} AI lookups used (cap ${sim.ai_cap_per_person_per_day}/person/day, ${sim.ai_lookups_blocked_by_cap} blocked by the cap).` : '',
 '', sim ? '| Person | Days logged | Sparks | Level | Peak day | AI lookups |\n|---|---|---|---|---|---|\n' + sim.personas.map(p => `| ${p.persona} | ${p.days_logged}/28 | ${p.sparks} | ${p.level} | ${p.peak_day_sparks} | ${p.ai_lookups} |`).join('\n') : '',
 sim && sim.issues.length ? '\nIssues:\n' + sim.issues.map(i => `- ${i.persona} day ${i.day}: ${i.what}`).join('\n') : '', '',
 '## Phone-size tests', 'Run in CI only (needs a browser and test accounts). See phone-matrix.json in the CI report.'].join('\n');
writeFileSync('test-results/AGENT_RESULTS.md', md); writeFileSync('test-results/audit-checks.json', JSON.stringify(checks, null, 2));
console.log(md);
