'use client';

import { AIActivityPanel } from '@/components/AIActivityPanel';
import { BreadcrumbProvider } from '@/contexts/breadcrumb-context';
import { DebugProvider } from '@/contexts/debug-context';
// Import only the Primer CSS that we need for faster load times
import '@primer/css/dist/primer.css';
import { BaseStyles, ThemeProvider } from '@primer/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider colorMode="auto">
      <DebugProvider>
        <BreadcrumbProvider>
          <BaseStyles>
            <div style={{ minHeight: '100vh', backgroundColor: 'var(--bgColor-default)' }}>
              {children}
              <AIActivityPanel />
            </div>
          </BaseStyles>
        </BreadcrumbProvider>
      </DebugProvider>
    </ThemeProvider>
  );
}
