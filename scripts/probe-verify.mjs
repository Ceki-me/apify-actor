import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';

const targets = process.argv.slice(2);
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} resumed=${s.resumed}\n`);

for (const url of targets) {
  const r = await fetchUrl(s.browser, url, normalizeOptions({ timeoutSecs: 60 }), null);
  const html = r.html || '';
  const text = html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log(`${url}`);
  console.log(`  finalUrl=${r.finalUrl}`);
  console.log(`  title=${JSON.stringify(r.title)}`);
  console.log(`  len=${html.length} status=${r.status}`);
  console.log(`  text=${JSON.stringify(text.slice(0,180))}`);
  console.log('');
}
await client.disconnect();
process.exit(0);
