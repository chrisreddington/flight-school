'use client';

import { HeartFillIcon } from '@primer/octicons-react';
import { Link, Stack, Text } from '@primer/react';
import styles from './Dashboard.module.css';

const POWERED_BY_LINKS = [
  { name: 'GitHub Copilot SDK', href: 'https://github.com/github/copilot-sdk' },
  { name: 'Octokit', href: 'https://github.com/octokit/octokit.js' },
  { name: 'Next.js', href: 'https://github.com/vercel/next.js' },
  { name: 'Primer', href: 'https://github.com/primer/react' },
  { name: 'Vitest', href: 'https://github.com/vitest-dev/vitest' },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <Stack align="center" gap="condensed">
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
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
          <Text className={styles.footerText}>and</Text>
          <Link 
            href="https://github.com/github/copilot-cli" 
            className={styles.footerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Copilot CLI
          </Link>
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Text className={styles.footerText}>Powered by</Text>
          {POWERED_BY_LINKS.map((link, index) => (
            <span key={link.name}>
              <Link 
                href={link.href} 
                className={styles.footerLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.name}
              </Link>
              {index < POWERED_BY_LINKS.length - 1 && (
                <Text className={styles.footerText}>{index === POWERED_BY_LINKS.length - 2 ? ' & ' : ', '}</Text>
              )}
            </span>
          ))}
        </Stack>
      </Stack>
    </footer>
  );
}
