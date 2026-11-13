import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';

const url = process.argv[2];
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;

await b.navigate(url, 60000);
for (const secs of [2, 5, 10, 20, 35]) {
  await new Promise(r => setTimeout(r, secs * 1000 - (secs === 2 ? 0 : 0)));
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: `JSON.stringify({url: location.href, title: document.title, len: document.documentElement.outerHTML.length, cf: !!document.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification'), body: document.body ? document.body.innerText.slice(0,120) : ''})`,
    returnByValue: true,
  }});
  const v = JSON.parse(res.result?.value ?? '{}');
  console.log(`t+${secs}s wake  url=${v.url}`);
  console.log(`         title=${JSON.stringify(v.title)} len=${v.len} challenge=${v.cf}`);
  console.log(`         text=${JSON.stringify((v.body||'').slice(0,110))}`);
}
await client.disconnect();
process.exit(0);
