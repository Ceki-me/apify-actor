import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const CHALLENGE = /just a moment|checking your browser|verify you are human|challenge-platform|enable javascript and cookies|attention required|access denied|you've been blocked|are you a robot/i;

const targets = process.argv.slice(2);
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} resumed=${s.resumed}\n`);

const rows = [];
for (const url of targets) {
  const want = new URL(url).host;
  const r = await fetchUrl(s.browser, url, normalizeOptions({ timeoutSecs: 75, solveChallenge: true }), null);
  const html = r.html || '';
  const text = html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

  let verdict, why;
  const got = r.finalUrl ? new URL(r.finalUrl).host : null;
  // Compare registrable domains: www.zalando.de -> en.zalando.de is a normal
  // locale redirect, not a stray page.
  const root = (h) => h.split('.').slice(-2).join('.');
  if (!r.ok) { verdict='ERROR'; why = r.error || 'unknown'; }
  else if (got && root(got) !== root(want)) { verdict='WRONG_PAGE'; why = `landed on ${got}`; }
  else if (r.status && r.status >= 400) { verdict='BLOCKED'; why = `HTTP ${r.status}`; }
  else if (CHALLENGE.test(text) || CHALLENGE.test(r.title||'')) { verdict='BLOCKED'; why = 'challenge page'; }
  else if (html.length < 5000) { verdict='BLOCKED'; why = `tiny DOM ${html.length}`; }
  else { verdict='PASSED'; why = `${html.length} chars`; }

  if (r.challengeSolved) why += ' [+challenge]';
  rows.push({url, verdict, why});
  console.log(`${verdict.padEnd(11)} ${url.replace(/^https:\/\/(www\.)?/,'').padEnd(28)} ${why.padEnd(34)} ${(r.timing.totalMs/1000).toFixed(1)}s`);
}

const by = {};
for (const r of rows) by[r.verdict] = (by[r.verdict]||0)+1;
console.log('\n' + Object.entries(by).map(([k,v])=>`${k}=${v}`).join('  ') + `  TOTAL=${rows.length}`);

await client.disconnect();
process.exit(0);
