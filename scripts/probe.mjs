import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';
const targets = process.argv.slice(2);
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, 58164);
console.log(`session=${s.sessionId} resumed=${s.resumed}\n`);
for (const url of targets) {
  const r = await fetchUrl(s.browser, url, normalizeOptions({timeoutSecs:45}), null);
  const h = r.html || '';
  const text = h.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  const blocked = /just a moment|checking your browser|attention required|enable javascript and cookies|access denied|are you a robot|verify you are human/i.test(text);
  console.log(`${url}`);
  console.log(`  ok=${r.ok} status=${r.status} title=${JSON.stringify((r.title||'').slice(0,60))} len=${h.length} blocked=${blocked}`);
  console.log(`  text: ${text.slice(0,150)}`);
  console.log('');
}
await client.disconnect();
