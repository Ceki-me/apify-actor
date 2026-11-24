/**
 * Run outcome: did this run deliver anything, and should it exit as a failure?
 *
 * Kept separate from main.ts so the decision is testable without booting the
 * Actor runtime. The rule is small but the failure mode it prevents is not:
 * an Actor that retrieves nothing used to exit 0, which made the Store page
 * show a green run, made the dataset non-empty (one error record per URL), and
 * hid the breakage from the platform's own daily check — so the first person
 * to notice was a paying user.
 */
import type { FetchResponse } from './types.js';

export interface RunOutcome {
  total: number;
  ok: number;
  failed: number;
  /**
   * True when at least one page was delivered. Partial success is a success:
   * the caller pays only for what arrived, and one unreachable URL is the
   * target's answer rather than a fault of ours.
   */
  delivered: boolean;
  /** First error message, for the failure reason. Null when everything worked. */
  firstError: string | null;
}

export function summariseRun(results: FetchResponse[]): RunOutcome {
  const ok = results.filter((r) => r.ok === true).length;
  const firstError = results.find((r) => typeof r.error === 'string' && r.error !== '')?.error ?? null;

  return {
    total: results.length,
    ok,
    failed: results.length - ok,
    delivered: ok > 0,
    firstError,
  };
}

/**
 * Should the run exit non-zero?
 *
 * Only when nothing was delivered. A run with zero URLs never reaches here —
 * normalizeUrls rejects an empty list before any work starts, so that is a
 * startup failure and is handled by the top-level catch.
 */
export function shouldFailRun(outcome: RunOutcome): boolean {
  return !outcome.delivered;
}
