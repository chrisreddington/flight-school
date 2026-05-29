import { describe, expect, it } from 'vitest';
import { toolSummary } from './tool-summary';

describe('toolSummary', () => {
  it('summarises github.search_code with repo + query', () => {
    const result = toolSummary('search_code', {
      owner: 'chrisreddington',
      repo: 'flight-school',
      q: 'auth',
    });
    expect(result.iconKind).toBe('search');
    expect(result.summary).toContain('Searching code');
    expect(result.summary).toContain('`chrisreddington/flight-school`');
    expect(result.summary).toContain('`auth`');
  });

  it('strips github./mcp. namespace prefixes', () => {
    const a = toolSummary('github.get_file_contents', {
      owner: 'foo',
      repo: 'bar',
      path: 'src/index.ts',
    });
    const b = toolSummary('mcp.get_file_contents', {
      owner: 'foo',
      repo: 'bar',
      path: 'src/index.ts',
    });
    expect(a.summary).toBe(b.summary);
    expect(a.summary).toBe('Reading `src/index.ts` from `foo/bar`');
  });

  it('summarises list_commits with repo', () => {
    const result = toolSummary('list_commits', { owner: 'foo', repo: 'bar' });
    expect(result.iconKind).toBe('commit');
    expect(result.summary).toBe('Listing commits on `foo/bar`');
  });

  it('summarises read_file alias and falls back gracefully when path missing', () => {
    const result = toolSummary('read_file', { foo: 'bar' });
    expect(result.summary).toBe('Reading file');
  });

  it('summarises search_repositories with query', () => {
    const result = toolSummary('search_repositories', { query: 'react hooks' });
    expect(result.summary).toBe('Searching repositories for `react hooks`');
  });

  it('summarises get_pull_request with repo + number', () => {
    const result = toolSummary('get_pull_request', {
      owner: 'foo',
      repo: 'bar',
      pull_number: '42',
    });
    expect(result.iconKind).toBe('pull-request');
    expect(result.summary).toBe('Reading PR #42 on `foo/bar`');
  });

  it('falls back to bare tool name for unknown tools', () => {
    const result = toolSummary('mystery_tool', { anything: 1 });
    expect(result.iconKind).toBe('tool');
    expect(result.summary).toBe('Running `mystery_tool`');
  });

  it('handles missing args without throwing', () => {
    expect(() => toolSummary('search_code')).not.toThrow();
    const result = toolSummary('search_code');
    expect(result.summary).toBe('Searching code');
  });

  it('extracts repo from q:"repo:owner/name" search syntax', () => {
    const result = toolSummary('search_code', { q: 'repo:foo/bar auth' });
    expect(result.summary).toContain('`foo/bar`');
  });
});
