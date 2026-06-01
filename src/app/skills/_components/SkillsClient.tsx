'use client';

import { InfoIcon, PlusIcon } from '@primer/octicons-react';
import { Banner, Button, Spinner, SplitPageLayout, Stack } from '@primer/react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { InlineCalibration } from '@/components/Dashboard/inline-calibration';
import { PageHeader } from '@/components/PageHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import type { SkillProfile } from '@/lib/skills/types';
import { formatDate } from '@/lib/utils/date-utils';

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
  } = useSkillsProfile({ initialProfile });

  const [showAddForm, setShowAddForm] = useState(false);

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
    <SplitPageLayout className={styles.layout}>
      <SplitPageLayout.Pane position={{ regular: 'start', narrow: 'end' }} aria-label="Skill profile sidebar">
        <SkillsSidebar profile={profile} onAddLearningPathSkill={handleAddLearningPathSkill} />
      </SplitPageLayout.Pane>

      <SplitPageLayout.Content>
        <PageHeader
          title="Your Skills"
          description="Calibrate your skill levels for personalized learning recommendations."
          actions={
            <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setShowAddForm(true)}>
              Add Skill
            </Button>
          }
        />

        <Stack direction="vertical" gap="normal">
          {loadError && <Banner title="Failed to load skill profile" description={loadError} variant="critical" />}

          {actionError && (
            <Banner
              title="Failed to save"
              description={actionError}
              variant="critical"
              onDismiss={() => setActionError(null)}
            />
          )}

          {/* The detected-skills calibration banner below already explains that
              skills come from GitHub activity, so this baseline explainer only
              shows when there is nothing to calibrate — never stacked beneath
              the calibration banner. */}
          {calibrationItems.length === 0 && (
            <div className={styles.infoBox}>
              <Stack direction="horizontal" align="start" gap="condensed">
                <InfoIcon size={16} className={styles.infoIcon} />
                <p className={styles.infoText}>
                  Skills are initially detected from your GitHub activity. You can adjust levels here to calibrate your
                  recommendations.
                </p>
              </Stack>
            </div>
          )}

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
              <p className={styles.lastUpdatedText}>Last updated: {formatDate(profile.lastUpdated)}</p>
            </div>
          )}
        </Stack>
      </SplitPageLayout.Content>
    </SplitPageLayout>
  );
}
