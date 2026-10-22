#!/usr/bin/env node
/**
 * scripts/cron-smoke-test.mjs
 *
 * Manually fires the two cron-triggered Cloudflare Pages Functions
 * (cron-morning-verdict POST mode, energy-checkin-cron) against a live
 * deployment, using the x-cron-secret header, before wiring them into a
 * recurring schedule. Also useful as a one-off manual re-run if a
 * scheduled run ever needs to be retried.
 *
 * Usage:
 *   CRON_SECRET=xxxx node scripts/cron-smoke-test.mjs
 *   CRON_SECRET=xxxx BASE_URL=https://nutrismart-3bb.pages.dev node scripts/cron-smoke-test.mjs
 *
 * WARNING: both endpoints send REAL push notifications to REAL users
 * when triggered in this (POST/scheduled) mode. Run this manually, ONCE,
 * to verify the endpoints work before wiring up the real recurring
 * schedule — never as a repeating/scheduled CI job, or every user gets a
 * duplicate notification each time it fires. The post-deploy canary in
 * .github/workflows/canary.yml deliberately does NOT call this script;
 * it only pings side-effect-free endpoints.
 *
 * Exits non-zero if either endpoint does not return 2xx.
 */

const BASE_URL = process.env.BASE_URL ?? 'https://nutrismart-3bb.pages.dev';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error('CRON_SECRET env var is required (the value configured in Cloudflare Pages).');
  process.exit(1);
}

const endpoints = [
  '/api/cron-morning-verdict',
  '/api/energy-checkin-cron',
];

let failed = false;

for (const path of endpoints) {
  const url = `${BASE_URL}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    });
    const ms = Date.now() - started;
    const bodyText = await res.text();
    if (res.ok) {
      console.log(`[OK]   ${path} -> ${res.status} in ${ms}ms`);
      if (bodyText) console.log(`       ${bodyText.slice(0, 300)}`);
    } else {
      failed = true;
      console.error(`[FAIL] ${path} -> ${res.status} in ${ms}ms`);
      console.error(`       ${bodyText.slice(0, 500)}`);
    }
  } catch (err) {
    failed = true;
    console.error(`[FAIL] ${path} -> network error: ${err.message}`);
  }
}

if (failed) {
  console.error('\nOne or more cron endpoints failed. Do not wire up the recurring schedule until this is green.');
  process.exit(1);
}

console.log('\nBoth cron endpoints responded successfully.');
