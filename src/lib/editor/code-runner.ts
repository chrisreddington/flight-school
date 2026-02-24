export interface RunResult {
  output: string[];
  error?: string;
  returnValue?: string;
}

const FALLBACK_TIMEOUT_MS = 6000;

export function runCode(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    if (typeof Worker === 'undefined') {
      resolve({
        output: [],
        error: 'Code execution is not supported in this environment.',
      });
      return;
    }

    const worker = new Worker(new URL('./code-runner.worker.ts', import.meta.url));
    let isResolved = false;

    const finalize = (result: RunResult) => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      clearTimeout(timeoutId);
      worker.terminate();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finalize({
        output: [],
        error: 'Execution timed out after 6 seconds.',
      });
    }, FALLBACK_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<RunResult>) => {
      finalize(event.data);
    };

    worker.onerror = (event: ErrorEvent) => {
      finalize({
        output: [],
        error: event.message || 'Failed to execute code in worker.',
      });
    };

    worker.postMessage({ code });
  });
}
