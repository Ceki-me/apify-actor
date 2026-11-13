/**
 * Live smoke test — runs the actor's own session + fetch code against a real
 * rented browser. Not part of the actor bundle; used to validate the transport
 * assumptions (resume, Runtime.evaluate DOM, session persistence).
 */
import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const token = process.env.CEKI_TOKEN;
const browserId = Number(process.env.CEKI_BROWSER_ID ?? 0);
const url = process.env.TEST_URL ?? 'https://example.com';

if (!token || !browserId) {
  console.error('CEKI_TOKEN and CEKI_BROWSER_ID are required');
  process.exit(1);
}

const opts = normalizeOptions({
  waitUntil: 'load',
  timeoutSecs: 60,
  returnFields: ['html', 'cookies', 'screenshot'],
});

const client = await connect(token, {});

const acqStart = Date.now();
const session = await acquireSession(client, browserId);
console.log(`\n[1] session  id=${session.sessionId} resumed=${session.resumed} ${Date.now() - acqStart}ms`);

const result = await fetchUrl(session.browser, url, opts, {
  scheduleId: session.scheduleId,
  sessionId: session.sessionId,
  resumed: session.resumed,
});

console.log(`[2] fetch    ok=${result.ok} status=${result.status} title=${JSON.stringify(result.title)}`);
console.log(`            finalUrl=${result.finalUrl}`);
console.log(`            timing  ${JSON.stringify(result.timing)}`);
console.log(`            html    ${result.html ? result.html.length + ' chars' : 'MISSING'}`);
console.log(`            cookies ${result.cookies ? result.cookies.length : 'none'}`);
console.log(`            shot    ${result.screenshot ? result.screenshot.length + ' b64 chars' : 'none'}`);
if (result.error) console.log(`            error   ${result.error}`);
if (result.html) {
  console.log(`            head    ${JSON.stringify(result.html.slice(0, 160))}`);
}

// Leave the session alive so the next invocation can resume it — that is the
// behaviour the actor relies on.
await client.disconnect();
console.log(`\n[3] session left alive for resume: ${session.sessionId}`);
