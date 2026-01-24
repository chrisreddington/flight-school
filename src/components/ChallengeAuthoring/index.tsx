'use client';

/**
 * Challenge Authoring Component
 *
 * Main component for creating custom challenges through guided AI conversation.
 * Orchestrates the chat mode and directly saves challenges when generated.
 *
 * Features:
 * - Multi-turn conversation to gather challenge requirements
 * - Quick templates for common challenge types
 * - Direct save when challenge is generated (no preview step)
 * - Focus management for accessibility (AC10.5)
 *
 * @see SPEC-006 for custom challenge authoring requirements
 */

import type { DailyChallenge } from '@/lib/focus/types';
import { CopilotIcon } from '@primer/octicons-react';
import { Heading, Stack } from '@primer/react';
import { useCallback, useRef, useState } from 'react';
import { AuthoringChat } from './authoring-chat';
import styles from './ChallengeAuthoring.module.css';
import { QuickTemplates, type TemplateSelection } from './quick-templates';

/**
 * Authoring mode state.
 */
type AuthoringMode = 'templates' | 'chat';

/**
 * Props for the {@link ChallengeAuthoring} component.
 */
export interface ChallengeAuthoringProps {
  /** Callback when a challenge is saved to the queue */
  onSaveChallenge: (challenge: DailyChallenge) => void;
  /** Initial template to use (skips template selection) */
  initialTemplate?: string;
  /** User's avatar URL for chat messages */
  userAvatarUrl?: string;
}

/**
 * Main challenge authoring component.
 *
 * Provides a guided experience for creating custom challenges:
 * 1. Quick templates (optional starting point)
 * 2. Chat conversation to define requirements
 * 3. Direct save when challenge is generated
 *
 * @example
 * ```tsx
 * <ChallengeAuthoring
 *   onSaveChallenge={(challenge) => {
 *     addToQueue(challenge);
 *     router.push('/');
 *   }}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function ChallengeAuthoring({
  onSaveChallenge,
  initialTemplate,
  userAvatarUrl,
}: ChallengeAuthoringProps) {
  const [mode, setMode] = useState<AuthoringMode>(initialTemplate ? 'chat' : 'templates');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSelection | null>(
    initialTemplate ? { name: initialTemplate, description: '' } : null
  );

  // Refs for focus management (AC10.5)
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Handle template selection - transition to chat mode.
   */
  const handleTemplateSelect = useCallback((template: TemplateSelection) => {
    setSelectedTemplate(template);
    setMode('chat');
    // Focus chat input after mode switch
    setTimeout(() => chatInputRef.current?.focus(), 0);
  }, []);

  /**
   * Handle skipping templates - go directly to chat.
   */
  const handleSkipTemplates = useCallback(() => {
    setMode('chat');
    setTimeout(() => chatInputRef.current?.focus(), 0);
  }, []);

  /**
   * Handle challenge generated from chat - directly save (no preview step).
   */
  const handleChallengeGenerated = useCallback((challenge: DailyChallenge) => {
    // Directly save the challenge - user already trusts it from the conversation
    onSaveChallenge(challenge);
  }, [onSaveChallenge]);

  /**
   * Handle conversation ID update from chat.
   */
  const handleConversationIdChange = useCallback((id: string) => {
    setConversationId(id);
  }, []);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <Stack direction="horizontal" align="center" gap="condensed">
          <span className={styles.headerIcon}>
            <CopilotIcon size={20} />
          </span>
          <Heading as="h1" className={styles.headerTitle}>
            {mode === 'templates' && 'Create a Challenge'}
            {mode === 'chat' && 'Design Your Challenge'}
          </Heading>
        </Stack>
      </div>

      {/* Main Content */}
      <div className={styles.content}>
        {mode === 'templates' && (
          <QuickTemplates
            onSelect={handleTemplateSelect}
            onSkip={handleSkipTemplates}
          />
        )}

        {mode === 'chat' && (
          <AuthoringChat
            ref={chatInputRef}
            template={selectedTemplate}
            conversationId={conversationId}
            onConversationIdChange={handleConversationIdChange}
            onChallengeGenerated={handleChallengeGenerated}
            userAvatarUrl={userAvatarUrl}
          />
        )}
      </div>
    </div>
  );
}
