'use client';

import type { RunResult } from '@/lib/editor/code-runner';
import { Spinner } from '@primer/react';

interface CodeOutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  language: string;
}

export function CodeOutputPanel({ result, isRunning, language }: CodeOutputPanelProps) {
  const isRunnable = ['javascript', 'typescript'].includes(language.toLowerCase());

  return (
    <div style={{ background: 'var(--bgColor-inset)', padding: 12, borderTop: '1px solid var(--borderColor-muted)' }}>
      {isRunning && <Spinner size="small" aria-label="Running code" />}
      {!isRunning && !isRunnable && (
        <span style={{ color: 'var(--fgColor-muted)' }}>
          ▷ Run not available for {language} — use Submit to check your solution
        </span>
      )}
      {!isRunning && isRunnable && result && (
        <>
          {result.output.map((line, index) => (
            <pre key={`${line}-${index}`} style={{ margin: 0, fontFamily: 'var(--fontStack-monospace)' }}>
              {line}
            </pre>
          ))}
          {result.returnValue && (
            <pre style={{ margin: 0, fontFamily: 'var(--fontStack-monospace)' }}>{result.returnValue}</pre>
          )}
          {result.error && (
            <pre
              style={{ margin: 0, fontFamily: 'var(--fontStack-monospace)', color: 'var(--fgColor-danger)' }}
            >
              {result.error}
            </pre>
          )}
          {!result.output.length && !result.error && !result.returnValue && (
            <span style={{ color: 'var(--fgColor-muted)' }}>No output</span>
          )}
        </>
      )}
    </div>
  );
}
