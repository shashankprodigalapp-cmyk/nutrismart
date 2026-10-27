// Side-effect-free check of a deployed copy of the app. Sends no notifications and changes no data.
// Usage: node scripts/smoke-v2.mjs https://your-site.pages.dev
// Checks: the site loads; every 2.0 API answers a preflight; every protected 2.0 API refuses a visitor who is not signed in.
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('Usage: node scripts/smoke-v2.mjs <site url>'); process.exit(2); }

const PROTECTED = [
  ['GET', 'admin-platform'], ['GET', 'admin-flags'], ['GET', 'admin-audit'], ['GET', 'admin-plans'], ['GET', 'admin-v2-analytics'], ['GET', 'admin-coaches'],
  ['GET', 'plans'], ['POST', 'weekly-review'], ['POST', 'weekly-review-decision'], ['POST', 'attention-action'], ['POST', 'nudge-send'],
  ['POST', 'coach-apply'], ['POST', 'coach-accept'], ['POST', 'coach-invite'], ['POST', 'coach-relationship'],
  ['POST', 'export-my-data'], ['POST', 'delete-my-account'],
];
const CRON = ['cron-nudges'];  // must refuse without the secret

let failed = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failed++; console.log('  FAIL  ' + m); };
const call = async (method, path, init = {}) => {
  try { return await fetch(`${base}${path}`, { method, redirect: 'manual', ...init }); } catch (e) { return { status: 0, error: String(e) }; }
};

const home = await call('GET', '/');
home.status === 200 ? ok('site loads') : bad(`site returned ${home.status}`);

for (const [method, name] of PROTECTED) {
  const pre = await call('OPTIONS', `/api/${name}`);
  [200, 204].includes(pre.status) ? ok(`${name}: preflight ${pre.status}`) : bad(`${name}: preflight returned ${pre.status}`);
  const r = await call(method, `/api/${name}`, method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {});
  // Not signed in must be refused. 401 is expected; 403 is acceptable; a 200 or a 5xx is a problem.
  [401, 403].includes(r.status) ? ok(`${name}: refuses a visitor (${r.status})`) : bad(`${name}: visitor got ${r.status}`);
}
for (const name of CRON) {
  const r = await call('POST', `/api/${name}`);
  [401, 403, 405].includes(r.status) ? ok(`${name}: refuses without the secret (${r.status})`) : bad(`${name}: got ${r.status} without a secret`);
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
