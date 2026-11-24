import { describe, expect, it } from 'vitest';

import { shouldFailRun, summariseRun } from '../src/outcome.js';
import type { FetchResponse } from '../src/types.js';

function page(overrides: Partial<FetchResponse> = {}): FetchResponse {
  return {
    url: 'https://example.com',
    ok: true,
    status: 200,
    finalUrl: 'https://example.com/',
    html: '<html></html>',
    timing: { queueMs: 0, navigateMs: 1, waitMs: 0, extractMs: 1, totalMs: 2 },
    worker: { id: 0, browserId: 43664, reacquired: false },
    ...overrides,
  };
}

function failed(error: string): FetchResponse {
  return page({ ok: false, status: null, finalUrl: null, html: undefined, error });
}

describe('summariseRun', () => {
  it('counts delivered pages and failures', () => {
    const outcome = summariseRun([page(), page(), failed('boom'), failed('bang')]);
    expect(outcome.total).toBe(4);
    expect(outcome.ok).toBe(2);
    expect(outcome.failed).toBe(2);
    expect(outcome.delivered).toBe(true);
  });

  it('reports the first error, not the last', () => {
    const outcome = summariseRun([failed('first'), failed('second')]);
    expect(outcome.firstError).toBe('first');
  });

  it('marks a run with no delivered page as not delivered', () => {
    const outcome = summariseRun([failed('navigate timed out after 30000ms')]);
    expect(outcome.delivered).toBe(false);
    expect(outcome.ok).toBe(0);
  });

  it('treats a single delivered page among failures as delivered', () => {
    // Partial success is not a failure: the caller is charged only for what
    // arrived, and one dead URL says nothing about the service.
    expect(summariseRun([failed('dead'), page()]).delivered).toBe(true);
  });
});

describe('shouldFailRun', () => {
  it('fails when nothing was retrieved', () => {
    // The regression this guards: a run where every URL failed used to exit 0,
    // so the Store showed green and the platform's daily check passed while
    // the Actor returned nothing at all.
    expect(shouldFailRun(summariseRun([failed('navigate timed out after 30000ms')]))).toBe(true);
  });

  it('does not fail when at least one page arrived', () => {
    expect(shouldFailRun(summariseRun([page(), failed('dead')]))).toBe(false);
  });

  it('does not fail when everything worked', () => {
    expect(shouldFailRun(summariseRun([page(), page()]))).toBe(false);
  });

  it('fails an empty result set — no URLs ran, nothing was delivered', () => {
    // normalizeUrls rejects an empty list before this point, but a future caller
    // reaching here with nothing must not be reported as success.
    expect(shouldFailRun(summariseRun([]))).toBe(true);
  });
});
