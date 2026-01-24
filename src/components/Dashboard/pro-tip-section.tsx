'use client';

import { useDebugMode } from '@/contexts/debug-context';
import { StarIcon } from '@primer/octicons-react';
import { Stack } from '@primer/react';
import { memo } from 'react';
import styles from './Dashboard.module.css';

export const ProTipSection = memo(function ProTipSection() {
  const { isDebugMode } = useDebugMode();

  // Only show Pro Tip when debug mode is enabled
  if (!isDebugMode) {
    return null;
  }

  return (
    <section className={styles.proTipCard}>
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.proTipHeader}>
        <span className={styles.iconAttention}>
          <StarIcon size={16} />
        </span>
        <span className={styles.proTipTitle}>Pro Tip</span>
      </Stack>
      <p className={styles.proTipContent}>
        Press{' '}
        <kbd className={styles.kbd}>⌘</kbd>
        {' + '}
        <kbd className={styles.kbd}>Shift</kbd>
        {' + '}
        <kbd className={styles.kbd}>A</kbd>
        {' '}to open the AI Activity Panel and see Copilot&apos;s thought process in real-time.
      </p>
    </section>
  );
});
