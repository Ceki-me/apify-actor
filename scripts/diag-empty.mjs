import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';

const url = process.argv[2];
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;
console.log(`session=${s.sessionId} resumed=${s.resumed} url=${url}`);

const t0 = Date.now();
await b.navigate(url, 60000);
console.log(`navigate returned in ${Date.now()-t0}ms`);

for (const ms of [0, 1500, 4000]) {
  if (ms) await new Promise(r => setTimeout(r, ms));
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      hasDocEl: !!document.documentElement,
      htmlLen: document.documentElement ? document.documentElement.outerHTML.length : -1,
      bodyLen: document.body ? document.body.innerHTML.length : -1
    })`, returnByValue: true } }, 20000).catch(e => ({ error: e.message }));
  console.log(`+${ms}ms ${JSON.stringify(res.result?.value ?? res.error)}`);
}
await client.disconnect();
process.exit(0);
