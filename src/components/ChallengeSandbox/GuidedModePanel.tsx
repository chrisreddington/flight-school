'use client';

import type { GuidedPlan } from '@/lib/copilot/guided-mode';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button, Label, Spinner } from '@primer/react';
import { useMemo, useState } from 'react';
import styles from './ChallengeSandbox.module.css';

interface GuidedModePanelProps {
  onClose: () => void;
  plan: GuidedPlan | null;
  isLoading: boolean;
}

export function GuidedModePanel({ onClose, plan, isLoading }: GuidedModePanelProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [showElaboration, setShowElaboration] = useState(false);

  const step = plan?.steps[currentStep];
  const badge = useMemo(() => {
    if (!step) return 'Guided';
    return step.scaffoldLevel === 'full' ? 'Guided' : step.scaffoldLevel === 'outline' ? 'Outline' : 'Independent';
  }, [step]);

  if (isLoading) {
    return (
      <div className={styles.guidedPanel}>
        <div className={styles.guidedPanelLoading}><Spinner size="small" /> Building your guided plan...</div>
      </div>
    );
  }

  if (!step || !plan) {
    return null;
  }

  const isLast = currentStep >= plan.steps.length - 1;

  return (
    <section className={styles.guidedPanel} aria-live="polite">
      <div className={styles.guidedPanelHeader}>
        <span className={styles.guidedStepText}>Step {currentStep + 1} of {plan.totalSteps}</span>
        <div className={styles.guidedHeaderActions}><Label size="small">{badge}</Label><Button size="small" variant="invisible" onClick={onClose}>Close</Button></div>
      </div>
      <h3 className={styles.guidedStepTitle}>{step.title}</h3>
      <div className={styles.guidedInstruction}><MarkdownContent content={step.instruction} /></div>
      <div className={styles.guidedReflectWrapper}>
        <Button size="small" variant="default" onClick={() => setShowElaboration((v) => !v)}>💭 Reflect: Why does this work?</Button>
      </div>
      {showElaboration && <div className={styles.guidedElaboration}>{step.elaborationPrompt}</div>}
      <div className={styles.guidedNav}>
        <Button size="small" variant="invisible" onClick={() => { setCurrentStep((v) => Math.max(0, v - 1)); setShowElaboration(false); }} disabled={currentStep === 0}>← Back</Button>
        {isLast ? (
          <Button size="small" variant="primary" onClick={onClose}>Try it now!</Button>
        ) : (
          <Button size="small" variant="primary" onClick={() => { setCurrentStep((v) => Math.min(plan.steps.length - 1, v + 1)); setShowElaboration(false); }}>Next Step →</Button>
        )}
      </div>
    </section>
  );
}

