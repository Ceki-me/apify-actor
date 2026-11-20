/**
 * Input handling: validation, request shaping, and bounded concurrency.
 *
 * Kept out of `main.ts` so the entrypoint stays a straight-line script and
 * these can be tested without booting the Apify runtime.
 */
import type { ActorInput } from './types.js';

/**
 * Trim, drop blanks, and reject anything that is not http(s).
 *
 * The scheme check is not cosmetic: `file://` and `data:` would let a caller
 * read the provider's local files through the rented browser.
 */
export function normalizeUrls(input: ActorInput): string[] {
  const urls = (input.urls ?? []).map((u) => String(u).trim()).filter((u) => u.length > 0);

  if (urls.length === 0) {
    throw new Error('`urls` is empty — provide at least one URL to fetch.');
  }

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

/**
 * Shape the service request body.
 *
 * Only fields the caller actually set are forwarded, so the service's own
 * defaults apply to everything else. `false` is forwarded — it is an
 * instruction, not an absence.
 */
export function buildRequestBody(url: string, input: ActorInput): Record<string, unknown> {
  const body: Record<string, unknown> = { url };

  if (input.browserId !== undefined) body.browserId = input.browserId;
  if (input.waitUntil !== undefined) body.waitUntil = input.waitUntil;
  if (input.waitSelector !== undefined) body.waitSelector = input.waitSelector;
  if (input.networkIdleMs !== undefined) body.networkIdleMs = input.networkIdleMs;
  if (input.timeoutSecs !== undefined) body.timeoutSecs = input.timeoutSecs;
  if (input.returnFields !== undefined) body.returnFields = input.returnFields;
  if (input.fullPageScreenshot !== undefined) body.fullPageScreenshot = input.fullPageScreenshot;
  if (input.solveChallenge !== undefined) body.solveChallenge = input.solveChallenge;

  return body;
}

/** Run `tasks` with at most `limit` in flight, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  });

  await Promise.all(runners);
  return results;
}
