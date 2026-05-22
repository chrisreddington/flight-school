import { StopIcon } from '@primer/octicons-react';
import { Button, SkeletonBox, Spinner, Stack } from '@primer/react';
import styles from './FocusItem.module.css';

type SkippingCardProps = {
  id: string;
  itemType: 'goal' | 'topic' | 'challenge';
  skeletonLines: 2 | 3;
  onStop?: (id: string) => void;
};

export function SkippingCard({ id, itemType, skeletonLines, onStop }: SkippingCardProps) {
  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" align="center" justify="space-between">
          <Stack direction="horizontal" align="center" gap="condensed">
            <Spinner size="small" />
            <span className={styles.loadingText}>Generating new {itemType}...</span>
          </Stack>
          {onStop && (
            <Button
              variant="danger"
              size="small"
              onClick={() => onStop(id)}
              leadingVisual={StopIcon}
              aria-label={`Stop generating ${itemType}`}
            >
              Stop
            </Button>
          )}
        </Stack>
        <SkeletonBox data-testid="skipping-card-skeleton" height="24px" width="70%" />
        <SkeletonBox data-testid="skipping-card-skeleton" height="16px" width="100%" />
        {skeletonLines === 3 && (
          <SkeletonBox data-testid="skipping-card-skeleton" height="16px" width="90%" />
        )}
      </Stack>
    </div>
  );
}
