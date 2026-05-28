'use client';

import { InfoIcon, PlusIcon } from '@primer/octicons-react';
import { Banner, Button, Heading, Spinner, Stack } from '@primer/react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { InlineCalibration } from '@/components/Dashboard/inline-calibration';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import type { SkillProfile } from '@/lib/skills/types';
import layoutStyles from '@/styles/two-column-layout.module.css';

import { AddSkillForm } from './AddSkillForm';
import styles from '../profile-skills.module.css';
import { SkillsList } from './SkillsList';
import { SkillsSidebar } from './SkillsSidebar';
import { useSkillsProfile } from '../use-skills-profile';

interface SkillsClientProps {
  /** Server-rendered profile so the page can paint without an HTTP round-trip. */
  initialProfile: SkillProfile;
}

/**
 * Interactive shell for the `/skills` route. The Server Component
 * (`src/app/skills/page.tsx`) reads the user's profile from disk and hands
 * it down; this component owns every interaction (calibration, add/remove
 * skill, reset) and re-fetches as needed.
 */
export function SkillsClient({ initialProfile }: SkillsClientProps) {
  const router = useRouter();
  const {
    profile,
    isLoading,
    loadError,
    actionError,
    setActionError,
    calibrationItems,
    handleCalibrationChange,
    handleSkillChange,
    handleRemoveSkill,
    handleClearAllData,
  } = useSkillsProfile({ initialProfile });

  const [showAddForm, setShowAddForm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useBreadcrumb('/skills', 'Skills', '/skills');

  const handleSuccessfulAdd = useCallback(() => {
    // Server Action wrote to disk + revalidated the route; refresh the RSC
    // payload so the parent page re-reads the canonical profile.
    setShowAddForm(false);
    router.refresh();
  }, [router]);

  const handleAddLearningPathSkill = useCallback(
    (skillId: string, displayName: string) => {
      void (async () => {
        const formData = new FormData();
        formData.set('name', displayName);
        const { addSkillAction } = await import('../actions');
        await addSkillAction({ ok: false }, formData);
        router.refresh();
      })();
    },
    [router],
  );

  return (
    <main className={layoutStyles.main}>
      <SkillsSidebar
        profile={profile}
        showResetConfirm={showResetConfirm}
        onResetConfirmChange={setShowResetConfirm}
        onClearAllData={handleClearAllData}
        onAddLearningPathSkill={handleAddLearningPathSkill}
      />

      <div className={styles.content}>
        {loadError && <Banner title="Failed to load skill profile" description={loadError} variant="critical" />}
        <Stack direction="vertical" gap="normal">
          <div className={styles.pageHeader}>
            <Stack direction="horizontal" align="center" justify="space-between">
              <div>
                <Heading as="h1" className={styles.pageTitle}>
                  Your Skills
                </Heading>
                <p className={styles.pageDescription}>
                  Calibrate your skill levels for personalized learning recommendations.
                </p>
              </div>
              <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setShowAddForm(true)}>
                Add Skill
              </Button>
            </Stack>
          </div>

          {actionError && (
            <Banner
              title="Failed to save"
              description={actionError}
              variant="critical"
              onDismiss={() => setActionError(null)}
            />
          )}

          <div className={styles.infoBox}>
            <Stack direction="horizontal" align="start" gap="condensed">
              <InfoIcon size={16} className={styles.infoIcon} />
              <p className={styles.infoText}>
                Skills are initially detected from your GitHub activity. You can adjust levels here to calibrate your
                recommendations.
              </p>
            </Stack>
          </div>

          {isLoading && (
            <Stack direction="horizontal" align="center" gap="condensed">
              <Spinner size="small" />
              <span>Loading calibration suggestions…</span>
            </Stack>
          )}

          <section id="skill-suggestions-panel">
            {calibrationItems.length > 0 && (
              <InlineCalibration
                items={calibrationItems}
                onItemsChange={handleCalibrationChange}
                showProfileLink={false}
              />
            )}
          </section>

          {showAddForm && <AddSkillForm onSuccess={handleSuccessfulAdd} onCancel={() => setShowAddForm(false)} />}

          <div className={styles.skillsSection}>
            <SkillsList profile={profile} onSkillChange={handleSkillChange} onRemoveSkill={handleRemoveSkill} />
          </div>

          {profile?.lastUpdated && (
            <div className={styles.lastUpdated}>
              <p className={styles.lastUpdatedText}>
                Last updated: {new Date(profile.lastUpdated).toLocaleDateString()}
              </p>
            </div>
          )}
        </Stack>
      </div>
    </main>
  );
}
