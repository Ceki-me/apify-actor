import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { writeFileSync } from 'node:fs';

const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;

await b.navigate('https://www.glassdoor.com/Reviews/index.htm', 60000);

for (const t of [3, 8, 15, 25]) {
  await new Promise(r => setTimeout(r, t === 3 ? 3000 : 7000));
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: `JSON.stringify({
      t: ${t},
      title: document.title,
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({src: (f.src||'').slice(0,90), w: f.offsetWidth, h: f.offsetHeight})),
      widget: (() => { const w = document.querySelector('[id^=cf-chl-widget]'); return w ? {id: w.id, html: w.innerHTML.slice(0,200), w: w.offsetWidth, h: w.offsetHeight} : null })(),
      bodyLen: document.body.innerText.length
    })`, returnByValue: true } });
  const v = JSON.parse(res.result.value);
  console.log(`--- t+${t}s title=${JSON.stringify(v.title)} iframes=${v.iframes.length} bodyLen=${v.bodyLen}`);
  for (const f of v.iframes) console.log(`    iframe ${f.w}x${f.h} ${f.src}`);
  if (v.widget) console.log(`    widget ${v.widget.w}x${v.widget.h} html=${JSON.stringify(v.widget.html.slice(0,120))}`);
}

const shot = await b.screenshot({ format: 'base64' });
writeFileSync('/home/node/.openclaw/workspace/screenshots/apify-cf/_diag-glassdoor.png', Buffer.from(shot.data, 'base64'));
console.log('\nscreenshot saved');

await client.disconnect();
process.exit(0);
