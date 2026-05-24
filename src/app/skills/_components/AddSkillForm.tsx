'use client';

import { Button, FormControl, Stack, TextInput } from '@primer/react';
import { useCallback, useState } from 'react';

import styles from '../profile-skills.module.css';

interface AddSkillFormProps {
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}

/** Controlled "add skill by name" inline form used at the top of the skills list. */
export function AddSkillForm({ onSubmit, onCancel }: AddSkillFormProps) {
  const [name, setName] = useState('');

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onSubmit(trimmed);
    setName('');
  }, [name, onSubmit]);

  return (
    <div className={styles.addSkillForm}>
      <FormControl>
        <FormControl.Label>Skill Name</FormControl.Label>
        <Stack direction="horizontal" gap="condensed">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., TypeScript, React, Docker"
            aria-label="New skill name"
          />
          <Button onClick={submit} disabled={!name.trim()}>Add</Button>
          <Button variant="invisible" onClick={onCancel}>Cancel</Button>
        </Stack>
      </FormControl>
    </div>
  );
}
