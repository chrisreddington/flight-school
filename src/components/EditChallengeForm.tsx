'use client';

import { PencilIcon } from '@primer/octicons-react';
import {
  Banner,
  Button,
  FormControl,
  Heading,
  Select,
  Spinner,
  Stack,
  TextInput,
  Textarea,
} from '@primer/react';
import { useCallback, useRef, useState } from 'react';

import type { DailyChallenge } from '@/lib/focus/types';

import styles from '../app/challenge/challenge.module.css';

interface ValidationErrors {
  title?: string;
  description?: string;
  language?: string;
}

interface EditChallengeFormProps {
  initialChallenge: DailyChallenge;
  onSave: (updated: DailyChallenge) => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
}

function validateChallenge(formData: DailyChallenge): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!formData.title?.trim()) errors.title = 'Title is required';
  else if (formData.title.length < 5) errors.title = 'Title must be at least 5 characters';

  if (!formData.description?.trim()) errors.description = 'Description is required';
  else if (formData.description.length < 20)
    errors.description = 'Description must be at least 20 characters';

  if (!formData.language?.trim()) errors.language = 'Language is required';

  return errors;
}

/**
 * Controlled edit form for a custom challenge. Owns validation, dirty-state
 * tracking, and submission UI; the page passes in load + persistence callbacks.
 */
export function EditChallengeForm({
  initialChallenge,
  onSave,
  onCancel,
}: EditChallengeFormProps) {
  const [formData, setFormData] = useState<DailyChallenge>({ ...initialChallenge });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const submitLockRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateField = useCallback(
    <K extends keyof DailyChallenge>(field: K, value: DailyChallenge[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (errors[field as keyof ValidationErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
      setSaveError(null);
    },
    [errors]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitLockRef.current) return;
      const validationErrors = validateChallenge(formData);
      setErrors(validationErrors);
      if (Object.keys(validationErrors).length > 0) return;

      submitLockRef.current = true;
      setIsSaving(true);
      setSaveError(null);
      try {
        const outcome = await onSave(formData);
        if (!outcome.success) {
          setSaveError(outcome.error ?? 'Failed to save changes.');
        }
      } catch {
        setSaveError('An error occurred while saving.');
      } finally {
        submitLockRef.current = false;
        setIsSaving(false);
      }
    },
    [formData, onSave]
  );

  return (
    <div className={styles.editFormContainer}>
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.editFormHeader}>
        <span className={styles.editIconAccent}>
          <PencilIcon size={24} />
        </span>
        <Heading as="h1">Edit Challenge</Heading>
      </Stack>

      {saveError && (
        <Banner variant="critical" title="Save failed" className={styles.editSaveErrorBanner}>
          {saveError}
        </Banner>
      )}

      <form onSubmit={handleSubmit}>
        <Stack direction="vertical" gap="normal">
          <FormControl required>
            <FormControl.Label>Title</FormControl.Label>
            <TextInput
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Challenge title"
              block
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title && (
              <FormControl.Validation variant="error">{errors.title}</FormControl.Validation>
            )}
          </FormControl>

          <FormControl required>
            <FormControl.Label>Description</FormControl.Label>
            <FormControl.Caption>
              Explain what you should build, including requirements and constraints.
            </FormControl.Caption>
            <Textarea
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Describe the challenge..."
              rows={6}
              resize="vertical"
              block
              aria-invalid={Boolean(errors.description)}
            />
            {errors.description && (
              <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
            )}
          </FormControl>

          <FormControl required>
            <FormControl.Label>Language</FormControl.Label>
            <TextInput
              value={formData.language}
              onChange={(e) => updateField('language', e.target.value.toLowerCase())}
              placeholder="e.g., typescript, python, javascript"
              block
              aria-invalid={Boolean(errors.language)}
            />
            {errors.language && (
              <FormControl.Validation variant="error">{errors.language}</FormControl.Validation>
            )}
          </FormControl>

          <FormControl>
            <FormControl.Label>Difficulty</FormControl.Label>
            <Select
              value={formData.difficulty}
              onChange={(e) =>
                updateField(
                  'difficulty',
                  e.target.value as 'beginner' | 'intermediate' | 'advanced'
                )
              }
              block
            >
              <Select.Option value="beginner">Beginner</Select.Option>
              <Select.Option value="intermediate">Intermediate</Select.Option>
              <Select.Option value="advanced">Advanced</Select.Option>
            </Select>
          </FormControl>

          <FormControl>
            <FormControl.Label>Estimated Time</FormControl.Label>
            <TextInput
              value={formData.estimatedTime || ''}
              onChange={(e) => updateField('estimatedTime', e.target.value)}
              placeholder="e.g., 30 minutes, 1 hour"
              block
            />
          </FormControl>

          <FormControl>
            <FormControl.Label>Why This Challenge?</FormControl.Label>
            <FormControl.Caption>
              List reasons why this challenge is valuable (one per line).
            </FormControl.Caption>
            <Textarea
              value={formData.whyThisChallenge?.join('\n') || ''}
              onChange={(e) =>
                updateField(
                  'whyThisChallenge',
                  e.target.value.split('\n').filter((line) => line.trim())
                )
              }
              placeholder="Learn X concept&#10;Practice Y pattern"
              rows={3}
              resize="vertical"
              block
            />
          </FormControl>

          <Stack direction="horizontal" gap="normal" justify="end" className={styles.editActionsFooter}>
            <Button variant="invisible" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Spinner size="small" /> Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </Stack>
        </Stack>
      </form>
    </div>
  );
}
