'use client';

import { HeartFillIcon } from '@primer/octicons-react';
import { Link, Stack, Text } from '@primer/react';
import styles from './Dashboard.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <Stack align="center" gap="condensed">
        <Stack direction="horizontal" align="center" gap="condensed">
          <Text className={styles.footerText}>Made with</Text>
          <HeartFillIcon size={16} className={styles.footerHeart} />
          <Text className={styles.footerText}>by</Text>
          <Link 
            href="https://github.com/chrisreddington" 
            className={styles.footerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            @chrisreddington
          </Link>
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Text className={styles.footerText}>Learn more about</Text>
          <Link 
            href="https://github.com/github/copilot-cli" 
            className={styles.footerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Copilot CLI
          </Link>
          <Text className={styles.footerText}>and</Text>
          <Link 
            href="https://github.com/github/copilot-sdk" 
            className={styles.footerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Copilot SDK
          </Link>
        </Stack>
      </Stack>
    </footer>
  );
}
