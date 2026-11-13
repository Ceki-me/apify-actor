import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const url = process.argv[2];
const n = Number(process.argv[3] || 3);
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} url=${url}\n`);

for (let i = 1; i <= n; i++) {
  const r = await fetchUrl(s.browser, url, normalizeOptions({ timeoutSecs: 90, solveChallenge: true }), null);
  const txt = (r.html || '').replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const hardBlock = /additional verification required/i.test(txt);
  const challenge = /just a moment|verifying you are human/i.test(txt) || /just a moment/i.test(r.title||'');
  console.log(`#${i} ok=${r.ok} status=${r.status} title=${JSON.stringify((r.title||'').slice(0,40))} html=${(r.html||'').length} solved=${r.challengeSolved} hardBlock=${hardBlock} challenge=${challenge} ${(r.timing.totalMs/1000).toFixed(1)}s ${r.error||''}`);
}
await client.disconnect();
process.exit(0);
