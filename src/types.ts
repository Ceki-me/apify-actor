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
   * Which browser pool slot to use. Omitted means "any free worker".
   * Pinning is useful when the same warmed profile must serve every URL.
   */
  browserId?: number;

  /**
   * Wait strategy after navigation resolves:
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
   * Attempt to click through a Cloudflare interstitial when one appears.
   * Defaults to true. Disable for targets where poking the page is unwanted.
   */
  solveChallenge?: boolean;

  /** How many URLs to have in flight at once. Defaults to 4. */
  concurrency?: number;
}

export interface FetchTiming {
  /** Time the request spent waiting for a free worker. */
  queueMs: number;
  /** Time spent navigating until the load event. */
  navigateMs: number;
  /** Time spent in the post-load wait strategy. */
  waitMs: number;
  /** Time spent extracting the requested fields. */
  extractMs: number;
  /** Wall-clock total for this URL. */
  totalMs: number;
}

export interface FetchResponse {
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
  /** True when a Cloudflare interstitial was passed before extraction. */
  challengeSolved?: boolean;
  timing: FetchTiming;
  /** Which pool slot served this URL. Never exposes a session id. */
  worker: {
    id: number;
    browserId: number;
    reacquired: boolean;
  } | null;
  error?: string;
}
