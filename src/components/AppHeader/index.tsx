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
    BugIcon,
    ChevronRightIcon,
    GearIcon,
    GraphIcon,
    PersonIcon,
    RocketIcon,
    SignOutIcon,
} from '@primer/octicons-react';
import {
    ActionList,
    ActionMenu,
    Avatar,
    Heading,
    IconButton,
    Label,
    Spinner,
    Stack,
    Tooltip,
} from '@primer/react';
import Link from 'next/link';
import styles from './AppHeader.module.css';

/**
 * Main application header with consistent branding and navigation.
 *
 * Features:
 * - Flight School logo (always links home)
 * - Dynamic breadcrumb trail based on navigation history
 * - Debug mode toggle
 * - User profile menu
 */
export function AppHeader() {
  const { data: profile, isLoading } = useUserProfile();
  const avatarUrl = profile?.user?.avatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4';
  const username = profile?.user?.login || 'user';
  const { isDebugMode, toggleDebugMode } = useDebugMode();
  const { breadcrumbs } = useBreadcrumbContext();

  return (
    <header className={styles.header}>
      <Stack direction="horizontal" align="center" justify="space-between" wrap="wrap" gap="normal">
        {/* Left side: Logo + Breadcrumbs */}
        <Stack direction="horizontal" align="center" gap="condensed">
          <Link href="/" className={styles.logoLink}>
            <Stack direction="horizontal" align="center" gap="condensed">
              <span className={styles.logoIcon}>
                <RocketIcon size={28} />
              </span>
              <Heading as="h1" className={styles.logoText}>
                Flight School
              </Heading>
            </Stack>
          </Link>
          
          <a 
            href="https://github.com/github/copilot-sdk" 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.sdkBadgeLink}
          >
            <Label variant="accent" size="small">Copilot SDK Demo</Label>
          </a>
          
          {isDebugMode && (
            <Label variant="danger" size="small">Debug</Label>
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

        {/* Right side: Actions + Profile */}
        <Stack direction="horizontal" align="center" gap="condensed">
          <ActionMenu>
            <ActionMenu.Anchor>
              <Tooltip text="Settings">
                <IconButton icon={GearIcon} variant="invisible" aria-label="Settings" />
              </Tooltip>
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium">
              <ActionList>
                <ActionList.Item onSelect={toggleDebugMode}>
                  <ActionList.LeadingVisual><BugIcon /></ActionList.LeadingVisual>
                  Debug Mode
                  <ActionList.TrailingVisual>
                    {isDebugMode ? 'On' : 'Off'}
                  </ActionList.TrailingVisual>
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
          <ActionMenu>
            <ActionMenu.Anchor>
              {isLoading ? (
                <div className={styles.avatarPlaceholder}>
                  <Spinner size="small" />
                </div>
              ) : (
                <Avatar
                  src={avatarUrl}
                  size={32}
                  alt={`@${username}`}
                  className={styles.avatar}
                />
              )}
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium">
              <ActionList>
                <ActionList.Item>
                  <ActionList.LeadingVisual><PersonIcon /></ActionList.LeadingVisual>
                  Your Profile
                  <ActionList.Description>@{username}</ActionList.Description>
                </ActionList.Item>
                <ActionList.LinkItem href="/profile/skills">
                  <ActionList.LeadingVisual><GearIcon /></ActionList.LeadingVisual>
                  Skill Profile
                  <ActionList.Description>Calibrate your skill levels</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.Item>
                  <ActionList.LeadingVisual><GraphIcon /></ActionList.LeadingVisual>
                  Growth Analytics
                  <ActionList.Description>Track your progress over time</ActionList.Description>
                </ActionList.Item>
                <ActionList.Divider />
                <ActionList.Item variant="danger">
                  <ActionList.LeadingVisual><SignOutIcon /></ActionList.LeadingVisual>
                  Sign out
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </Stack>
      </Stack>
    </header>
  );
}

