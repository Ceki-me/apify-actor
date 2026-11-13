/**
 * Test whether the Cloudflare checkbox on Glassdoor can be clicked through.
 * A real browser with mouse control should be able to satisfy the widget —
 * waiting alone does nothing, which is what the earlier probe measured.
 */
import { connect } from '@ceki/sdk';
import { acquireSession } from '../dist/session.js';
import { writeFileSync } from 'node:fs';

const TARGET = process.env.TARGET_URL ?? 'https://www.glassdoor.com/Reviews/index.htm';
const OUT = '/home/node/.openclaw/workspace/screenshots/apify-cf';

const client = await connect(process.env.CEKI_TOKEN, {});
const s = await acquireSession(client, Number(process.env.CEKI_BROWSER_ID));
const b = s.browser;
console.log(`session=${s.sessionId} resumed=${s.resumed}`);

await b.navigate(TARGET, 60000);
await new Promise((r) => setTimeout(r, 6000));

// Frame tree reveals whether the challenge lives in a cross-origin iframe.
const tree = await b.send({ method: 'Page.getFrameTree' });
const walk = (n, d = 0) => {
  console.log('  '.repeat(d) + 'frame: ' + (n.frame?.url || '').slice(0, 95));
  for (const c of n.childFrames || []) walk(c, d + 1);
};
walk(tree.frameTree);

const metrics = await b.send({ method: 'Page.getLayoutMetrics' });
const vp = metrics.cssLayoutViewport;
console.log(`viewport ${vp.clientWidth}x${vp.clientHeight}`);

const before = await b.screenshot({ format: 'base64' });
writeFileSync(`${OUT}/_gd_before.png`, Buffer.from(before.data, 'base64'));

// The widget sits mid-page. Try plausible hit points rather than guessing once.
// Widget sits around 40-49% of viewport height, centred horizontally.
// Try the checkbox itself and a few points around it.
const points = [
  [0.50, 0.42], [0.50, 0.44], [0.50, 0.46],
  [0.50, 0.40], [0.50, 0.48], [0.44, 0.44],
  [0.56, 0.44],
];

for (const [fx, fy] of points) {
  const x = Math.round(vp.clientWidth * fx);
  const y = Math.round(vp.clientHeight * fy);
  await b.click(x, y).catch((e) => console.log(`  click error: ${e.message}`));
  await new Promise((r) => setTimeout(r, 4000));

  const t = await b
    .send({ method: 'Runtime.evaluate', params: { expression: 'document.title', returnByValue: true } })
    .catch(() => null);
  const title = t?.result?.value;
  console.log(`click ${x},${y} -> title=${JSON.stringify(title)}`);
  if (title && !/just a moment/i.test(title)) {
    console.log('CHALLENGE PASSED');
    break;
  }
}

const after = await b.screenshot({ format: 'base64' });
writeFileSync(`${OUT}/_gd_after.png`, Buffer.from(after.data, 'base64'));
console.log('screenshots saved');

await client.disconnect();
process.exit(0);
