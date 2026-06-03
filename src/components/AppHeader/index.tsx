/**
 * AppHeader Component
 *
 * Shared header component used across all pages in Flight School.
 * Includes logo, navigation breadcrumbs, settings, and user profile.
 *
 * @example
 * ```tsx
 * // On dashboard (no breadcrumbs)
 * <AppHeader />
 *
 * // On any page (breadcrumbs auto-generated from navigation history)
 * <AppHeader />
 * ```
 */

'use client';

import { useBreadcrumbContext } from '@/contexts/breadcrumb-context';
import { useDebugMode } from '@/contexts/debug-context';
import { useUserProfile } from '@/hooks/use-user-profile';
import {
  ChevronRightIcon,
  CopilotIcon,
  GearIcon,
  LinkExternalIcon,
  RocketIcon,
  StarIcon,
} from '@primer/octicons-react';
import { ActionList, ActionMenu, Avatar, Label, Spinner, Stack } from '@primer/react';
import Link from 'next/link';
import { PrimaryNav } from './PrimaryNav';
import styles from './AppHeader.module.css';

/**
 * Main application header with consistent branding and navigation.
 *
 * Features:
 * - Flight School logo (always links home)
 * - Dynamic breadcrumb trail based on navigation history
 * - User profile menu
 */
export function AppHeader() {
  const { data: profile, isLoading } = useUserProfile();
  const avatarUrl = profile?.user?.avatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4';
  const username = profile?.user?.login || 'user';
  const { isDebugMode } = useDebugMode();
  const { breadcrumbs } = useBreadcrumbContext();

  return (
    <header className={styles.header}>
      <Stack
        direction="horizontal"
        align="center"
        justify="space-between"
        wrap="nowrap"
        gap="normal"
        className={styles.topRow}
      >
        {/* Left side: Logo + Breadcrumbs */}
        <Stack direction="horizontal" align="center" gap="condensed" className={styles.leftGroup}>
          <Link href="/" className={styles.logoLink}>
            <Stack direction="horizontal" align="center" gap="condensed">
              <span className={styles.logoIcon}>
                <RocketIcon size={28} />
              </span>
              <span className={styles.logoText}>Flight School</span>
            </Stack>
          </Link>

          {isDebugMode && (
            <Label variant="danger" size="small">
              Debug
            </Label>
          )}

          {/* Breadcrumbs - validated against current path in context */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
              {breadcrumbs.map((item, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <span key={`${item.label}-${index}`} className={styles.breadcrumbItem}>
                    <ChevronRightIcon size={16} className={styles.breadcrumbSeparator} />
                    {item.href && !isLast ? (
                      <Link href={item.href} className={styles.breadcrumbLink}>
                        {item.label}
                      </Link>
                    ) : (
                      <span className={styles.breadcrumbCurrent} aria-current="page">
                        {item.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </nav>
          )}
        </Stack>

        {/* Right side: Profile */}
        <Stack direction="horizontal" align="center" gap="condensed">
          <ActionMenu>
            <ActionMenu.Anchor>
              <button
                type="button"
                className={styles.avatarButton}
                aria-label={isLoading ? 'Open user menu' : `Open user menu for @${username}`}
              >
                {isLoading ? (
                  <div className={styles.avatarPlaceholder}>
                    <Spinner size="small" />
                  </div>
                ) : (
                  <Avatar src={avatarUrl} size={32} alt="" className={styles.avatar} />
                )}
              </button>
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="small">
              <ActionList>
                {/* Identity row: avatar + handle mirrors GitHub's own user menu.
                    Single-line, no description — the avatar and handle make
                    "your profile" self-evident; the external-link glyph signals
                    it opens github.com. */}
                <ActionList.LinkItem href={`https://github.com/${username}`} target="_blank" rel="noopener noreferrer">
                  <ActionList.LeadingVisual>
                    <Avatar src={avatarUrl} size={20} alt="" />
                  </ActionList.LeadingVisual>
                  @{username}
                  <ActionList.TrailingVisual>
                    <LinkExternalIcon />
                  </ActionList.TrailingVisual>
                </ActionList.LinkItem>
                <ActionList.Divider />
                <ActionList.LinkItem href="/settings">
                  <ActionList.LeadingVisual>
                    <GearIcon />
                  </ActionList.LeadingVisual>
                  Settings
                </ActionList.LinkItem>
                <ActionList.Divider />
                <ActionList.Group>
                  <ActionList.GroupHeading>Resources</ActionList.GroupHeading>
                  <ActionList.LinkItem
                    href="https://github.com/chrisreddington/flight-school"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ActionList.LeadingVisual>
                      <StarIcon />
                    </ActionList.LeadingVisual>
                    Star Flight School
                    <ActionList.TrailingVisual>
                      <LinkExternalIcon />
                    </ActionList.TrailingVisual>
                  </ActionList.LinkItem>
                  <ActionList.LinkItem
                    href="https://github.com/github/copilot-sdk"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ActionList.LeadingVisual>
                      <CopilotIcon />
                    </ActionList.LeadingVisual>
                    Copilot SDK
                    <ActionList.TrailingVisual>
                      <LinkExternalIcon />
                    </ActionList.TrailingVisual>
                  </ActionList.LinkItem>
                </ActionList.Group>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </Stack>
      </Stack>

      <div className={styles.navRow}>
        <PrimaryNav />
      </div>
    </header>
  );
}
