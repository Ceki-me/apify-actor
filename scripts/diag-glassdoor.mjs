import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';

const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;

await b.navigate('https://www.glassdoor.com/Reviews/index.htm', 60000);
await new Promise(r => setTimeout(r, 8000));

const probe = async (label, expr) => {
  try {
    const res = await b.send({ method: 'Runtime.evaluate', params: { expression: `JSON.stringify(${expr})`, returnByValue: true } });
    console.log(`${label}: ${res.result?.value}`);
  } catch (e) { console.log(`${label}: ERR ${e.message}`); }
};

await probe('url        ', '({href: location.href, title: document.title})');
await probe('frames     ', 'Array.from(document.querySelectorAll("iframe")).map(f => f.src.slice(0,120))');
await probe('turnstile  ', '({ts: !!document.querySelector("[class*=turnstile], .cf-turnstile"), cf: !!document.querySelector("#challenge-form, #cf-challenge-running, #challenge-stage")})');
await probe('detect     ', '({wd: navigator.webdriver, plugins: navigator.plugins.length, langs: navigator.languages, ua: navigator.userAgent.slice(0,90)})');
await probe('cfSignals  ', '({cookies: document.cookie.slice(0,200)})');
await probe('bodyText   ', 'document.body ? document.body.innerText.slice(0,300) : ""');
await probe('rayId      ', '(() => { const m = document.body.innerText.match(/Ray ID:?\\s*([a-f0-9]+)/i); return m ? m[1] : null })()');

await client.disconnect();
process.exit(0);
