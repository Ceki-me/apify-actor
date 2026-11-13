/**
 * Per-URL work: navigate, wait, extract.
 *
 * Everything here goes through the Ceki SDK's `Browser`, which forwards CDP
 * frames to the rented provider over WebRTC (falling back to the relay WS).
 * There is no browser automation library involved — plain CDP keeps the actor
 * dependency-light and avoids a second driver fighting the extension.
 */
import type { Browser } from '@ceki/sdk';
import type { FetchResult, FetchTiming, ReturnField } from './types.js';

export interface FetchOptions {
  waitUntil: 'load' | 'networkidle' | 'selector';
  waitSelector?: string;
  networkIdleMs: number;
  timeoutSecs: number;
  returnFields: ReturnField[];
  fullPageScreenshot: boolean;
}

const DEFAULT_OPTIONS: FetchOptions = {
  waitUntil: 'load',
  networkIdleMs: 500,
  timeoutSecs: 60,
  returnFields: ['html'],
  fullPageScreenshot: false,
};

export function normalizeOptions(partial: Partial<FetchOptions>): FetchOptions {
  const merged = { ...DEFAULT_OPTIONS, ...partial };
  // A strict selector wait with no selector would hang until the overall
  // timeout; degrade to `load` instead and let the run succeed.
  if (merged.waitUntil === 'selector' && !merged.waitSelector) {
    merged.waitUntil = 'load';
  }
  if (merged.returnFields.length === 0) {
    merged.returnFields = ['html'];
  }
  return merged;
}

function now(): number {
  return Date.now();
}

/** Run `fn` with a hard deadline, so one stuck URL cannot eat the whole run budget. */
async function withTimeout<T>(ms: number, fn: () => Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Poll `Runtime.evaluate` until `expression` is truthy.
 *
 * CDP has no "wait for selector" helper the provider is guaranteed to expose,
 * so polling keeps this portable across extension versions. The interval is
 * deliberately short: a load that is already done resolves on the first poll.
 */
async function waitForExpression(
  browser: Browser,
  expression: string,
  deadline: number,
  intervalMs = 100,
): Promise<void> {
  for (;;) {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    })) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    if (result?.value === true) return;
    if (now() >= deadline) {
      throw new Error('wait condition not met before deadline');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Resolve once the document has been quiet for `quietMs`.
 *
 * Implemented by sampling `performance.getEntriesByType('resource').length`
 * rather than listening to the network domain: the resource-timing buffer is
 * always present, while Network.enable adds per-request event traffic over the
 * P2P channel for no extra signal here.
 */
async function waitForNetworkIdle(
  browser: Browser,
  quietMs: number,
  deadline: number,
): Promise<void> {
  const countExpression =
    "performance.getEntriesByType('resource').length";
  let lastCount = -1;
  let quietSince = now();

  for (;;) {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: { expression: countExpression, returnByValue: true },
    })) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    const count = Number(result?.value ?? -1);

    if (count !== lastCount) {
      lastCount = count;
      quietSince = now();
    } else if (now() - quietSince >= quietMs) {
      return;
    }

    if (now() >= deadline) {
      // Degrade gracefully: a page with a long-poll or analytics beacon may
      // never go idle. Returning the current DOM beats failing the fetch.
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Read the main document's HTTP status, when the provider exposes it. */
async function readStatus(browser: Browser): Promise<number | null> {
  try {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: {
        expression: 'performance.getEntriesByType("navigation")[0]?.responseStatus ?? null',
        returnByValue: true,
      },
    })) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    const value = result?.value;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function readString(browser: Browser, expression: string): Promise<string | null> {
  try {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    })) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    const value = result?.value;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one URL. Never throws — a failure is reported as `ok: false` plus
 * `error`, so one bad URL does not abort a multi-URL run.
 */
export async function fetchUrl(
  browser: Browser,
  url: string,
  opts: FetchOptions,
  sessionMeta: { scheduleId: number; sessionId: string; resumed: boolean } | null,
): Promise<FetchResult> {
  const totalStart = now();
  const deadline = totalStart + opts.timeoutSecs * 1000;

  const timing: FetchTiming = {
    sessionMs: 0,
    navigateMs: 0,
    waitMs: 0,
    extractMs: 0,
    totalMs: 0,
  };

  const result: FetchResult = {
    url,
    ok: false,
    status: null,
    finalUrl: null,
    timing,
    browser: sessionMeta,
  };

  try {
    const navStart = now();
    await withTimeout(
      Math.max(1000, deadline - now()),
      () => browser.navigate(url, Math.max(1000, deadline - now())),
      'navigate',
    );
    timing.navigateMs = now() - navStart;

    const waitStart = now();
    if (opts.waitUntil === 'selector' && opts.waitSelector) {
      const selectorLiteral = JSON.stringify(opts.waitSelector);
      const expression =
        `!!document.querySelector(${selectorLiteral})`;
      await withTimeout(
        Math.max(1000, deadline - now()),
        () => waitForExpression(browser, expression, deadline),
        'waitSelector',
      );
    } else if (opts.waitUntil === 'networkidle') {
      await waitForNetworkIdle(browser, opts.networkIdleMs, deadline);
    }
    timing.waitMs = now() - waitStart;

    const extractStart = now();

    result.finalUrl = await readString(browser, 'location.href');
    result.status = await readStatus(browser);
    const title = await readString(browser, 'document.title');
    if (title !== null) result.title = title;

    if (opts.returnFields.includes('html')) {
      const html = await readString(browser, 'document.documentElement.outerHTML');
      if (html !== null) result.html = html;
    }

    if (opts.returnFields.includes('cookies')) {
      try {
        const cookieRes = await browser.send({ method: 'Network.getAllCookies' });
        const cookies = (cookieRes as Record<string, unknown>)?.cookies;
        if (Array.isArray(cookies)) {
          result.cookies = cookies as Array<Record<string, unknown>>;
        }
      } catch {
        // Cookies are best-effort: some providers restrict Network domain.
      }
    }

    if (opts.returnFields.includes('screenshot')) {
      try {
        const shot = await browser.screenshot({
          format: 'base64',
          fullPage: opts.fullPageScreenshot,
        });
        if (typeof shot === 'object' && 'data' in shot) {
          result.screenshot = shot.data;
        }
      } catch {
        // Screenshot is best-effort too — DOM data already succeeded.
      }
    }

    timing.extractMs = now() - extractStart;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  timing.totalMs = now() - totalStart;
  return result;
}
