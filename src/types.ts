/**
 * Input/output contract for the Ceki fetch actor.
 *
 * The shape mirrors the Actor input schema in `.actor/input_schema.json`.
 * Keep the two in sync — the schema is what users see in Apify Console.
 */

/** What to extract from the page. Ordering is irrelevant; each name maps to one field. */
export type ReturnField = 'html' | 'cookies' | 'screenshot';

export interface ActorInput {
  /** Pages to fetch, one dataset item each. */
  urls: string[];

  /**
   * Which rented browser to drive. The browser must be online and rentable by
   * this Ceki account. Defaults to the actor's configured browser.
   */
  browserId?: number;

  /**
   * Wait strategy after `Page.navigate` resolves:
   * - `load`        — return as soon as the load event fired
   * - `networkidle` — additionally wait until no network activity for `networkIdleMs`
   * - `selector`    — additionally wait until `waitSelector` matches
   */
  waitUntil?: 'load' | 'networkidle' | 'selector';

  /** CSS selector to wait for when `waitUntil === 'selector'`. */
  waitSelector?: string;

  /** Quiet window used by `networkidle`. */
  networkIdleMs?: number;

  /** Upper bound for the whole per-URL operation (navigate + wait + extract). */
  timeoutSecs?: number;

  /** Fields to collect. Defaults to `['html']`. */
  returnFields?: ReturnField[];

  /** Capture the full scrollable page instead of the viewport. */
  fullPageScreenshot?: boolean;

  /**
   * Keep the browser session alive after the run so the next run lands on the
   * same warmed profile. Set false only for one-shot runs that should not
   * leave a session behind.
   */
  keepSession?: boolean;
}

export interface FetchTiming {
  /** Time spent acquiring (or resuming) the browser session. */
  sessionMs: number;
  /** Time spent in `Page.navigate` until the load event. */
  navigateMs: number;
  /** Time spent in the post-load wait strategy. */
  waitMs: number;
  /** Time spent extracting the requested fields. */
  extractMs: number;
  /** Wall-clock total for this URL. */
  totalMs: number;
}

export interface FetchResult {
  url: string;
  ok: boolean;
  /** HTTP status of the main document, when observable. */
  status: number | null;
  finalUrl: string | null;
  title?: string;
  html?: string;
  cookies?: Array<Record<string, unknown>>;
  /** Base64-encoded PNG. */
  screenshot?: string;
  timing: FetchTiming;
  /** Which browser served this URL and whether the session was reused. */
  browser: {
    scheduleId: number;
    sessionId: string;
    resumed: boolean;
  } | null;
  error?: string;
}
