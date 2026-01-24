'use client';

/**
 * Quick Templates Component
 *
 * Provides quick-start templates for common challenge types.
 * Uses button elements for keyboard accessibility (AC10.1).
 *
 * @see SPEC-006 S7 for quick template requirements
 */

import {
  BeakerIcon,
  CodeIcon,
  DatabaseIcon,
  GitBranchIcon,
  GlobeIcon,
  ZapIcon,
} from '@primer/octicons-react';
import { Button, Heading, Stack } from '@primer/react';
import { useCallback } from 'react';
import styles from './ChallengeAuthoring.module.css';

/**
 * Template definition.
 */
interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Initial prompt to seed the conversation */
  initialPrompt: string;
  /** Suggested language (optional) */
  language?: string;
  /** Suggested difficulty (optional) */
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Available templates.
 */
const TEMPLATES: Template[] = [
  {
    id: 'algorithm',
    name: 'Algorithm Challenge',
    description: 'Implement a classic algorithm or data structure',
    icon: CodeIcon,
    initialPrompt: 'I want to create an algorithm challenge to practice problem-solving skills.',
    difficulty: 'intermediate',
  },
  {
    id: 'testing',
    name: 'Testing Practice',
    description: 'Write tests for existing code or practice TDD',
    icon: BeakerIcon,
    initialPrompt: 'I want to create a testing challenge to practice writing unit tests.',
    difficulty: 'intermediate',
  },
  {
    id: 'refactoring',
    name: 'Refactoring Exercise',
    description: 'Improve code quality and apply best practices',
    icon: GitBranchIcon,
    initialPrompt: 'I want to create a refactoring challenge to practice code improvement.',
    difficulty: 'advanced',
  },
  {
    id: 'data',
    name: 'Data Manipulation',
    description: 'Transform, filter, or aggregate data',
    icon: DatabaseIcon,
    initialPrompt: 'I want to create a data manipulation challenge working with arrays or objects.',
    difficulty: 'beginner',
  },
  {
    id: 'api',
    name: 'API Integration',
    description: 'Work with REST APIs or async operations',
    icon: GlobeIcon,
    initialPrompt: 'I want to create an API challenge to practice async programming.',
    difficulty: 'intermediate',
  },
  {
    id: 'performance',
    name: 'Performance Optimization',
    description: 'Optimize code for speed or memory',
    icon: ZapIcon,
    initialPrompt: 'I want to create a performance challenge to practice optimization.',
    difficulty: 'advanced',
  },
];

/**
 * Template selection result.
 */
export interface TemplateSelection {
  name: string;
  description: string;
  initialPrompt?: string;
  language?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Props for the {@link QuickTemplates} component.
 */
export interface QuickTemplatesProps {
  /** Callback when a template is selected */
  onSelect: (template: TemplateSelection) => void;
  /** Callback when templates are skipped */
  onSkip: () => void;
}

/**
 * Quick templates grid for starting challenge authoring.
 *
 * @example
 * ```tsx
 * <QuickTemplates
 *   onSelect={(template) => startChatWith(template.initialPrompt)}
 *   onSkip={() => startEmptyChat()}
 * />
 * ```
 */
export function QuickTemplates({ onSelect, onSkip }: QuickTemplatesProps) {
  const handleTemplateClick = useCallback(
    (template: Template) => {
      onSelect({
        name: template.name,
        description: template.description,
        initialPrompt: template.initialPrompt,
        language: template.language,
        difficulty: template.difficulty,
      });
    },
    [onSelect]
  );

  return (
    <div className={styles.templatesContainer}>
      <Stack gap="normal">
        <div>
          <Heading as="h2" className={styles.headerTitle}>
            Quick Start Templates
          </Heading>
          <p className={styles.templateDescription}>
            Choose a template to get started, or skip to describe your own challenge.
          </p>
        </div>

        <div
          className={styles.templatesGrid}
          role="group"
          aria-label="Challenge templates"
        >
          {TEMPLATES.map((template) => {
            const IconComponent = template.icon;
            return (
              <button
                key={template.id}
                type="button"
                className={styles.templateCard}
                onClick={() => handleTemplateClick(template)}
                aria-describedby={`template-desc-${template.id}`}
              >
                <div className={styles.templateIcon}>
                  <IconComponent size={20} />
                </div>
                <h3 className={styles.templateTitle}>{template.name}</h3>
                <p
                  id={`template-desc-${template.id}`}
                  className={styles.templateDescription}
                >
                  {template.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className={styles.templatesFooter}>
          <Button variant="invisible" onClick={onSkip}>
            Skip templates and describe your own challenge
          </Button>
        </div>
      </Stack>
    </div>
  );
}
