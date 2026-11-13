import { describe, expect, it, vi } from 'vitest';

import { fetchUrl, normalizeOptions } from '../src/fetch.js';
import type { Browser } from '@ceki/sdk';

/** A Browser stub whose CDP calls never resolve — the transport has stalled. */
function hangingBrowser(): Browser {
  return {
    navigate: vi.fn(() => new Promise(() => {})),
    send: vi.fn(() => new Promise(() => {})),
    click: vi.fn(() => new Promise(() => {})),
    screenshot: vi.fn(() => new Promise(() => {})),
  } as unknown as Browser;
}

describe('fetchUrl deadline enforcement', () => {
  it('fails fast when navigation stalls', async () => {
    const opts = normalizeOptions({ timeoutSecs: 1 });
    const started = Date.now();

    const result = await fetchUrl(hangingBrowser(), 'https://example.com', opts, null);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    // The inner navigation guard should fire first and name the step.
    expect(result.error).toMatch(/navigate/);
    // Never fall back to the transport's 30s default.
    expect(elapsed).toBeLessThan(9000);
  }, 15000);

  it('reports a bounded failure when every step stalls', async () => {
    // A browser that resolves navigate but hangs on every subsequent CDP call
    // exercises the wrapper: individual steps are bounded, but their sum is not.
    const browser = {
      navigate: vi.fn(async () => ({ url: 'https://example.com' })),
      send: vi.fn(() => new Promise(() => {})),
      click: vi.fn(() => new Promise(() => {})),
      screenshot: vi.fn(() => new Promise(() => {})),
    } as unknown as Browser;

    const started = Date.now();
    const result = await fetchUrl(browser, 'https://example.com', normalizeOptions({ timeoutSecs: 1 }), null);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // Budget + headroom, never unbounded.
    expect(elapsed).toBeLessThan(12000);
    expect(result.timing.totalMs).toBeGreaterThan(0);
  }, 20000);
});
