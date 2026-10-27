// Runs vitest-style test files without vitest (for sandboxes where node_modules is incomplete).
// Usage: node scripts/run-tests-lite.mjs path/to/File.test.ts [more files]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) { try { esbuild = require(p); break; } catch { /* try next */ } }
if (!esbuild) { console.error('esbuild not found'); process.exit(2); }
const { build } = esbuild;
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const shim = `
import assert from 'node:assert/strict';
export const results = { pass: 0, fail: 0, failures: [] };
const stack = []; const queue = [];
export function describe(name, fn) { stack.push(name); fn(); stack.pop(); }
export function it(name, fn) { queue.push([[...stack, name].join(' > '), fn]); }
export const test = it;
export async function run() {
  for (const [name, fn] of queue) {
    try { await fn(); results.pass++; } catch (e) { results.fail++; results.failures.push(name + ': ' + (e && e.message ? e.message.split('\\n')[0] : e)); }
  }
}
function deepEq(a, b) { assert.deepStrictEqual(a, b); }
export function expect(v) {
  const m = (neg) => ({
    toBe: (x) => neg ? assert.notStrictEqual(v, x) : assert.strictEqual(v, x),
    toEqual: (x) => neg ? assert.notDeepStrictEqual(v, x) : deepEq(v, x),
    toBeNull: () => neg ? assert.notStrictEqual(v, null) : assert.strictEqual(v, null),
    toBeUndefined: () => neg ? assert.notStrictEqual(v, undefined) : assert.strictEqual(v, undefined),
    toBeTruthy: () => neg ? assert.ok(!v) : assert.ok(v),
    toBeFalsy: () => neg ? assert.ok(v) : assert.ok(!v),
    toBeGreaterThan: (x) => assert.ok(neg ? !(v > x) : v > x),
    toBeGreaterThanOrEqual: (x) => assert.ok(neg ? !(v >= x) : v >= x),
    toBeLessThan: (x) => assert.ok(neg ? !(v < x) : v < x),
    toBeLessThanOrEqual: (x) => assert.ok(neg ? !(v <= x) : v <= x),
    toBeCloseTo: (x, d = 2) => assert.ok(neg ? !(Math.abs(v - x) < Math.pow(10, -d) / 2) : Math.abs(v - x) < Math.pow(10, -d) / 2),
    toHaveLength: (n) => neg ? assert.notStrictEqual(v.length, n) : assert.strictEqual(v.length, n),
    toContain: (x) => assert.ok(neg ? !v.includes(x) : v.includes(x)),
    toMatch: (r) => assert.ok(neg ? !r.test(v) : r.test(v)),
    toHaveProperty: (k) => assert.ok(neg ? !(k in v) : (k in v)),
    toThrow: () => { let t = false; try { v(); } catch { t = true; } assert.ok(neg ? !t : t); },
  });
  return Object.assign(m(false), { not: m(true) });
}
export const vi = { fn: (f) => f ?? (() => {}), mock: () => {}, useFakeTimers: () => {}, useRealTimers: () => {}, setSystemTime: () => {} };
export const beforeEach = () => {}; export const afterEach = () => {}; export const beforeAll = () => {}; export const afterAll = () => {};
`;
const dir = mkdtempSync(join(tmpdir(), 'lite-'));
writeFileSync(join(dir, 'shim.mjs'), shim);
let failed = 0;
for (const f of process.argv.slice(2)) {
  const out = join(dir, f.replace(/[^a-z0-9]/gi, '_') + '.mjs');
  await build({ entryPoints: [resolve(f)], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [{ name: 'shim', setup(b) { b.onResolve({ filter: /^vitest$/ }, () => ({ path: pathToFileURL(join(dir, 'shim.mjs')).href, external: true })); } }], logLevel: 'error' });
  const mod = await import(pathToFileURL(out).href);
  const live = await import(pathToFileURL(join(dir, 'shim.mjs')).href);
  await live.run();
  console.log(`${f}: ${live.results.pass} passed, ${live.results.fail} failed`);
  for (const x of live.results.failures) console.log('  FAIL', x);
  failed += live.results.fail;
}
process.exit(failed ? 1 : 0);
