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
    CopilotIcon,
    FlameIcon,
    GearIcon,
    HistoryIcon,
    PersonIcon,
    RocketIcon,
    StarIcon,
} from '@primer/octicons-react';
import {
    ActionList,
    ActionMenu,
    Avatar,
    Heading,
    Label,
    Spinner,
    Stack,
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

        {/* Right side: Profile */}
        <Stack direction="horizontal" align="center" gap="condensed">
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
                <ActionList.Item inert>
                  <ActionList.LeadingVisual><PersonIcon /></ActionList.LeadingVisual>
                  @{username}
                </ActionList.Item>
                <ActionList.Divider />
                <ActionList.LinkItem href="/habits">
                  <ActionList.LeadingVisual><FlameIcon /></ActionList.LeadingVisual>
                  My Habits
                  <ActionList.Description>Track and manage your habits</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.LinkItem href="/focus-history">
                  <ActionList.LeadingVisual><HistoryIcon /></ActionList.LeadingVisual>
                  Focus History
                  <ActionList.Description>View past focus items</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.Divider />
                <ActionList.LinkItem href="/profile/skills">
                  <ActionList.LeadingVisual><GearIcon /></ActionList.LeadingVisual>
                  Skill Profile
                  <ActionList.Description>Calibrate your skill levels</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.Divider />
                <ActionList.LinkItem 
                  href="https://github.com/chrisreddington/flight-school" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <ActionList.LeadingVisual><StarIcon /></ActionList.LeadingVisual>
                  Flight School
                  <ActionList.Description>Star or contribute on GitHub</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.LinkItem 
                  href="https://github.com/github/copilot-sdk" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <ActionList.LeadingVisual><CopilotIcon /></ActionList.LeadingVisual>
                  Copilot SDK
                  <ActionList.Description>Build your own AI apps</ActionList.Description>
                </ActionList.LinkItem>
                <ActionList.Divider />
                <ActionList.Item onSelect={toggleDebugMode}>
                  <ActionList.LeadingVisual><BugIcon /></ActionList.LeadingVisual>
                  Debug Mode
                  <ActionList.TrailingVisual>
                    {isDebugMode ? 'On' : 'Off'}
                  </ActionList.TrailingVisual>
                </ActionList.Item>
                <ActionList.Divider />
                <ActionList.Item disabled>
                  {profile?.meta?.authMethod === 'github-token' && 'Logged in via GITHUB_TOKEN'}
                  {profile?.meta?.authMethod === 'github-cli' && 'Logged in via GitHub CLI'}
                  {profile?.meta?.authMethod === 'copilot-mcp' && 'Logged in via Copilot SDK'}
                  {/* If we have a real profile but no authMethod (old cache), show generic message */}
                  {(!profile?.meta?.authMethod || profile?.meta?.authMethod === 'none') && 
                    (profile?.user?.login && profile.user.login !== 'demo-user' 
                      ? 'Logged in via GitHub CLI' 
                      : 'Not authenticated')}
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </Stack>
      </Stack>
    </header>
  );
}

