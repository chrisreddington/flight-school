import { beforeEach, describe, expect, it } from 'vitest';
import { chatStreamStore, TERMINAL_SEQ } from './chat-stream-store';

beforeEach(() => {
  chatStreamStore.__resetForTests();
});

describe('chatStreamStore initial state', () => {
  it('returns an empty snapshot before any register or apply', () => {
    expect(chatStreamStore.getSnapshot().size).toBe(0);
  });
});

describe('register', () => {
  it('creates a record with threadId + assistantMessageId', () => {
    chatStreamStore.register('j1', 't1', 'asst-1');
    const rec = chatStreamStore.getByJobId('j1');
    expect(rec).toMatchObject({
      jobId: 'j1',
      threadId: 't1',
      assistantMessageId: 'asst-1',
      content: '',
      lastSeq: 0,
    });
    expect(rec?.toolEvents).toEqual([]);
  });

  it('is idempotent: re-registering refreshes ids but preserves buffered content', () => {
    chatStreamStore.register('j1', 't1', 'asst-old');
    chatStreamStore.applyDelta('j1', 'hello', 1);
    chatStreamStore.register('j1', 't1', 'asst-new');
    const rec = chatStreamStore.getByJobId('j1');
    expect(rec?.content).toBe('hello');
    expect(rec?.assistantMessageId).toBe('asst-new');
    expect(rec?.lastSeq).toBe(1);
  });
});

describe('applyDelta', () => {
  it('accumulates content and bumps lastSeq', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyDelta('j1', 'hello ', 1);
    chatStreamStore.applyDelta('j1', 'world', 2);
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('hello world');
    expect(chatStreamStore.getByJobId('j1')?.lastSeq).toBe(2);
  });

  it('drops frames whose seq <= lastSeq (idempotent)', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyDelta('j1', 'hello', 5);
    chatStreamStore.applyDelta('j1', ' replay', 5);
    chatStreamStore.applyDelta('j1', ' older', 3);
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('hello');
    expect(chatStreamStore.getByJobId('j1')?.lastSeq).toBe(5);
  });
});

describe('applyToolStart / applyToolComplete', () => {
  it('appends a running tool event', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyToolStart('j1', { toolCallId: 'tc-1', name: 'foo', args: { x: 1 } }, 1);
    const rec = chatStreamStore.getByJobId('j1')!;
    expect(rec.toolEvents).toHaveLength(1);
    expect(rec.toolEvents[0]).toMatchObject({ id: 'tc-1', name: 'foo', status: 'running' });
  });

  it('updates a matching tool event on complete', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyToolStart('j1', { toolCallId: 'tc-1', name: 'foo', args: {} }, 1);
    chatStreamStore.applyToolComplete(
      'j1',
      { toolCallId: 'tc-1', name: 'foo', result: { ok: true }, durationMs: 42 },
      2,
    );
    const rec = chatStreamStore.getByJobId('j1')!;
    expect(rec.toolEvents).toHaveLength(1);
    expect(rec.toolEvents[0]).toMatchObject({ id: 'tc-1', status: 'complete', durationMs: 42 });
    expect(rec.toolEvents[0].result).toBe('{"ok":true}');
  });
});

describe('applySnapshot', () => {
  it('replaces content + toolEvents + hasActionableItem authoritatively', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyDelta('j1', 'partial', 1);
    chatStreamStore.applySnapshot('j1', {
      content: 'whole',
      toolEvents: [{ id: 'x', name: 'y', status: 'complete' }],
      hasActionableItem: true,
      seq: 2,
    });
    const rec = chatStreamStore.getByJobId('j1')!;
    expect(rec.content).toBe('whole');
    expect(rec.hasActionableItem).toBe(true);
    expect(rec.toolEvents).toHaveLength(1);
  });

  it('drops snapshots whose seq <= lastSeq', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyDelta('j1', 'a', 10);
    chatStreamStore.applySnapshot('j1', {
      content: 'OLD',
      toolEvents: [],
      hasActionableItem: false,
      seq: 5,
    });
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('a');
  });

  it('TERMINAL_SEQ sentinel locks the record against further apply*', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applySnapshot('j1', {
      content: 'final',
      toolEvents: [],
      hasActionableItem: false,
      seq: TERMINAL_SEQ,
    });
    chatStreamStore.applyDelta('j1', ' nope', 9_999_999);
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('final');
  });
});

describe('defensive apply-before-register', () => {
  it('creates an implicit record so events are not lost', () => {
    chatStreamStore.applyDelta('j1', 'orphan', 1);
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('orphan');
  });
});

describe('evict', () => {
  it('removes the record', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.applyDelta('j1', 'x', 1);
    chatStreamStore.evict('j1');
    expect(chatStreamStore.getByJobId('j1')).toBeNull();
  });
});

describe('lookup helpers', () => {
  it('getByThreadId returns null when no record matches', () => {
    expect(chatStreamStore.getByThreadId('nope')).toBeNull();
  });

  it('getByThreadId returns the matching record', () => {
    chatStreamStore.register('j1', 't1', 'a');
    expect(chatStreamStore.getByThreadId('t1')?.jobId).toBe('j1');
  });
});

describe('snapshot identity', () => {
  it('ref-swaps the snapshot on every mutation', () => {
    chatStreamStore.register('j1', 't1', 'a');
    const s1 = chatStreamStore.getSnapshot();
    chatStreamStore.applyDelta('j1', 'x', 1);
    const s2 = chatStreamStore.getSnapshot();
    expect(s1).not.toBe(s2);
  });
});

describe('multi-job isolation', () => {
  it('keeps records for different jobIds independent', () => {
    chatStreamStore.register('j1', 't1', 'a');
    chatStreamStore.register('j2', 't2', 'b');
    chatStreamStore.applyDelta('j1', 'X', 1);
    chatStreamStore.applyDelta('j2', 'Y', 1);
    expect(chatStreamStore.getByJobId('j1')?.content).toBe('X');
    expect(chatStreamStore.getByJobId('j2')?.content).toBe('Y');
  });
});
