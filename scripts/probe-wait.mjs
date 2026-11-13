import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const targets = process.argv.slice(2);
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} resumed=${s.resumed}\n`);

for (const url of targets) {
  // Wait strategy comparison on the SAME url, to isolate the effect of waiting.
  for (const [label, opts] of [
    ['load      ', normalizeOptions({ waitUntil: 'load', timeoutSecs: 60 })],
    ['networkidle', normalizeOptions({ waitUntil: 'networkidle', networkIdleMs: 3000, timeoutSecs: 90 })],
  ]) {
    const r = await fetchUrl(s.browser, url, opts, null);
    const html = (r.html || '').toLowerCase();
    const blocked = /just a moment|checking your browser|verify you are human|challenge-platform|enable javascript and cookies/.test(html);
    console.log(`${label}  ${blocked ? 'BLOCKED' : 'PASSED '}  ${(r.html||'').length.toString().padStart(7)} chars  ${(r.timing.waitMs+'ms').padStart(8)} wait  ${url}`);
  }
  console.log('');
}
await client.disconnect();
process.exit(0);
