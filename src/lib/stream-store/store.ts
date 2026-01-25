/**
 * Global Stream Store
 *
 * Singleton store that manages AI streams independently of React component lifecycle.
 * Streams persist across navigation - components subscribe to updates when mounted.
 *
 * @example
 * ```typescript
 * // Start a stream (from any component)
 * const state = await streamStore.startStream({
 *   type: 'copilot',
 *   prompt: 'Hello',
 *   conversationId: 'thread-123',
 * });
 *
 * // Subscribe to updates (in a component)
 * useEffect(() => {
 *   return streamStore.subscribe('thread-123', (state) => {
 *     setContent(state.content);
 *   });
 * }, []);
 *
 * // Stop a stream (explicit user action)
 * streamStore.stopStream('thread-123');
 * ```
 */

import { logger } from '@/lib/logger';

import type {
  CopilotStreamRequest,
  EvaluationStreamRequest,
  StreamRequest,
  StreamServerMeta,
  StreamState,
  StreamStore,
  StreamSubscriber,
} from './types';

import type { ToolCall } from '@/hooks/use-copilot-stream/types';

const log = logger.withTag('streamStore');

/** Flush interval for streaming content (ms) */
const STREAMING_FLUSH_INTERVAL = 50;

/** How long to keep completed streams before cleanup (ms) */
const COMPLETED_STREAM_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Create initial stream state
 */
function createInitialState(id: string, abortController: AbortController): StreamState {
  return {
    id,
    status: 'pending',
    content: '',
    toolCalls: [],
    startedAt: performance.now(),
    abortController,
    flushTimer: null,
    streamingBuffer: '',
  };
}

/**
 * Global stream store implementation
 */
class StreamStoreImpl implements StreamStore {
  /** All stream states */
  private streams = new Map<string, StreamState>();
  
  /** Subscribers per stream ID */
  private subscribers = new Map<string, Set<StreamSubscriber>>();
  
  /** Global activity subscribers */
  private activitySubscribers = new Set<(activeIds: string[]) => void>();

