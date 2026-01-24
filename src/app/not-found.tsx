'use client';

import {
  ActionList,
  ActionMenu,
  Avatar,
  Button,
  Heading,
  Label,
  Stack,
  Text,
} from '@primer/react';
import {
  CopilotIcon,
  HomeIcon,
  PersonIcon,
  RocketIcon,
  SearchIcon,
  StarIcon,
} from '@primer/octicons-react';
import Link from 'next/link';
import styles from '@/components/ErrorBoundary/ErrorBoundary.module.css';

/**
 * Custom 404 Not Found page with Flight School branding.
 *
 * Uses the same layout pattern as ErrorBoundary for consistency.
 */
export default function NotFound() {
  return (
    <div className={styles.errorPage}>
      {/* Simplified header for error state */}
      <header className={styles.header}>
        <Stack
          direction="horizontal"
          align="center"
          justify="space-between"
          wrap="wrap"
          gap="normal"
        >
          {/* Left side: Logo */}
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
              <Label variant="accent" size="small">
                Copilot SDK Demo
              </Label>
            </a>
          </Stack>

          {/* Right side: User menu with placeholder */}
          <Stack direction="horizontal" align="center" gap="condensed">
            <ActionMenu>
              <ActionMenu.Anchor>
                <Avatar
                  src="https://avatars.githubusercontent.com/u/0?v=4"
                  size={32}
                  alt="User"
                  className={styles.avatar}
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay width="medium">
                <ActionList>
                  <ActionList.Item inert>
                    <ActionList.LeadingVisual>
                      <PersonIcon />
                    </ActionList.LeadingVisual>
                    Guest User
                  </ActionList.Item>
                  <ActionList.Divider />
                  <ActionList.LinkItem
                    href="https://github.com/chrisreddington/flight-school"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ActionList.LeadingVisual>
                      <StarIcon />
                    </ActionList.LeadingVisual>
                    Flight School
                    <ActionList.Description>Star or contribute on GitHub</ActionList.Description>
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
                    <ActionList.Description>Build your own AI apps</ActionList.Description>
                  </ActionList.LinkItem>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </Stack>
        </Stack>
      </header>

      {/* 404 content */}
      <main className={styles.content}>
        <Stack direction="vertical" align="center" gap="normal" className={styles.blankslate}>
          <div className={styles.visual}>
            <SearchIcon size={48} className={styles.notFoundIcon} />
          </div>

          <Heading as="h2" className={styles.blankslateHeading}>
            Page not found
          </Heading>

          <Text as="p" className={styles.blankslateDescription}>
            The page you&apos;re looking for doesn&apos;t exist or may have been moved.
          </Text>

          <Stack direction="horizontal" gap="condensed" className={styles.actions}>
            <Button as={Link} href="/" variant="primary">
              <HomeIcon size={16} /> Go to Dashboard
            </Button>
          </Stack>
        </Stack>
      </main>
    </div>
  );
}
