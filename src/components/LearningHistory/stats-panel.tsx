import { ActivitySummary, RecentActivityList, StreakCard } from '@/components/Insights';
import type { LearningInsights } from '@/lib/focus/analytics';
import { Banner, Spinner, Stack } from '@primer/react';
import insightsStyles from '@/components/Insights/Insights.module.css';
import styles from './LearningHistory.module.css';

interface StatsPanelProps {
  loadError: string | null;
  isLoading: boolean;
  hasNoInsightsHistory: boolean;
  insights: LearningInsights | null;
  totalGoalsCompleted: number;
}

export function StatsPanel({
  loadError,
  isLoading,
  hasNoInsightsHistory,
  insights,
  totalGoalsCompleted,
}: StatsPanelProps) {
  if (isLoading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="medium" />
        <span>Loading stats...</span>
      </div>
    );
  }

  if (hasNoInsightsHistory || !insights) {
    return (
      <>
        {loadError && <Banner title="Failed to load history" description={loadError} variant="critical" />}
        <Banner
          title="No stats yet"
          description="Start exploring topics and completing challenges to see your stats here."
          variant="info"
          hideTitle
        />
      </>
    );
  }

  return (
    <>
      {loadError && <Banner title="Failed to load history" description={loadError} variant="critical" />}
      <Stack direction="vertical" gap="normal" className={styles.statsTabContent}>
        <div className={styles.statsGrid}>
          <StreakCard currentStreak={insights.currentStreak} longestStreak={insights.longestStreak} />
          <ActivitySummary
            totalChallengesCompleted={insights.totalChallengesCompleted}
            totalTopicsExplored={insights.totalTopicsExplored}
            totalGoalsCompleted={totalGoalsCompleted}
          />
        </div>

        {insights.totalChallengesCompleted > 0 && (
          <div className={styles.statsCard}>
            <h2 className={styles.statsCardHeading}>Challenges by Difficulty</h2>
            <div className={styles.difficultyList}>
              <DifficultyRow
                difficulty="Beginner"
                count={insights.challengesByDifficulty.beginner}
                total={insights.totalChallengesCompleted}
              />
              <DifficultyRow
                difficulty="Intermediate"
                count={insights.challengesByDifficulty.intermediate}
                total={insights.totalChallengesCompleted}
              />
              <DifficultyRow
                difficulty="Advanced"
                count={insights.challengesByDifficulty.advanced}
                total={insights.totalChallengesCompleted}
              />
            </div>
          </div>
        )}

        {insights.totalChallengesCompleted > 0 && Object.keys(insights.challengesByLanguage).length > 0 && (
          <div className={styles.statsCard}>
            <h2 className={styles.statsCardHeading}>Challenges by Language</h2>
            <div className={styles.languageList}>
              {Object.entries(insights.challengesByLanguage)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([language, count]) => (
                  <div key={language} className={styles.languageRow}>
                    <span className={styles.languageName}>{language}</span>
                    <span className={styles.languageCount}>{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        <RecentActivityList activities={insights.recentActivity} />
      </Stack>
    </>
  );
}

function DifficultyRow({ difficulty, count, total }: { difficulty: string; count: number; total: number }) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className={insightsStyles.difficultyRow}>
      <div className={insightsStyles.difficultyHeader}>
        <span className={insightsStyles.difficultyName}>{difficulty}</span>
        <span className={insightsStyles.difficultyStats}>
          {count} ({percentage}%)
        </span>
      </div>
      <div className={insightsStyles.difficultyProgressBar}>
        <div
          className={`${insightsStyles.difficultyProgressFill} ${getDifficultyClass(difficulty)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function getDifficultyClass(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case 'beginner':
      return insightsStyles.difficultyProgressBeginner;
    case 'intermediate':
      return insightsStyles.difficultyProgressIntermediate;
    case 'advanced':
      return insightsStyles.difficultyProgressAdvanced;
    default:
      return insightsStyles.difficultyProgressBeginner;
  }
}
