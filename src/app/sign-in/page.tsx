import { MarkGithubIcon } from '@primer/octicons-react';
import { Button, Heading, Text } from '@primer/react';

import { signInWithGitHub } from './actions';
import styles from './sign-in.module.css';

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl, error } = await searchParams;

  async function action(): Promise<void> {
    'use server';
    await signInWithGitHub(callbackUrl);
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <Heading as="h1" className={styles.title}>
          Welcome to Flight School
        </Heading>
        <Text as="p" className={styles.subtitle}>
          Sign in with your GitHub account to access personalized challenges,
          AI coaching, and your learning history.
        </Text>
      </header>

      {error ? (
        <Text as="p" className={styles.error} role="alert">
          Sign in failed. Please try again.
        </Text>
      ) : null}

      <form action={action}>
        <Button type="submit" variant="primary" size="large" leadingVisual={MarkGithubIcon}>
          Sign in with GitHub
        </Button>
      </form>
    </main>
  );
}
