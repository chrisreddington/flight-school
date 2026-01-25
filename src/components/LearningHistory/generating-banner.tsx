/**
 * GeneratingBanner Component
 *
 * Compact banner with jump links shown while items are being generated.
 */

'use client';

import { Spinner } from '@primer/react';
import { memo } from 'react';
import styles from './LearningHistory.module.css';

interface GeneratingBannerProps {
  topicIds: Set<string>;
  challengeIds: Set<string>;
  goalIds: Set<string>;
}

/** Compact generating banner with jump links */
export const GeneratingBanner = memo(function GeneratingBanner({ 
  topicIds, 
  challengeIds, 
  goalIds 
}: GeneratingBannerProps) {
  const total = topicIds.size + challengeIds.size + goalIds.size;
  if (total === 0) return null;
  
  const scrollToItem = (id: string) => {
    const element = document.querySelector(`[data-item-id="${id}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect
      element.classList.add(styles.highlightItem);
      setTimeout(() => element.classList.remove(styles.highlightItem), 2000);
    }
  };
  
  // Convert Sets to arrays for rendering
  const topicIdList = Array.from(topicIds);
  const challengeIdList = Array.from(challengeIds);
  const goalIdList = Array.from(goalIds);
  
  return (
    <div className={styles.generatingBanner}>
      <Spinner size="small" />
      <span className={styles.generatingText}>
        Generating {total} item{total > 1 ? 's' : ''}...
      </span>
      <span className={styles.generatingJumpLinks}>
        {topicIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Topic {topicIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
        {challengeIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Challenge {challengeIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
        {goalIdList.map((id, index) => (
          <button 
            key={id}
            className={styles.jumpLink} 
            onClick={() => scrollToItem(id)}
            type="button"
          >
            Goal {goalIdList.length > 1 ? index + 1 : ''}
          </button>
        ))}
      </span>
    </div>
  );
});
