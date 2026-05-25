'use client';

import { Button, FormControl, Stack, TextInput } from '@primer/react';
import { useActionState, useEffect, useRef } from 'react';

import { addSkillAction, type AddSkillState } from '../actions';
import styles from '../profile-skills.module.css';

interface AddSkillFormProps {
  /** Called after the Server Action resolves successfully so the parent can refresh / close. */
  onSuccess: () => void;
  onCancel: () => void;
}

const INITIAL_STATE: AddSkillState = { ok: false };

/**
 * Inline form that submits a new manual skill via `addSkillAction`.
 * Pending state, validation errors, and revalidation are all driven by
 * `useActionState` + the Server Action — no client-side hook required.
 */
export function AddSkillForm({ onSuccess, onCancel }: AddSkillFormProps) {
  const [state, formAction, isPending] = useActionState(addSkillAction, INITIAL_STATE);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) {
      if (inputRef.current) inputRef.current.value = '';
      onSuccess();
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className={styles.addSkillForm}>
      <FormControl>
        <FormControl.Label>Skill Name</FormControl.Label>
        <Stack direction="horizontal" gap="condensed">
          <TextInput
            ref={inputRef}
            name="name"
            defaultValue=""
            placeholder="e.g., TypeScript, React, Docker"
            aria-label="New skill name"
            disabled={isPending}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Adding…' : 'Add'}
          </Button>
          <Button type="button" variant="invisible" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        </Stack>
        {state.error && <FormControl.Validation variant="error">{state.error}</FormControl.Validation>}
      </FormControl>
    </form>
  );
}
