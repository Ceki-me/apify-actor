import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';

const url = process.argv[2];
const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;
await b.navigate(url, 60000);
await new Promise(r => setTimeout(r, 1500));

// Same call readString makes, but for a large document.
const t0 = Date.now();
try {
  const res = await b.send({ method: 'Runtime.evaluate', params: {
    expression: 'document.documentElement.outerHTML', returnByValue: true,
  }}, 20000);
  const nested = res?.result ?? res;
  console.log(`elapsed=${Date.now()-t0}ms`);
  console.log('top keys:', Object.keys(res || {}).slice(0,6));
  console.log('typeof value:', typeof nested?.value, 'len:', nested?.value?.length);
  console.log('nested keys:', Object.keys(nested || {}).slice(0,8));
} catch (e) {
  console.log(`elapsed=${Date.now()-t0}ms THREW: ${e.message}`);
}
await client.disconnect();
process.exit(0);
