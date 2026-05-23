import { describe, expect, it } from 'vitest';

import { stripQueryString } from './url-sanitize';

describe('stripQueryString', () => {
  it('returns the URL unchanged when there is no query string', () => {
    expect(stripQueryString('https://example.com/foo')).toBe('https://example.com/foo');
  });

  it('removes the query string', () => {
    expect(stripQueryString('https://example.com/foo?token=secret')).toBe(
      'https://example.com/foo',
    );
  });

  it('removes both query and fragment', () => {
    expect(stripQueryString('https://example.com/foo?a=1#section')).toBe(
      'https://example.com/foo',
    );
  });

  it('handles relative URLs', () => {
    expect(stripQueryString('/api/profile?id=abc')).toBe('/api/profile');
  });

  it('returns the input unchanged when not parseable', () => {
    expect(stripQueryString('not-a-url')).toBe('not-a-url');
  });
});
