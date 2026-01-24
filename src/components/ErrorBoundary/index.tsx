'use client';

import { Banner, Button, Stack } from '@primer/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary for consistent error handling.
 * 
 * Catches React rendering errors and displays a user-friendly fallback UI.
 * Logs errors for debugging and optionally reports to external service.
 * 
 * @example
 * ```tsx
 * <ErrorBoundary onError={logToSentry}>
 *   <App />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Caught error', { error, errorInfo }, 'ErrorBoundary');
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: '48px 24px', maxWidth: '600px', margin: '0 auto' }}>
          <Stack direction="vertical" gap="normal">
            <Banner variant="critical" title="Something went wrong">
              <p>
                We encountered an unexpected error. Your work is safe, but you may need to refresh
                the page.
              </p>
              {this.state.error && (
                <details style={{ marginTop: '8px' }}>
                  <summary style={{ cursor: 'pointer' }}>Error details</summary>
                  <pre
                    style={{
                      marginTop: '8px',
                      padding: '12px',
                      backgroundColor: 'var(--bgColor-muted)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      overflow: 'auto',
                    }}
                  >
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </Banner>
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Refresh Page
              </Button>
              <Button onClick={() => this.setState({ hasError: false, error: null })}>
                Try Again
              </Button>
            </Stack>
          </Stack>
        </div>
      );
    }

    return this.props.children;
  }
}
