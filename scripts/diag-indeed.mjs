import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const name = process.argv[3] || 'indeed';
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;
console.log(`session=${s.sessionId}`);

await b.navigate(url, 60000);
for (const wait of [0, 3000, 6000, 10000]) {
  if (wait) await new Promise(r => setTimeout(r, wait === 3000 ? 3000 : 3000));
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      htmlLen: document.documentElement.outerHTML.length,
      hasWidget: !!document.querySelector('[id^=cf-chl-widget]'),
      hasChallengeFrame: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
      text: document.body ? document.body.innerText.slice(0,220) : ''
    })`, returnByValue: true } }, 20000).catch(() => null);
  const v = res ? JSON.parse(res.result.value) : null;
  if (!v) { console.log(`+${wait}: read failed`); continue; }
  console.log(`+${wait}ms title=${JSON.stringify(v.title)} len=${v.htmlLen} widget=${v.hasWidget} frame=${v.hasChallengeFrame}`);
  console.log(`        ${JSON.stringify(v.text.slice(0,160))}`);
}
const shot = await b.screenshot({ format: 'base64' });
writeFileSync(`/home/node/.openclaw/workspace/screenshots/apify-cf/_${name}.png`, Buffer.from(shot.data, 'base64'));
await client.disconnect();
process.exit(0);
