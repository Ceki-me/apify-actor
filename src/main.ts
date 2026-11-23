/**
 * Actor entrypoint — a thin HTTP client.
 *
 * The Actor holds no browser logic, no CDP, and no Ceki token. It posts URLs to
 * the fetch service and writes the answers to the dataset. Everything valuable
 * — session management, challenge solving, the warmed profiles — lives behind
 * the endpoint.
 *
 * That split is not cosmetic. This repository is public: anyone reading it sees
 * exactly what we do. Keeping the interesting part out of it is the difference
 * between publishing a client and publishing a recipe.
 */
import { Actor, log } from 'apify';

import { buildRequestBody, mapLimit, normalizeUrls } from './input.js';
import type { ActorInput, FetchResponse } from './types.js';

/**
 * PPE events. HTML and a screenshot are different products: a screenshot costs
 * a full-page render and yields an image the caller would otherwise have to
 * produce themselves, so it is charged separately and higher. A request that
 * asks for both is charged for both — the caller receives two deliverables.
 *
 * Failures are never charged: billing for a page the caller did not receive
 * would be wrong, and it would make our own outages a revenue source.
 */
const EVENT_PAGE_FETCHED = 'page-fetched';
const EVENT_SCREENSHOT = 'screenshot';

/** How many URLs to have in flight at once. */
const DEFAULT_CONCURRENCY = 4;

function requireEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (value === '') {
    throw new Error(
      `${name} is not set. Add it as a secret environment variable in the Actor settings.`,
    );
  }
  return value;
}

interface ServiceConfig {
  baseUrl: string;
  key: string;
  timeoutMs: number;
}

function readConfig(): ServiceConfig {
  const baseUrl = requireEnv('CEKI_FETCH_URL').replace(/\/+$/, '');
  const key = requireEnv('CEKI_FETCH_KEY');
  const timeoutSecs = Number(process.env.CEKI_FETCH_TIMEOUT_SECS ?? 300);

  return {
    baseUrl,
    key,
    timeoutMs: (Number.isFinite(timeoutSecs) && timeoutSecs > 0 ? timeoutSecs : 300) * 1000,
  };
}

function failure(url: string, error: string, started: number): FetchResponse {
  return {
    url,
    ok: false,
    status: null,
    finalUrl: null,
    timing: { queueMs: 0, navigateMs: 0, waitMs: 0, extractMs: 0, totalMs: Date.now() - started },
    worker: null,
    error,
  };
}

/**
 * POST one URL to the service.
 *
 * Never throws: a failure is reported as `ok: false` plus `error`, so one bad
 * URL does not abort a multi-URL run.
 */
async function fetchOne(
  config: ServiceConfig,
  url: string,
  input: ActorInput,
): Promise<FetchResponse> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(`${config.baseUrl}/v1/fetch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(buildRequestBody(url, input)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return failure(url, `service returned HTTP ${res.status}: ${text.slice(0, 300)}`, started);
    }

    return (await res.json()) as FetchResponse;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `service request timed out after ${config.timeoutMs}ms`
          : err.message
        : String(err);
    return failure(url, message, started);
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  await Actor.init();
  const input = ((await Actor.getInput<ActorInput>()) ?? {}) as ActorInput;

  const urls = normalizeUrls(input);
  const config = readConfig();
  const concurrency = Math.max(1, Math.min(16, input.concurrency ?? DEFAULT_CONCURRENCY));

  log.info('fetching', { urls: urls.length, concurrency, service: config.baseUrl });

  const results = await mapLimit(urls, concurrency, async (url) => {
    const result = await fetchOne(config, url, input);

    await Actor.pushData(result);

    if (result.ok) {
      // Charge for what was actually delivered, not what was requested: the
      // service can return ok:true with a field missing (a screenshot can fail
      // on its own while the HTML succeeded).
      const charges: string[] = [];
      if (input.returnFields?.includes('screenshot') && result.screenshot) {
        charges.push(EVENT_SCREENSHOT);
      }
      if (result.html) {
        charges.push(EVENT_PAGE_FETCHED);
      }
      for (const eventName of charges) {
        try {
          await Actor.charge({ eventName });
        } catch (err) {
          log.warning('charge failed', { url, eventName, err: String(err) });
        }
      }
      if (charges.length === 0) {
        log.warning('nothing deliverable to charge for', { url });
      }
    } else {
      log.warning('fetch failed', { url, error: result.error });
    }

    return result;
  });

  const ok = results.filter((r) => r.ok).length;
  log.info('run finished', { total: results.length, ok, failed: results.length - ok });

  await Actor.exit();
}

main().catch(async (err) => {
  log.error('actor failed', { err: err instanceof Error ? err.message : String(err) });
  try {
    await Actor.exit({ exitCode: 1 });
  } catch {
    process.exit(1);
  }
});
