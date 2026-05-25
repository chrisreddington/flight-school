import { describe, expect, it } from 'vitest';

import { stripQueryString, extractPathname } from './url-sanitize';

describe('stripQueryString', () => {
  it('returns the URL unchanged when there is no query string', () => {
    expect(stripQueryString('https://example.com/foo')).toBe('https://example.com/foo');
  });

  it('removes the query string', () => {
    expect(stripQueryString('https://example.com/foo?token=secret')).toBe('https://example.com/foo');
  });

  it('removes both query and fragment', () => {
    expect(stripQueryString('https://example.com/foo?a=1#section')).toBe('https://example.com/foo');
  });

  it('handles relative URLs', () => {
    expect(stripQueryString('/api/profile?id=abc')).toBe('/api/profile');
  });

  it('returns the input unchanged when not parseable', () => {
    expect(stripQueryString('not-a-url')).toBe('not-a-url');
  });
});

describe('extractPathname', () => {
  it('returns relative paths unchanged', () => {
    expect(extractPathname('/api/profile')).toBe('/api/profile');
  });

  it('strips origin from absolute URLs', () => {
    expect(extractPathname('https://example.com/api/profile')).toBe('/api/profile');
  });

  it('returns root for origin-only URLs', () => {
    expect(extractPathname('https://example.com/')).toBe('/');
  });

  it('returns the input unchanged when not parseable', () => {
    expect(extractPathname('not-a-url')).toBe('not-a-url');
  });

  it('returns empty input unchanged', () => {
    expect(extractPathname('')).toBe('');
  });
});
