/// <reference lib="webworker" />

import ts from 'typescript';

interface RunRequest {
  code: string;
}

interface RunResult {
  output: string[];
  error?: string;
  returnValue?: string;
}

const MAX_OUTPUT_LINES = 50;
const EXECUTION_TIMEOUT_MS = 5000;

function serialize(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

self.addEventListener('message', (event: MessageEvent<RunRequest>) => {
  const { code } = event.data;
  const output: string[] = [];
  let isComplete = false;

  const pushOutput = (...args: unknown[]) => {
    if (output.length >= MAX_OUTPUT_LINES) {
      return;
    }
    output.push(args.map(serialize).join(' '));
  };

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const restoreConsole = () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };

  const finish = (result: RunResult) => {
    if (isComplete) {
      return;
    }

    isComplete = true;
    clearTimeout(timeoutId);
    restoreConsole();
    self.postMessage(result);
  };

  console.log = (...args: unknown[]) => pushOutput(...args);
  console.warn = (...args: unknown[]) => pushOutput(...args);
  console.error = (...args: unknown[]) => pushOutput(...args);

  const timeoutId = setTimeout(() => {
    finish({
      output,
      error: 'Execution timed out after 5 seconds.',
    });
    self.close();
  }, EXECUTION_TIMEOUT_MS);

  try {
    // Transpile TypeScript to CommonJS JavaScript before eval.
    // eval() runs in script mode — `export` and type annotations are syntax errors without this.
    const { outputText } = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ESNext,
        esModuleInterop: true,
        strict: false,
      },
    });

    // Provide CommonJS globals so transpiled `exports.foo = ...` doesn't throw.
    const exports: Record<string, unknown> = {};
    const cjsModule = { exports };
    const value = eval(`(function(exports, module) { ${outputText} })`)(exports, cjsModule);
    finish({
      output,
      returnValue: value === undefined ? undefined : serialize(value),
    });
  } catch (error) {
    finish({
      output,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