  /** Notify subscribers of a stream update */
  private notifySubscribers(id: string, state: StreamState): void {
    const subs = this.subscribers.get(id);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(state);
        } catch (err) {
          log.error('Subscriber error:', err);
        }
      }
    }
  }

  /** Notify activity subscribers of active stream changes */
  private notifyActivitySubscribers(): void {
    const activeIds = this.getActiveStreamIds();
    for (const callback of this.activitySubscribers) {
      try {
        callback(activeIds);
      } catch (err) {
        log.error('Activity subscriber error:', err);
      }
    }
  }

  /** Update stream state and notify */
  private updateStream(id: string, update: Partial<StreamState>): void {
    const current = this.streams.get(id);
    if (current) {
      const updated = { ...current, ...update };
      this.streams.set(id, updated);
      this.notifySubscribers(id, updated);
    }
  }

  /** Schedule cleanup of completed stream */
  private scheduleCleanup(id: string): void {
    setTimeout(() => {
      const stream = this.streams.get(id);
      // Only clean up if still completed/error/aborted (not restarted)
      if (stream && ['completed', 'error', 'aborted'].includes(stream.status)) {
        this.streams.delete(id);
        this.subscribers.delete(id);
        log.debug(`Cleaned up stream: ${id}`);
      }
    }, COMPLETED_STREAM_TTL);
  }

  /** Flush streaming buffer to state */
  private flushBuffer(id: string): void {
    const stream = this.streams.get(id);
    if (stream && stream.streamingBuffer !== undefined) {
      this.updateStream(id, {
        content: stream.streamingBuffer,
        flushTimer: null,
      });
    }
  }

  /** Process a Copilot chat stream */
  private async processCopilotStream(request: CopilotStreamRequest): Promise<StreamState> {
    const { prompt, useGitHubTools, conversationId, learningMode, repos, onComplete, onUpdate } = request;
    const id = conversationId;

    // Check if already streaming
    if (this.isStreaming(id)) {
      log.warn(`Stream ${id} already active, returning existing state`);
      return this.streams.get(id)!;
    }

    const abortController = new AbortController();
    const state = createInitialState(id, abortController);
    this.streams.set(id, state);
    this.notifyActivitySubscribers();
    onUpdate?.(state);

    const startTime = performance.now();
    let clientFirstTokenMs: number | undefined;
    let pollingInterval: NodeJS.Timeout | null = null;

    try {
      // 1. Start background job
      const jobBody: Record<string, unknown> = {
        type: 'chat-response',
        input: {
          threadId: id,
          prompt,
          learningMode,
          useGitHubTools,
        },
      };

      if (repos && repos.length > 0) {
        jobBody.input = {
          ...(jobBody.input as Record<string, unknown>),
          repos: repos.map((r) => r.fullName),
        };
      }

      this.updateStream(id, { status: 'streaming' });
      onUpdate?.(this.streams.get(id)!);

      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobBody),
        signal: abortController.signal,
      });

      if (!jobRes.ok) {
        const err = await jobRes.json();
        throw new Error(err.error || 'Failed to start job');
      }

      const { jobId } = await jobRes.json();
      log.debug(`Started job ${jobId} for thread ${id}`);

      // Store jobId in state for cancellation
      this.updateStream(id, { jobId });

      // 2. Poll thread storage for updates
      const POLL_INTERVAL_MS = 300; // Poll every 300ms for smoother streaming
      let hasActionableItem = false;
      let toolCalls: ToolCall[] = [];
      let lastContent = '';

      // Use a Promise to wait for polling to complete
      return new Promise<StreamState>((resolve) => {
        // Handle abort signal
        const onAbort = async () => {
          const stream = this.streams.get(id);
          if (stream?.pollingInterval) {
            clearInterval(stream.pollingInterval);
          }

          const abortedState: Partial<StreamState> = {
            status: 'aborted',
            content: lastContent,
            completedAt: performance.now(),
            abortController: undefined,
            flushTimer: null,
            pollingInterval: null,
          };
          this.updateStream(id, abortedState);
          onUpdate?.(this.streams.get(id)!);
          this.notifyActivitySubscribers();
          this.scheduleCleanup(id);
          
          const abortedStream = this.streams.get(id)!;
          
          if (onComplete) {
            try {
              await onComplete(abortedStream);
            } catch (callbackErr) {
              log.error('onComplete callback error (abort):', callbackErr);
            }
          }
          
          resolve(abortedStream);
        };

        abortController.signal.addEventListener('abort', onAbort);

        const pollThread = async () => {
          // Check if aborted before making request
          if (abortController.signal.aborted) return;

          try {
            const res = await fetch(`/api/threads/storage`);
            if (!res.ok) return;

            const data = await res.json();
            const thread = data.threads.find((t: any) => t.id === id);
            if (!thread) return;

            // Find the streaming message (has cursor) or the most recent assistant message
            const streamingMsg = thread.messages.find((m: any) => 
              m.role === 'assistant' && m.id.startsWith('streaming-')
            );
            const latestMsg = streamingMsg || thread.messages.filter((m: any) => m.role === 'assistant').pop();

            if (latestMsg && latestMsg.content) {
              const content = latestMsg.content; // Keep cursor visible during streaming
              
              // Update if content has changed at all
              if (content !== lastContent) {
                if (clientFirstTokenMs === undefined && content.length > 0) {
                  clientFirstTokenMs = Math.round(performance.now() - startTime);
                }

                lastContent = content;
                
                // Extract tool calls and actionable flag
                if (latestMsg.toolCalls) {
                  toolCalls = latestMsg.toolCalls.map((name: string) => ({ name, args: {}, result: '' }));
                }
                if (latestMsg.hasActionableItem) {
                  hasActionableItem = true;
                }

                this.updateStream(id, {
                  content,
                  toolCalls,
                  hasActionableItem,
                });
                onUpdate?.(this.streams.get(id)!);
              }

              // Check if stream is complete (no cursor and no isStreaming flag)
              if (!thread.isStreaming && !latestMsg.content.includes(' ▊')) {
                // Stream complete - remove cursor from final content
                const finalContent = content.replace(' ▊', '');
                
                const stream = this.streams.get(id);
                if (stream?.pollingInterval) {
                  clearInterval(stream.pollingInterval);
                }
                abortController.signal.removeEventListener('abort', onAbort);

                const finalState: Partial<StreamState> = {
                  status: 'completed',
                  content: finalContent,
                  toolCalls,
                  hasActionableItem,
                  clientFirstTokenMs,
                  completedAt: performance.now(),
                  abortController: undefined,
                  flushTimer: null,
                  pollingInterval: null,
                };

                this.updateStream(id, finalState);
                onUpdate?.(this.streams.get(id)!);
                this.notifyActivitySubscribers();
                this.scheduleCleanup(id);

                const completedStream = this.streams.get(id)!;
                
                if (onComplete) {
                  try {
                    await onComplete(completedStream);
                  } catch (callbackErr) {
                    log.error('onComplete callback error:', callbackErr);
                  }
                }

                // Resolve the Promise when complete
                resolve(completedStream);
              }
            }
          } catch (err) {
            log.debug('Poll error (continuing):', err);
          }
        };

        // Start polling
        pollingInterval = setInterval(pollThread, POLL_INTERVAL_MS);
        
        // Store polling interval in state for cleanup
        this.updateStream(id, { pollingInterval });
        
        // Do initial poll immediately
        pollThread();
      });
    } catch (err) {
      const stream = this.streams.get(id);
      if (stream?.pollingInterval) {
        clearInterval(stream.pollingInterval);
      }

      if (err instanceof Error && err.name === 'AbortError') {
        const abortedState: Partial<StreamState> = {
          status: 'aborted',
          content: stream?.content || '',
          completedAt: performance.now(),
          abortController: undefined,
          flushTimer: null,
          pollingInterval: null,
        };
        this.updateStream(id, abortedState);
        onUpdate?.(this.streams.get(id)!);
        this.notifyActivitySubscribers();
        this.scheduleCleanup(id);
        
        const abortedStream = this.streams.get(id)!;
        
        if (onComplete) {
          try {
            await onComplete(abortedStream);
          } catch (callbackErr) {
            log.error('onComplete callback error (abort):', callbackErr);
          }
        }
        
        return abortedStream;
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorState: Partial<StreamState> = {
        status: 'error',
        error: errorMessage,
        content: stream?.content || '',
        completedAt: performance.now(),
        abortController: undefined,
        flushTimer: null,
        pollingInterval: null,
      };
      this.updateStream(id, errorState);
      onUpdate?.(this.streams.get(id)!);
      this.notifyActivitySubscribers();
      this.scheduleCleanup(id);
      
      const errorStream = this.streams.get(id)!;
      
      if (onComplete) {
        try {
          await onComplete(errorStream);
        } catch (callbackErr) {
          log.error('onComplete callback error (error):', callbackErr);
        }
      }

      return errorStream;
    }
  }

  /** Process an evaluation stream */
  private async processEvaluationStream(request: EvaluationStreamRequest): Promise<StreamState> {
    const { challenge, files, streamId } = request;
    const id = streamId;

    if (this.isStreaming(id)) {
      log.warn(`Stream ${id} already active, returning existing state`);
      return this.streams.get(id)!;
    }

    const abortController = new AbortController();
    const state = createInitialState(id, abortController);
    this.streams.set(id, state);
    this.notifyActivitySubscribers();

    try {
      this.updateStream(id, { status: 'streaming' });

      const response = await fetch('/api/challenge/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, files }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let streamedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'partial' || event.type === 'feedback-delta' || event.type === 'result') {
              if (event.type === 'feedback-delta') {
                streamedContent += event.content;
              }
              // Store the raw event data for the component to interpret
              const stream = this.streams.get(id);
              if (stream) {
                stream.streamingBuffer = JSON.stringify({
                  ...JSON.parse(stream.streamingBuffer || '{}'),
                  [event.type]: event,
                  feedbackContent: streamedContent,
                });
                if (stream.flushTimer === null) {
                  stream.flushTimer = setTimeout(() => this.flushBuffer(id), STREAMING_FLUSH_INTERVAL);
                }
              }
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      const stream = this.streams.get(id);
      if (stream?.flushTimer) {
        clearTimeout(stream.flushTimer);
        this.flushBuffer(id);
      }

      this.updateStream(id, {
        status: 'completed',
        completedAt: performance.now(),
        abortController: undefined,
        flushTimer: null,
      });
      this.notifyActivitySubscribers();
      this.scheduleCleanup(id);

      return this.streams.get(id)!;
    } catch (err) {
      const stream = this.streams.get(id);
      if (stream?.flushTimer) {
        clearTimeout(stream.flushTimer);
      }

      if (err instanceof Error && err.name === 'AbortError') {
        this.updateStream(id, {
          status: 'aborted',
          completedAt: performance.now(),
          abortController: undefined,
          flushTimer: null,
        });
        this.notifyActivitySubscribers();
        this.scheduleCleanup(id);
        return this.streams.get(id)!;
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.updateStream(id, {
        status: 'error',
        error: errorMessage,
        completedAt: performance.now(),
        abortController: undefined,
        flushTimer: null,
      });
      this.notifyActivitySubscribers();
      this.scheduleCleanup(id);

      return this.streams.get(id)!;
    }
  }

  // Public API

  async startStream(request: StreamRequest): Promise<StreamState> {
    if (request.type === 'copilot') {
      return this.processCopilotStream(request);
    } else if (request.type === 'evaluation') {
      return this.processEvaluationStream(request);
    }
    throw new Error(`Unknown stream type: ${(request as StreamRequest).type}`);
  }

  stopStream(id: string): void {
    const stream = this.streams.get(id);
    if (!stream) return;

    log.debug(`Stopping stream: ${id}`);

    // 1. Clear polling interval
    if (stream.pollingInterval) {
      clearInterval(stream.pollingInterval);
    }

    // 2. Cancel background job if exists
    if (stream.jobId) {
      fetch(`/api/jobs/${stream.jobId}`, { method: 'DELETE' })
        .catch(err => log.error(`Failed to cancel job ${stream.jobId}:`, err));
    }

    // 3. Abort controller (for the initial job creation request)
    if (stream.abortController) {
      stream.abortController.abort();
    }
  }

  getStream(id: string): StreamState | undefined {
    return this.streams.get(id);
  }

  isStreaming(id: string): boolean {
    const stream = this.streams.get(id);
    return stream?.status === 'pending' || stream?.status === 'streaming';
  }

  getActiveStreamIds(): string[] {
    const active: string[] = [];
    for (const [id, stream] of this.streams) {
      if (stream.status === 'pending' || stream.status === 'streaming') {
        active.push(id);
      }
    }
    return active;
  }

  subscribe(id: string, callback: StreamSubscriber): () => void {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id)!.add(callback);

    // Immediately notify with current state if exists
    const current = this.streams.get(id);
    if (current) {
      callback(current);
    }

    return () => {
      const subs = this.subscribers.get(id);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(id);
        }
      }
    };
  }

  subscribeToActivity(callback: (activeIds: string[]) => void): () => void {
    this.activitySubscribers.add(callback);
    
    // Immediately notify with current state
    callback(this.getActiveStreamIds());

    return () => {
      this.activitySubscribers.delete(callback);
    };
  }
}

/** Singleton stream store instance */
export const streamStore: StreamStore = new StreamStoreImpl();
