'use client';

/**
 * Edit Custom Challenge Page
 *
 * Page for editing custom challenges that are in the queue.
 * Only custom challenges (isCustom: true) can be edited.
 */

import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import type { DailyChallenge } from '@/lib/focus/types';
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
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import styles from '../../challenge.module.css';

/**
 * Validation errors for the challenge form.
 */
interface ValidationErrors {
  title?: string;
  description?: string;
  language?: string;
}

/**
 * Edit custom challenge page component.
 */
export default function EditChallengePage() {
  const params = useParams();
  const router = useRouter();
  const challengeId = params.id as string;

  const { getById, updateChallenge } = useCustomChallengeQueue(null);

  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [formData, setFormData] = useState<DailyChallenge | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Register this page in breadcrumb history
  useBreadcrumb(`/challenge/edit/${challengeId}`, 'Edit Challenge', `/challenge/edit/${challengeId}`);

  // Load challenge on mount
  useEffect(() => {
    (async () => {
      const loaded = await getById(challengeId);
      if (loaded) {
        setChallenge(loaded);
        setFormData({ ...loaded });
      }
      setIsLoading(false);
    })();
  }, [challengeId, getById]);

  /**
   * Update a form field.
   */
  const updateField = useCallback(
    <K extends keyof DailyChallenge>(field: K, value: DailyChallenge[K]) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
      // Clear error when field is edited
      if (errors[field as keyof ValidationErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
      setSaveError(null);
    },
    [errors]
  );

  /**
   * Validate the form.
   */
  const validate = useCallback((): boolean => {
    if (!formData) return false;

    const newErrors: ValidationErrors = {};

    if (!formData.title?.trim()) {
      newErrors.title = 'Title is required';
    } else if (formData.title.length < 5) {
      newErrors.title = 'Title must be at least 5 characters';
    }

    if (!formData.description?.trim()) {
      newErrors.description = 'Description is required';
    } else if (formData.description.length < 20) {
      newErrors.description = 'Description must be at least 20 characters';
    }

    if (!formData.language?.trim()) {
      newErrors.language = 'Language is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  /**
   * Handle form submission.
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData || !validate()) return;

      setIsSaving(true);
      setSaveError(null);

      try {
        const success = await updateChallenge(challengeId, formData);
        if (success) {
          router.push('/');
        } else {
          setSaveError('Failed to save changes. The challenge may no longer exist.');
        }
      } catch {
        setSaveError('An error occurred while saving.');
      } finally {
        setIsSaving(false);
      }
    },
    [formData, validate, updateChallenge, challengeId, router]
  );

  /**
   * Handle cancel - go back.
   */
  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            minHeight: '400px'
          }}>
            <Spinner size="medium" />
          </div>
        </main>
      </div>
    );
  }

  // Challenge not found
  if (!challenge || !formData) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <Banner variant="critical" title="Challenge not found">
            This challenge doesn&apos;t exist or has already been completed.
          </Banner>
          <Button onClick={() => router.push('/')} style={{ marginTop: '16px' }}>
            Back to Dashboard
          </Button>
        </main>
      </div>
    );
  }

  // Not a custom challenge
  if (!challenge.isCustom) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <Banner variant="warning" title="Cannot edit this challenge">
            Only custom challenges can be edited. AI-generated daily challenges cannot be modified.
          </Banner>
          <Button onClick={() => router.push('/')} style={{ marginTop: '16px' }}>
            Back to Dashboard
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <div style={{ maxWidth: '700px', margin: '0 auto', padding: '24px' }}>
          {/* Header */}
          <Stack direction="horizontal" align="center" gap="condensed" style={{ marginBottom: '24px' }}>
            <span style={{ color: 'var(--fgColor-accent)' }}>
              <PencilIcon size={24} />
            </span>
            <Heading as="h1">Edit Challenge</Heading>
          </Stack>

          {saveError && (
            <Banner variant="critical" title="Save failed" style={{ marginBottom: '16px' }}>
              {saveError}
            </Banner>
          )}

          <form onSubmit={handleSubmit}>
            <Stack direction="vertical" gap="normal">
              {/* Title */}
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
                  <FormControl.Validation variant="error">
                    {errors.title}
                  </FormControl.Validation>
                )}
              </FormControl>

              {/* Description */}
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
                  <FormControl.Validation variant="error">
                    {errors.description}
                  </FormControl.Validation>
                )}
              </FormControl>

              {/* Language */}
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
                  <FormControl.Validation variant="error">
                    {errors.language}
                  </FormControl.Validation>
                )}
              </FormControl>

              {/* Difficulty */}
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

              {/* Estimated Time */}
              <FormControl>
                <FormControl.Label>Estimated Time</FormControl.Label>
                <TextInput
                  value={formData.estimatedTime || ''}
                  onChange={(e) => updateField('estimatedTime', e.target.value)}
                  placeholder="e.g., 30 minutes, 1 hour"
                  block
                />
              </FormControl>

              {/* Why This Challenge */}
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

              {/* Actions */}
              <Stack direction="horizontal" gap="normal" justify="end" style={{ marginTop: '16px' }}>
                <Button variant="invisible" onClick={handleCancel} disabled={isSaving}>
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
      </main>
    </div>
  );
}
