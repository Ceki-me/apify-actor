import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';

const url = process.argv[2];
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;

const logs = [];
b.onEvent((method, params) => {
  if (method === 'Runtime.consoleAPICalled') {
    const args = (params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    if (args) logs.push(`console: ${args.slice(0,150)}`);
  }
  if (method === 'Runtime.exceptionThrown') {
    logs.push(`exception: ${(params.exceptionDetails?.text || '')} ${(params.exceptionDetails?.exception?.description||'').slice(0,120)}`);
  }
  if (method === 'Network.loadingFailed') {
    logs.push(`netfail: ${params.errorText} type=${params.type}`);
  }
});

await b.send({ method: 'Runtime.enable' }).catch(()=>{});
await b.send({ method: 'Network.enable' }).catch(()=>{});
await b.navigate(url, 60000);
await new Promise(r => setTimeout(r, 10000));

const res = await b.send({ method: 'Runtime.evaluate', params: {
  expression: `JSON.stringify({
    resources: performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/challenge|turnstile|cdn-cgi/i.test(n)).slice(0,10),
    totalRes: performance.getEntriesByType('resource').length,
    scripts: Array.from(document.scripts).map(s=>s.src).filter(Boolean).slice(0,12),
    hasChallengeDiv: !!document.getElementById('challenge-stage') || !!document.querySelector('[id*=challenge]'),
    ids: Array.from(document.querySelectorAll('[id]')).map(e=>e.id).slice(0,25)
  })`, returnByValue: true } });
console.log(JSON.stringify(JSON.parse(res.result.value), null, 1));

console.log('\n--- events ---');
console.log(logs.slice(0, 25).join('\n') || '(none captured)');

await client.disconnect();
process.exit(0);
