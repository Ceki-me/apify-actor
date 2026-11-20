import { describe, expect, it } from 'vitest';

import { normalizeUrls, mapLimit, buildRequestBody } from '../src/input.js';

describe('normalizeUrls', () => {
  it('trims and drops empty entries', () => {
    expect(normalizeUrls({ urls: [' https://a.com ', '', '  ', 'https://b.com'] })).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('rejects an empty list', () => {
    expect(() => normalizeUrls({ urls: [] })).toThrow('`urls` is empty');
  });

  it('rejects a missing list', () => {
    expect(() => normalizeUrls({} as never)).toThrow('`urls` is empty');
  });

  it('rejects an unparseable URL', () => {
    expect(() => normalizeUrls({ urls: ['not a url'] })).toThrow('Invalid URL');
  });

  it('rejects file:// — it would read the provider local disk', () => {
    expect(() => normalizeUrls({ urls: ['file:///etc/passwd'] })).toThrow('Unsupported URL scheme');
  });

  it('rejects data: for the same reason', () => {
    expect(() => normalizeUrls({ urls: ['data:text/html,hi'] })).toThrow('Unsupported URL scheme');
  });

  it('accepts http and https', () => {
    expect(normalizeUrls({ urls: ['http://a.com', 'https://b.com'] })).toHaveLength(2);
  });
});

describe('buildRequestBody', () => {
  it('sends only the url when nothing else is set', () => {
    expect(buildRequestBody('https://a.com', { urls: [] })).toEqual({ url: 'https://a.com' });
  });

  it('forwards every optional field that is present', () => {
    const body = buildRequestBody('https://a.com', {
      urls: [],
      browserId: 58164,
      waitUntil: 'selector',
      waitSelector: '#main',
      networkIdleMs: 800,
      timeoutSecs: 30,
      returnFields: ['html', 'screenshot'],
      fullPageScreenshot: true,
      solveChallenge: false,
    });

    expect(body).toEqual({
      url: 'https://a.com',
      browserId: 58164,
      waitUntil: 'selector',
      waitSelector: '#main',
      networkIdleMs: 800,
      timeoutSecs: 30,
      returnFields: ['html', 'screenshot'],
      fullPageScreenshot: true,
      solveChallenge: false,
    });
  });

  it('does not forward undefined fields', () => {
    const body = buildRequestBody('https://a.com', { urls: [], browserId: undefined });
    expect('browserId' in body).toBe(false);
  });

  it('forwards solveChallenge=false rather than dropping it', () => {
    // A falsy value is a real instruction here, not an absent one.
    const body = buildRequestBody('https://a.com', { urls: [], solveChallenge: false });
    expect(body.solveChallenge).toBe(false);
  });
});

describe('mapLimit', () => {
  it('preserves input order', async () => {
    const out = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it('handles a limit larger than the list', async () => {
    expect(await mapLimit([1, 2], 10, async (n) => n)).toEqual([1, 2]);
  });
});
