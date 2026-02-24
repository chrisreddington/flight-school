'use client';

import type { GuidedPlan } from '@/lib/copilot/guided-mode';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button, Label, Spinner } from '@primer/react';
import { useEffect, useMemo, useState } from 'react';
import styles from './ChallengeSandbox.module.css';

interface GuidedModePanelProps {
  challenge: { title: string; description: string; language: string; difficulty: string };
  onClose: () => void;
}

const fallbackPlan: GuidedPlan = {
  steps: [
    { stepNumber: 1, title: 'Understand the problem', instruction: 'Identify inputs, outputs, and one edge case before coding.', scaffoldLevel: 'full', elaborationPrompt: 'Why does identifying constraints early improve solution quality?' },
    { stepNumber: 2, title: 'Outline your approach', instruction: 'Write a short approach in plain language, then convert it into code steps.', scaffoldLevel: 'outline', elaborationPrompt: 'Why does turning ideas into an outline reduce cognitive load while coding?' },
    { stepNumber: 3, title: 'Implement and test', instruction: 'Code your solution, then verify with a normal case and an edge case.', scaffoldLevel: 'goal', elaborationPrompt: 'Why do targeted tests reveal whether your reasoning actually works?' },
  ],
  totalSteps: 3,
};

export function GuidedModePanel({ challenge, onClose }: GuidedModePanelProps) {
  const [plan, setPlan] = useState<GuidedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [showElaboration, setShowElaboration] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/guided-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeTitle: challenge.title,
            challengeDescription: challenge.description,
            challengeLanguage: challenge.language,
            challengeDifficulty: challenge.difficulty,
          }),
        });
        const data = (await response.json()) as GuidedPlan;
        if (mounted) setPlan(response.ok ? data : fallbackPlan);
      } catch {
        if (mounted) setPlan(fallbackPlan);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [challenge]);

  const step = plan?.steps[currentStep];
  const badge = useMemo(() => {
    if (!step) return 'Guided';
    return step.scaffoldLevel === 'full' ? 'Guided' : step.scaffoldLevel === 'outline' ? 'Outline' : 'Independent';
  }, [step]);

  if (loading) {
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
