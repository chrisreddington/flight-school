'use client';

import { Button, Stack, Textarea } from '@primer/react';
import { useState } from 'react';
import styles from './self-explanation-card.module.css';

interface SelfExplanationCardProps {
  challengeId: string;
  dateKey: string;
  onSkip: () => void;
  onSave: (text: string) => void;
}

export function SelfExplanationCard({
  challengeId,
  dateKey,
  onSkip,
  onSave,
}: SelfExplanationCardProps) {
  const [text, setText] = useState('');
  const trimmedText = text.trim();

  return (
    <div className={styles.card} data-challenge-id={challengeId} data-date-key={dateKey}>
      <h4 id="self-explanation-label" className={styles.title}>What did you learn?</h4>
      <p className={styles.subtitle}>Writing it down helps it stick. Takes 30 seconds.</p>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="e.g. I learned that... I'd do X differently because..."
        rows={3}
        aria-labelledby="self-explanation-label"
      />
      <Stack direction="horizontal" gap="condensed" justify="end">
        <Button
          variant="primary"
          size="small"
          onClick={() => onSave(trimmedText)}
          disabled={trimmedText.length === 0}
        >
          Save & Continue
        </Button>
        <Button variant="invisible" size="small" onClick={onSkip}>
          Skip
        </Button>
      </Stack>
    </div>
  );
}
