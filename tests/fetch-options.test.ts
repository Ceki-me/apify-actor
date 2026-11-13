import { describe, expect, it } from 'vitest';

import { normalizeOptions } from '../src/fetch.js';

describe('normalizeOptions', () => {
  it('applies defaults', () => {
    const opts = normalizeOptions({});
    expect(opts.waitUntil).toBe('load');
    expect(opts.returnFields).toEqual(['html']);
    expect(opts.timeoutSecs).toBe(60);
    expect(opts.fullPageScreenshot).toBe(false);
  });

  it('keeps explicit values', () => {
    const opts = normalizeOptions({
      waitUntil: 'selector',
      waitSelector: '#content',
      returnFields: ['html', 'cookies'],
      timeoutSecs: 30,
    });
    expect(opts.waitUntil).toBe('selector');
    expect(opts.waitSelector).toBe('#content');
    expect(opts.returnFields).toEqual(['html', 'cookies']);
    expect(opts.timeoutSecs).toBe(30);
  });

  it('degrades a selector wait with no selector to a load wait', () => {
    // Otherwise the run would block until the overall timeout, reporting a
    // failure the user cannot diagnose from the error text.
    const opts = normalizeOptions({ waitUntil: 'selector' });
    expect(opts.waitUntil).toBe('load');
  });

  it('restores the html default when an empty field list is given', () => {
    const opts = normalizeOptions({ returnFields: [] });
    expect(opts.returnFields).toEqual(['html']);
  });
});
