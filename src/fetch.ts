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
  /** Attempt to click through a Cloudflare interstitial when one appears. */
  solveChallenge: boolean;
}

const DEFAULT_OPTIONS: FetchOptions = {
  waitUntil: 'load',
  networkIdleMs: 500,
  timeoutSecs: 60,
  returnFields: ['html'],
  fullPageScreenshot: false,
  solveChallenge: true,
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
async function readStatus(browser: Browser, timeout = 15000): Promise<number | null> {
  try {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: {
        expression: 'performance.getEntriesByType("navigation")[0]?.responseStatus ?? null',
        returnByValue: true,
      },
    }, timeout)) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    const value = result?.value;
    // 0 is what Chrome reports for a document that never received a response
    // (error pages, aborted loads). Treat it as "unknown" rather than a status.
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readString(browser: Browser, expression: string, timeout = 15000): Promise<string | null> {
  try {
    const res = (await browser.send({
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }, timeout)) as Record<string, unknown>;
    const result = (res?.result as Record<string, unknown> | undefined) ?? res;
    const value = result?.value;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Detect a Cloudflare interstitial by its DOM signature.
 *
 * Checked against the live challenge page: the title is "Just a moment...",
 * the copy says "Humans only", and the Turnstile widget container is present
 * with a `cf-chl-widget-*` id. Matching on the widget id rather than the title
 * alone keeps this from firing on ordinary pages that mention Cloudflare.
 */
type PageState = 'ok' | 'challenge' | 'blocked';

/**
 * Classify the current page as a solvable challenge, a hard block, or neither.
 *
 * The distinction matters twice over. A solvable challenge has a Turnstile
 * widget and can be clicked through. A hard block ("Additional Verification
 * Required" plus a Ray ID) cannot — clicking around on it navigates to
 * Cloudflare's help pages, which is how a run once reported a successful fetch
 * of Indeed's troubleshooting article instead of its job listings.
 */
async function classifyPage(browser: Browser, timeout = 15000): Promise<PageState> {
  const value = await readString(
    browser,
    `(() => {
       const text = document.body ? document.body.innerText.slice(0, 800) : '';
       const title = document.title || '';

       // Hard block: Cloudflare refuses and offers no interactive widget.
       if (/additional verification required/i.test(text)) return 'blocked';
       if (/error 1020|access denied/i.test(text) && /ray id/i.test(text)) return 'blocked';

       const hasWidget = !!document.querySelector('[id^=cf-chl-widget]')
         || !!document.querySelector('iframe[src*="challenges.cloudflare.com"]');
       const interstitial = /just a moment|attention required|humans only|checking your browser|verify you are human/i
         .test(title + ' ' + text.slice(0, 400));

       return hasWidget && interstitial ? 'challenge' : 'ok';
     })()`,
    timeout,
  );

  if (value === 'challenge') return 'challenge';
  if (value === 'blocked') return 'blocked';
  return 'ok';
}

/**
 * Click through a Cloudflare interstitial.
 *
 * A managed/Turnstile challenge is satisfiable from a real browser — it is a
 * checkbox, not an unsolvable puzzle. What it does not do is resolve on its
 * own: waiting produces nothing, which is what an earlier probe measured and
 * mistook for "cannot be passed". The widget is centred horizontally at
 * roughly 42-46% of viewport height, so a small grid around that point is
 * enough without shipping a visual matcher.
 *
 * Returns true when the page navigated away from the challenge.
 */
async function solveChallenge(browser: Browser, deadline: number): Promise<boolean> {
  // Every call below is bounded: an unbounded getLayoutMetrics or click on a
  // stalled transport would hang past the caller's budget, which is exactly
  // how a probe once ran for minutes.
  const stepBudget = () => Math.max(1500, Math.min(8000, deadline - now()));

  const metrics = (await browser.send(
    { method: 'Page.getLayoutMetrics' },
    stepBudget(),
  ).catch(() => null)) as Record<string, unknown> | null;
  if (metrics === null) return false;
  const viewport =
    (metrics?.cssLayoutViewport as Record<string, unknown> | undefined) ??
    (metrics?.layoutViewport as Record<string, unknown> | undefined);
  const width = Number(viewport?.clientWidth ?? 1920);
  const height = Number(viewport?.clientHeight ?? 1080);

  const points: Array<[number, number]> = [
    [0.5, 0.42], [0.5, 0.44], [0.5, 0.46], [0.5, 0.4],
    [0.5, 0.48], [0.44, 0.44], [0.56, 0.44], [0.5, 0.38],
  ];

  for (const [fx, fy] of points) {
    // Leave room for the post-click wait and detection; starting a click we
    // cannot finish is worse than giving up.
    if (now() + 4000 >= deadline) return false;

    await withTimeout(
      stepBudget(),
      () => browser.click(Math.round(width * fx), Math.round(height * fy)),
      'challenge click',
    ).catch(() => {
      // A click outside any target is harmless; keep trying other points.
    });

    // Give the challenge a moment to re-evaluate before checking again.
    await new Promise((r) => setTimeout(r, 3500));

    if ((await classifyPage(browser, stepBudget())) !== 'challenge') return true;
  }

  return false;
}

/**
 * Fetch one URL. Never throws — a failure is reported as `ok: false` plus
 * `error`, so one bad URL does not abort a multi-URL run.
 */
async function fetchUrlInner(
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

    // `Page.navigate` can return before the new document commits — on a slow
    // host the renderer keeps serving the previous page. Extracting here would
    // silently return the DOM of whatever the tab showed before (observed:
    // zalando.de yielding leboncoin.fr markup). Wait for the document URL to
    // actually belong to the requested origin before touching the DOM.
    const targetHost = new URL(url).host;
    await withTimeout(
      Math.max(2000, deadline - now()),
      () => waitForExpression(
        browser,
        `(() => {
           try {
             const h = location.host;
             return h === ${JSON.stringify(targetHost)} || h.endsWith('.' + ${JSON.stringify(targetHost)});
           } catch { return false; }
         })()`,
        deadline,
      ),
      'commit',
    ).catch(() => {
      // Never committed: the extraction below reports the mismatch rather than
      // returning stale markup.
    });

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

    // A Cloudflare interstitial can appear before or instead of the requested
    // page. Solving it here means callers get content rather than a challenge
    // page, and the solve cost lands inside the same per-URL timeout.
    const pageState = await classifyPage(browser, Math.max(2000, Math.min(15000, deadline - now())));

    if (pageState === 'blocked') {
      // No widget to click: Cloudflare refused outright. Retrying in-place does
      // nothing, so report it rather than pretending content was retrieved.
      throw new Error('blocked by cloudflare (additional verification required)');
    }

    if (pageState === 'challenge') {
      if (!opts.solveChallenge) {
        throw new Error('cloudflare challenge present (solveChallenge disabled)');
      }
      const solved = await solveChallenge(browser, deadline);
      if (!solved) {
        throw new Error('cloudflare challenge not solved');
      }
      result.challengeSolved = true;
      // The challenge resolves into a fresh document; wait for it to settle
      // before extracting, otherwise the DOM is still the challenge shell.
      await withTimeout(
        Math.max(2000, deadline - now()),
        () => waitForNetworkIdle(browser, opts.networkIdleMs, deadline),
        'post-challenge wait',
      ).catch(() => {});
    }
    timing.waitMs = now() - waitStart;

    const extractStart = now();

    // Each read is a separate CDP round-trip over WebRTC. Without an explicit
    // per-call ceiling a single stalled call falls back to the SDK's 30s
    // default and the total blows past the caller's budget — observed at 180s
    // of extraction against a 90s timeout.
    const readBudget = () => Math.max(2000, Math.min(15000, deadline - now()));

    result.finalUrl = await readString(browser, 'location.href', readBudget());
    result.status = await readStatus(browser, readBudget());
    const title = await readString(browser, 'document.title', readBudget());
    if (title !== null) result.title = title;

    // A navigation that fails at the network level still resolves
    // `Page.navigate`: Chrome swaps in its own error document and the CDP call
    // returns normally. Without this check a timed-out host is indistinguishable
    // from a successful fetch, and the caller is billed for an error page.
    //
    // Two independent signals, because either can be absent:
    //   - the internal `chrome-error://` URL, set when the main frame failed
    //   - the error-page marker Chrome renders into the DOM
    const navError = await readString(
      browser,
      `(() => {
         const url = location.href;
         if (url.startsWith('chrome-error://')) return 'navigation failed (chrome-error)';
         if (document.querySelector('#main-frame-error, .neterror')) {
           return 'navigation failed (net error page)';
         }
         return null;
       })()`,
    );
    if (navError !== null) {
      throw new Error(navError);
    }

    // Clicking around a challenge page can navigate somewhere else entirely --
    // Indeed's block page links to a Cloudflare troubleshooting article on its
    // own host, which then looks like a successful fetch of the requested URL.
    // The document must still belong to the requested registrable domain.
    if (result.finalUrl) {
      try {
        const root = (h: string) => h.split('.').slice(-2).join('.');
        const wantRoot = root(targetHost);
        const gotRoot = root(new URL(result.finalUrl).host);
        if (gotRoot !== wantRoot) {
          throw new Error(`redirected off-target to ${new URL(result.finalUrl).host}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('redirected off-target')) throw err;
        // Unparseable finalUrl: leave it to the caller to inspect.
      }
    }

    if (opts.returnFields.includes('html')) {
      const html = await readString(
        browser,
        'document.documentElement.outerHTML',
        // The DOM can be megabytes; allow up to the remaining budget, capped.
        Math.max(5000, Math.min(30000, deadline - now())),
      );
      if (html !== null) result.html = html;
      // An empty document is never a successful fetch — the tab lost its
      // document (context destroyed, crash, or a challenge that reloaded it).
      if (!html) {
        throw new Error('empty document');
      }

      // A near-empty shell is the other failure shape: the response arrived
      // but the page never rendered. Booking.com answers HTTP 202 with ~1.2 KB
      // of scaffolding while its bot check decides, and that is indistinguishable
      // from a real page by status alone. Treating it as content ships an empty
      // document and bills the caller for it.
      const TEXT_ONLY_MIN = 200;
      const textContent = await readString(
        browser,
        `(() => {
           const b = document.body;
           if (!b) return '';
           return (b.innerText || '').trim();
         })()`,
        Math.max(2000, Math.min(10000, deadline - now())),
      );
      if (html.length < 2000 && (textContent ?? '').length < TEXT_ONLY_MIN) {
        throw new Error(
          `empty shell: ${html.length} bytes of markup, ${(textContent ?? '').length} chars of text`
        );
      }
    }

    if (opts.returnFields.includes('cookies')) {
      try {
        const cookieRes = await browser.send({ method: 'Network.getAllCookies' }, readBudget());
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

/**
 * Fetch one URL with a hard wall-clock ceiling.
 *
 * Every inner step is bounded individually, but CDP calls can still queue
 * behind each other inside the transport, so the sum of the bounds is not a
 * bound on the total. This wrapper makes the caller's `timeoutSecs` an actual
 * ceiling: when it fires, the result is reported as a failure even though the
 * inner promise keeps running and is discarded.
 */
export async function fetchUrl(
  browser: Browser,
  url: string,
  opts: FetchOptions,
  sessionMeta: { scheduleId: number; sessionId: string; resumed: boolean } | null,
): Promise<FetchResult> {
  const started = now();
  // A little headroom over the per-URL budget so inner waits can report their
  // own, more specific errors before the outer guard fires.
  const hardLimit = opts.timeoutSecs * 1000 + 5000;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchUrlInner(browser, url, opts, sessionMeta),
      new Promise<FetchResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            url,
            ok: false,
            status: null,
            finalUrl: null,
            timing: { sessionMs: 0, navigateMs: 0, waitMs: 0, extractMs: 0, totalMs: now() - started },
            browser: sessionMeta,
            error: `hard timeout after ${hardLimit}ms`,
          });
        }, hardLimit);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
