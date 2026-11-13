/**
 * Probe genuinely Cloudflare-protected targets and classify the outcome.
 *
 * Distinguishes three outcomes rather than a bare HTTP status:
 *   - PASSED  — real page content, no challenge markers
 *   - BLOCKED — challenge/interstitial served instead of content
 *   - ERROR   — navigation or extraction failed
 *
 * Cloudflare detection looks at response headers/cookies where the provider
 * exposes them, and falls back to interstitial phrasing in the DOM.
 */
import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const CHALLENGE_PHRASES = [
  'just a moment',
  'checking your browser',
  'verify you are human',
  'enable javascript and cookies to continue',
  'attention required',
  'access denied',
  "you've been blocked",
  'are you a robot',
  'cf-browser-verification',
  'challenge-platform',
];

function classify(result) {
  const html = (result.html || '').toLowerCase();
  const title = (result.title || '').toLowerCase();

  const hit = CHALLENGE_PHRASES.find((p) => html.includes(p) || title.includes(p));
  if (hit) return { verdict: 'BLOCKED', why: `challenge text: "${hit}"` };

  if (!result.ok) return { verdict: 'ERROR', why: result.error || 'unknown' };

  const status = result.status;
  if (status !== null && status >= 400) {
    return { verdict: 'BLOCKED', why: `HTTP ${status}` };
  }

  const len = (result.html || '').length;
  if (len < 5000) return { verdict: 'BLOCKED', why: `suspiciously small DOM (${len} chars)` };

  const cfCookie = (result.cookies || []).find((c) => String(c.name).startsWith('cf_') || c.name === '__cf_bm');
  return { verdict: 'PASSED', why: cfCookie ? `cf cookie ${cfCookie.name}` : `${len} chars` };
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node probe-cf.mjs <url> [url...]');
  process.exit(1);
}

const client = await connect(process.env.CEKI_TOKEN, {});
const session = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${session.sessionId} resumed=${session.resumed}\n`);

const rows = [];
for (const url of targets) {
  const result = await fetchUrl(session.browser, url, normalizeOptions({ timeoutSecs: 60 }), null);
  const { verdict, why } = classify(result);
  rows.push({ url, verdict, why });
  console.log(`${verdict.padEnd(8)} ${url}`);
  console.log(`         ${why}`);
}

const passed = rows.filter((r) => r.verdict === 'PASSED').length;
console.log(`\n--- ${passed}/${rows.length} passed ---`);
for (const r of rows) console.log(`${r.verdict.padEnd(8)} ${r.url}`);

await client.disconnect();
process.exit(0);
