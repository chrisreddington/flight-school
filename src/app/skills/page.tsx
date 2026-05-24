'use client';

import { InfoIcon, PlusIcon } from '@primer/octicons-react';
import { Banner, Button, Heading, Spinner, Stack } from '@primer/react';
import { useCallback, useState } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { InlineCalibration } from '@/components/Dashboard/inline-calibration';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import layoutStyles from '@/styles/two-column-layout.module.css';

import { AddSkillForm } from './_components/AddSkillForm';
import { SkillsList } from './_components/SkillsList';
import { SkillsSidebar } from './_components/SkillsSidebar';
import styles from './profile-skills.module.css';
import { useSkillsProfile } from './use-skills-profile';

export default function SkillProfilePage() {
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
    handleAddSkill,
    handleClearAllData,
  } = useSkillsProfile();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useBreadcrumb('/skills', 'Skills', '/skills');

  const handleSubmitNewSkill = useCallback(async (name: string) => {
    await handleAddSkill(undefined, name);
    setShowAddForm(false);
  }, [handleAddSkill]);

  const handleAddLearningPathSkill = useCallback(
    (skillId: string, displayName: string) => {
      void handleAddSkill({ skillId, displayName });
    },
    [handleAddSkill],
  );

  if (isLoading) {
    return (
      <div className={layoutStyles.root}>
        <AppHeader />
        <main className={layoutStyles.main}>
          <aside className={layoutStyles.sidebar}>
            <div className={layoutStyles.sidebarCard}><Spinner size="medium" /></div>
          </aside>
          <div className={styles.content}>
            <Stack direction="horizontal" align="center" justify="center" gap="condensed">
              <Spinner size="medium" />
              <span>Loading skill profile...</span>
            </Stack>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={layoutStyles.root}>
      <AppHeader />

      <main className={layoutStyles.main}>
        <SkillsSidebar
          profile={profile}
          showResetConfirm={showResetConfirm}
          onResetConfirmChange={setShowResetConfirm}
          onClearAllData={handleClearAllData}
          onAddLearningPathSkill={handleAddLearningPathSkill}
        />

        <div className={styles.content}>
          {loadError && (
            <Banner title="Failed to load skill profile" description={loadError} variant="critical" />
          )}
          <Stack direction="vertical" gap="normal">
            <div className={styles.pageHeader}>
              <Stack direction="horizontal" align="center" justify="space-between">
                <div>
                  <Heading as="h1" className={styles.pageTitle}>Your Skills</Heading>
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
                  Skills are initially detected from your GitHub activity. You can adjust levels here
                  to calibrate your recommendations.
                </p>
              </Stack>
            </div>

            {calibrationItems.length > 0 && (
              <InlineCalibration
                items={calibrationItems}
                onItemsChange={handleCalibrationChange}
                showProfileLink={false}
              />
            )}

            {showAddForm && (
              <AddSkillForm
                onSubmit={handleSubmitNewSkill}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            <div className={styles.skillsSection}>
              <SkillsList
                profile={profile}
                onSkillChange={handleSkillChange}
                onRemoveSkill={handleRemoveSkill}
              />
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
    </div>
  );
}
