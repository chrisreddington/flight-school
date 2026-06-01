'use client';

import { PageHeader as PrimerPageHeader } from '@primer/react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** The page title text. */
  title: string;
  /**
   * Heading element level. Defaults to 'h1'. Each page must have exactly
   * one h1; only override when this header is a sub-section heading.
   */
  headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /**
   * Descriptive text rendered below the title. Accepts ReactNode so callers
   * can compose inline skeletons (e.g. `{isLoading ? <SkeletonText/> : text}`)
   * without coupling this component to loading state.
   */
  description?: ReactNode;
  /** Icon or visual rendered before the title. */
  leadingVisual?: ReactNode;
  /** Action buttons or controls rendered beside the title. */
  actions?: ReactNode;
}

/**
 * Canonical page-level heading for every authenticated page.
 * Pure: no loading-state prop — callers compose skeletons inline inside
 * `description` or `actions` as needed.
 */
export function PageHeader({ title, headingLevel = 'h1', description, leadingVisual, actions }: PageHeaderProps) {
  return (
    <PrimerPageHeader>
      <PrimerPageHeader.TitleArea>
        {leadingVisual !== undefined && (
          <PrimerPageHeader.LeadingVisual>{leadingVisual}</PrimerPageHeader.LeadingVisual>
        )}
        <PrimerPageHeader.Title as={headingLevel}>{title}</PrimerPageHeader.Title>
      </PrimerPageHeader.TitleArea>
      {/* Actions must be a direct child of PageHeader (a sibling of TitleArea),
          not nested inside it. Primer places Actions in its own grid cell on
          the title row, right-aligned. Nesting it inside the shrink-wrapped
          TitleArea instead renders it left of the title. */}
      {actions !== undefined && <PrimerPageHeader.Actions>{actions}</PrimerPageHeader.Actions>}
      {description !== undefined && <PrimerPageHeader.Description>{description}</PrimerPageHeader.Description>}
    </PrimerPageHeader>
  );
}
