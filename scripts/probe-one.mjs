import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const name = process.argv[3] || 'probe';
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} resumed=${s.resumed}`);
const r = await fetchUrl(s.browser, url, normalizeOptions({ timeoutSecs: 90, returnFields: ['html','screenshot'], solveChallenge: true }), null);
console.log(JSON.stringify({ ok: r.ok, status: r.status, finalUrl: r.finalUrl, title: r.title, html: (r.html||'').length, challengeSolved: r.challengeSolved, error: r.error, timing: r.timing }, null, 1));
if (r.screenshot) writeFileSync(`/home/node/.openclaw/workspace/screenshots/apify-cf/${name}.png`, Buffer.from(r.screenshot, 'base64'));
await client.disconnect();
process.exit(0);
