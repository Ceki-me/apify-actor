/**
 * Fetch a batch of targets and write their screenshots to disk so they can be
 * inspected visually. One PNG per target, named after the host.
 */
import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { fetchUrl, normalizeOptions } from '../dist/fetch.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const outDir = process.argv[2];
const targets = process.argv.slice(3);
mkdirSync(outDir, { recursive: true });

const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
console.log(`session=${s.sessionId} resumed=${s.resumed}\n`);

for (const url of targets) {
  const r = await fetchUrl(s.browser, url, normalizeOptions({
    timeoutSecs: 60,
    returnFields: ['html', 'screenshot'],
    fullPageScreenshot: false,
  }), null);

  const host = new URL(url).host.replace(/^www\./, '');
  const name = `${host.replace(/[^a-z0-9.-]/gi, '_')}.png`;

  if (r.screenshot) {
    writeFileSync(`${outDir}/${name}`, Buffer.from(r.screenshot, 'base64'));
    console.log(`OK    ${name.padEnd(30)} ${Math.round(r.screenshot.length * 0.75 / 1024)}KB  status=${r.status} html=${(r.html||'').length}`);
  } else {
    console.log(`NOSHOT ${name.padEnd(29)} ok=${r.ok} err=${r.error || '-'}`);
  }
}
await client.disconnect();
process.exit(0);
