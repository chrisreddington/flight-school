'use client';

import type { ProfileResponse } from '@/app/api/profile/route';
import { DifficultyBadge } from '@/components/DifficultyBadge';
import {
    CopilotIcon,
    GitCommitIcon,
    GitPullRequestIcon,
    PersonIcon,
    PulseIcon,
    RepoIcon,
    SyncIcon
} from '@primer/octicons-react';
import {
    Banner,
    Heading,
    IconButton,
    Label,
    ProgressBar,
    RelativeTime,
    Spinner,
    Stack,
    Tooltip
} from '@primer/react';
import type { CSSProperties } from 'react';
import { memo } from 'react';
import styles from './Dashboard.module.css';

interface ProfileActivitySectionProps {
  profile: ProfileResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export const ProfileActivitySection = memo(function ProfileActivitySection({ profile, isLoading, onRefresh }: ProfileActivitySectionProps) {
  if (isLoading) {
    return (
      <section className={styles.card}>
        <Stack direction="horizontal" align="center" justify="space-between" className={styles.sectionHeader}>
          <Stack direction="horizontal" align="center" gap="condensed">
            <span className={styles.iconAccent}>
              <PersonIcon size={20} />
            </span>
            <Heading as="h3" className={styles.sectionTitle}>
              Your Profile &amp; Activity
            </Heading>
          </Stack>
        </Stack>
        
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: '3rem 0'
        }}>
          <Spinner size="small" />
        </div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className={styles.card}>
        <Stack direction="horizontal" align="center" justify="space-between" className={styles.sectionHeader}>
          <Stack direction="horizontal" align="center" gap="condensed">
            <span className={styles.iconAccent}>
              <PersonIcon size={20} />
            </span>
            <Heading as="h3" className={styles.sectionTitle}>
              Your Profile &amp; Activity
            </Heading>
          </Stack>
          <Tooltip text="Refresh data">
            <IconButton 
              icon={SyncIcon} 
              variant="invisible" 
              aria-label="Refresh profile data"
              onClick={onRefresh}
            />
          </Tooltip>
        </Stack>
        <Banner variant="warning" title="Couldn't load profile">
          Unable to connect to the Copilot SDK. Make sure the app is running with proper authentication.
        </Banner>
      </section>
    );
  }

  const isDemo = profile.meta?.aiEnabled === false;
  const { stats, user } = profile;
  const pastSevenDays = profile.pastSevenDays || { commits: 0, pullRequests: 0, reposUpdated: 0 };
  const recentActivity = (pastSevenDays as { recentActivity?: Array<{ description: string; repo: string; date: string }> }).recentActivity || [];

  return (
    <section className={styles.card}>
      {/* Header with refresh button */}
      <Stack direction="horizontal" align="center" justify="space-between" className={styles.sectionHeader}>
        <Stack direction="horizontal" align="center" gap="condensed">
          <span className={styles.iconAccent}>
            <PersonIcon size={20} />
          </span>
          <Heading as="h3" className={styles.sectionTitle}>
            Your Profile &amp; Activity
          </Heading>
          {isDemo && <Label size="small">Demo</Label>}
        </Stack>
        <Tooltip text="Refresh data">
          <IconButton 
            icon={SyncIcon} 
            variant="invisible" 
            aria-label="Refresh profile data"
            onClick={onRefresh}
          />
        </Tooltip>
      </Stack>

      {isDemo && (
        <Banner variant="upsell" title="Demo Mode" className={styles.demoBanner}>
          <CopilotIcon size={16} /> Using demo data. Connect via Copilot SDK for your real GitHub profile.
        </Banner>
      )}

      {/* Experience Level */}
      <div className={styles.experienceLevel}>
        <Stack direction="horizontal" align="center" justify="space-between">
          <span className={styles.experienceLabel}>Experience Level</span>
          <DifficultyBadge difficulty={stats.experienceLevel} showIcon />
        </Stack>
        <span className={styles.experienceYears}>
          {stats.yearsOnGitHub} year{stats.yearsOnGitHub !== 1 ? 's' : ''} on GitHub · {user.totalRepos} repos
        </span>
      </div>

      {/* Top Languages */}
      <div className={styles.languagesSection}>
        <span className={styles.languagesLabel}>Top Languages</span>
        <Stack direction="vertical" gap="condensed">
          {stats.topLanguages.map((lang) => (
            <div key={lang.name} className={styles.languageRow}>
              <Stack direction="horizontal" align="center" justify="space-between">
                <Stack direction="horizontal" align="center" gap="condensed">
                  <span
                    className={styles.languageDot}
                    style={{ backgroundColor: lang.color }}
                  />
                  <span className={styles.languageName}>{lang.name}</span>
                </Stack>
                <span className={styles.languagePercent}>{lang.percentage}%</span>
              </Stack>
              <ProgressBar
                progress={lang.percentage}
                barSize="small"
                style={{ '--progress-bar-bg': lang.color } as CSSProperties}
              />
            </div>
          ))}
        </Stack>
      </div>

      {/* Divider */}
      <div className={styles.cardDivider} />

      {/* Past 7 Days Section */}
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.subSectionHeader}>
        <span className={styles.iconSuccess}>
          <PulseIcon size={16} />
        </span>
        <span className={styles.subSectionTitle}>Past 7 Days</span>
      </Stack>

      <div className={styles.statsGrid}>
        <div className={styles.statItem}>
          <GitCommitIcon size={16} className={styles.statIcon} />
          <span className={styles.statValue}>{pastSevenDays.commits}</span>
          <span className={styles.statLabel}>Commits</span>
        </div>
        <div className={styles.statItem}>
          <GitPullRequestIcon size={16} className={styles.statIcon} />
          <span className={styles.statValue}>{pastSevenDays.pullRequests}</span>
          <span className={styles.statLabel}>PRs Opened</span>
        </div>
        <div className={styles.statItem}>
          <RepoIcon size={16} className={styles.statIcon} />
          <span className={styles.statValue}>{pastSevenDays.reposUpdated}</span>
          <span className={styles.statLabel}>Repos Active</span>
        </div>
      </div>

      {recentActivity.length > 0 && (
        <div className={styles.recentActivity}>
          <span className={styles.recentActivityLabel}>Recent Activity</span>
          <Stack direction="vertical" gap="condensed">
            {recentActivity.slice(0, 3).map((activity, idx) => (
              <div key={idx} className={styles.activityItem}>
                <Stack direction="horizontal" align="center" gap="condensed">
                  <span className={styles.activityDescription}>
                    {activity.description}
                  </span>
                  <span className={styles.activityRepo}>in {activity.repo}</span>
                </Stack>
                <RelativeTime date={new Date(activity.date)} className={styles.activityTime} />
              </div>
            ))}
          </Stack>
        </div>
      )}
    </section>
  );
});
