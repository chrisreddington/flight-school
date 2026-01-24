'use client';

import { Heading, SkeletonBox } from '@primer/react';
import { memo } from 'react';
import styles from './Dashboard.module.css';
import { getGreeting } from './dashboard-helpers';

interface WelcomeSectionProps {
  displayName: string;
  isLoading?: boolean;
}

export const WelcomeSection = memo(function WelcomeSection({ displayName, isLoading = false }: WelcomeSectionProps) {
  const showName = displayName !== 'Developer';
  
  return (
    <div className={styles.welcomeSection}>
      <Heading as="h2" className={styles.welcomeHeading}>
        {getGreeting()},{' '}
        {isLoading || !showName ? (
          <SkeletonBox height="1.2em" width="80px" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
        ) : (
          displayName
        )}! 👋
      </Heading>
      <p className={styles.welcomeSubtext}>
        Ready to level up your skills? Here&apos;s what&apos;s lined up for you today.
      </p>
    </div>
  );
});
