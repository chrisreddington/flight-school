'use client';

import { AIActivityPanel } from '@/components/AIActivityPanel';
import { CopilotRequiredBanner } from '@/components/CopilotRequiredBanner';
import { BrowserOtelBootstrap } from '@/components/observability/BrowserOtelBootstrap';
import { BreadcrumbProvider } from '@/contexts/breadcrumb-context';
import { DebugProvider } from '@/contexts/debug-context';
// Import only the Primer CSS that we need for faster load times
import '@primer/css/dist/primer.css';
import { BaseStyles, ThemeProvider } from '@primer/react';
import styles from './providers.module.css';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider colorMode="auto">
      <DebugProvider>
        <BreadcrumbProvider>
          <BaseStyles>
            <BrowserOtelBootstrap />
            <div className={styles.appRoot}>
              <CopilotRequiredBanner />
              {children}
              <AIActivityPanel />
            </div>
          </BaseStyles>
        </BreadcrumbProvider>
      </DebugProvider>
    </ThemeProvider>
  );
}
