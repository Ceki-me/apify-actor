import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { writeFileSync } from 'node:fs';

const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;
console.log(`session=${s.sessionId}`);

await b.navigate('https://www.booking.com/', 60000);
for (const wait of [0, 3000, 5000, 8000]) {
  if (wait) await new Promise(r => setTimeout(r, 3000));
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: `JSON.stringify({
      url: location.href, title: document.title, ready: document.readyState,
      htmlLen: document.documentElement ? document.documentElement.outerHTML.length : -1,
      bodyLen: document.body ? document.body.innerHTML.length : -1,
      hasWidget: !!document.querySelector('[id^=cf-chl-widget]'),
      frames: Array.from(document.querySelectorAll('iframe')).map(f=>f.src.slice(0,60)),
      text: document.body ? document.body.innerText.slice(0,200) : ''
    })`, returnByValue: true } }, 20000).catch(e => ({ err: e.message }));
  const v = res.result ? JSON.parse(res.result.value) : { err: res.err };
  console.log(`+${wait}ms ${JSON.stringify(v).slice(0,420)}`);
}
const shot = await b.screenshot({ format: 'base64' });
writeFileSync('/home/node/.openclaw/workspace/screenshots/apify-cf/_booking-diag.png', Buffer.from(shot.data, 'base64'));
await client.disconnect();
process.exit(0);
