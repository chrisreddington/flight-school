'use client';

import type { RunResult } from '@/lib/editor/code-runner';
import { Spinner } from '@primer/react';
import styles from './CodeOutputPanel.module.css';

interface CodeOutputPanelProps {
  result: RunResult | null;
  isRunning: boolean;
  language: string;
}

export function CodeOutputPanel({ result, isRunning, language }: CodeOutputPanelProps) {
  const isRunnable = ['javascript', 'typescript'].includes(language.toLowerCase());

  return (
    <div className={styles.container}>
      {isRunning && <Spinner size="small" aria-label="Running code" />}
      {!isRunning && !isRunnable && (
        <span className="fgColor-muted">
          ▷ Run not available for {language} — use Submit to check your solution
        </span>
      )}
      {!isRunning && isRunnable && result && (
        <>
          {result.output.map((line, index) => (
            <pre key={`${line}-${index}`} className={styles.outputLine}>
              {line}
            </pre>
          ))}
          {result.returnValue && (
            <pre className={styles.outputLine}>{result.returnValue}</pre>
          )}
          {result.error && (
            <pre className={styles.errorLine}>
              {result.error}
            </pre>
          )}
          {!result.output.length && !result.error && !result.returnValue && (
            <span className="fgColor-muted">No output</span>
          )}
        </>
      )}
    </div>
  );
}
