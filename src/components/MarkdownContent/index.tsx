'use client';

/**
 * MarkdownContent Component
 *
 * Shared markdown rendering component for chat messages.
 * Supports GFM (GitHub Flavored Markdown) with basic code block styling.
 *
 * Used by both LearningChat (MessageBubble) and ChallengeAuthoring.
 *
 * PERFORMANCE: Removed heavy syntax highlighting libraries (600KB+) for faster loads.
 * Code blocks use simple styling instead of Prism/highlight.js.
 */

import { Spinner } from '@primer/react';
import dynamic from 'next/dynamic';
import remarkGfm from 'remark-gfm';
import styles from './MarkdownContent.module.css';

// Lazy load markdown rendering to reduce initial bundle
const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <div style={{ padding: '1rem', textAlign: 'center' }}><Spinner size="small" /></div>,
});

/**
 * Props for the {@link MarkdownContent} component.
 */
export interface MarkdownContentProps {
  /** Markdown content to render */
  content: string;
  /** Whether the content is currently streaming */
  isStreaming?: boolean;
  /** Additional CSS class name */
  className?: string;
}

/**
 * Renders markdown content with GFM support and basic code styling.
 *
 * @example
 * ```tsx
 * <MarkdownContent content="**Bold** and `code`" />
 * ```
 */
export function MarkdownContent({
  content,
  isStreaming = false,
  className,
}: MarkdownContentProps) {
  return (
    <div className={`${styles.content} ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const codeString = String(children).replace(/\n$/, '');
            
            // For code blocks, use a simple pre+code with language indicator
            if (match) {
              return (
                <div className={styles.codeBlock}>
                  <div className={styles.codeHeader}>
                    <span className={styles.language}>{match[1]}</span>
                  </div>
                  <pre>
                    <code>{codeString}</code>
                  </pre>
                </div>
              );
            }
            
            // Inline code
            return (
              <code className={styles.inlineCode} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && <span className={styles.streamingCursor}>▊</span>}
    </div>
  );
}
