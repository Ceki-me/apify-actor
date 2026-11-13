/**
 * Actor entrypoint.
 *
 * Flow per run:
 *   1. connect to Ceki with the account key from env
 *   2. acquire a session — resume a live one for the target browser, else rent
 *   3. fetch every input URL sequentially (one browser, one tab)
 *   4. either leave the session alive (default) or release it
 *
 * Sequential, not parallel, on purpose: a single rented browser has one tab,
 * and the relay caps commands per session. Concurrency belongs at the level of
 * parallel Actor runs on different browsers, which is what Apify already does.
 */
import { Actor, log } from 'apify';
import { connect } from '@ceki/sdk';
import type { Client } from '@ceki/sdk';

import { acquireSession } from './session.js';
import { fetchUrl, normalizeOptions } from './fetch.js';
import type { ActorInput, FetchResult } from './types.js';

/** Apify PPE event charged once per successfully fetched URL. */
const EVENT_PER_RESULT = 'page-fetched';

const DEFAULT_BROWSER_ID = Number(process.env.CEKI_BROWSER_ID ?? 0) || undefined;

function requireToken(): string {
  const token = (process.env.CEKI_TOKEN ?? '').trim();
  if (token === '') {
    throw new Error(
      'CEKI_TOKEN is not set. Add your Ceki agent key as a secret environment ' +
        'variable in the Actor settings, or pass it in the input.',
    );
  }
  return token;
}

function resolveBrowserId(input: ActorInput): number {
  const id = input.browserId ?? DEFAULT_BROWSER_ID;
  if (id === undefined || Number.isNaN(id) || id <= 0) {
    throw new Error(
      'No browser selected. Pass `browserId` in the input, or set the ' +
        'CEKI_BROWSER_ID environment variable on the Actor.',
    );
  }
  return id;
}

function normalizeUrls(input: ActorInput): string[] {
  const urls = (input.urls ?? [])
    .map((u) => String(u).trim())
    .filter((u) => u.length > 0);

  if (urls.length === 0) {
    throw new Error('`urls` is empty — provide at least one URL to fetch.');
  }

  // Reject non-HTTP schemes early: file:// and data: would let a caller read
  // the provider's local files through the rented browser.
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme "${parsed.protocol}" in ${url}`);
    }
  }

  return urls;
}

async function main(): Promise<void> {
  await Actor.init();
  const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;

  const urls = normalizeUrls(input);
  const browserId = resolveBrowserId(input);
  const opts = normalizeOptions({
    waitUntil: input.waitUntil,
    waitSelector: input.waitSelector,
    networkIdleMs: input.networkIdleMs,
    timeoutSecs: input.timeoutSecs,
    returnFields: input.returnFields,
    fullPageScreenshot: input.fullPageScreenshot,
  });
  const keepSession = input.keepSession !== false;

  const token = requireToken();

  let client: Client | null = null;
  let sessionMeta: FetchResult['browser'] = null;

  try {
    client = await connect(token, {
      apiUrl: process.env.CEKI_API_URL,
      relayUrl: process.env.CEKI_RELAY_URL,
    });

    const sessionStart = Date.now();
    const session = await acquireSession(client, browserId);
    const sessionMs = Date.now() - sessionStart;

    sessionMeta = {
      scheduleId: session.scheduleId,
      sessionId: session.sessionId,
      resumed: session.resumed,
    };

    log.info('session acquired', {
      browserId,
      sessionId: session.sessionId,
      resumed: session.resumed,
      sessionMs,
    });

    for (const url of urls) {
      const result = await fetchUrl(session.browser, url, opts, sessionMeta);
      // Attribute the acquisition cost to every URL's timing breakdown so the
      // numbers account for the full cost of getting to that page.
      result.timing.sessionMs = sessionMs;

      await Actor.pushData(result);

      if (result.ok) {
        // Pay-per-event: one charge per successfully delivered page. Failures
        // are free — charging for a page the user did not receive would be
        // wrong, and it also stops us from billing for our own outages.
        try {
          await Actor.charge({ eventName: EVENT_PER_RESULT });
        } catch (err) {
          log.warning('charge failed', { url, err: String(err) });
        }
      } else {
        log.warning('fetch failed', { url, error: result.error });
      }
    }

    if (!keepSession) {
      // Explicit release ends the session for the provider too. Without it the
      // session outlives the run, which is the whole point of keepSession.
      await session.browser.release();
      log.info('session released', { sessionId: session.sessionId });
    } else {
      // Detach without ending: the session stays alive at the provider, so the
      // next run resumes onto the same warmed profile.
      await client.disconnect();
      log.info('session kept for reuse', { sessionId: session.sessionId });
    }
  } finally {
    if (client !== null) {
      try {
        await client.close();
      } catch {
        // Already disconnected / closed — nothing left to clean up.
      }
    }
    await Actor.exit();
  }

  if (sessionMeta === null) {
    log.warning('run finished without acquiring a session');
  }
}

main().catch(async (err) => {
  log.error('actor failed', { err: err instanceof Error ? err.message : String(err) });
  try {
    await Actor.exit({ exitCode: 1 });
  } catch {
    process.exit(1);
  }
});
