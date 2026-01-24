import { now } from '@/lib/utils/date-utils';

/**
 * Application Logger
 *
 * Standardized logging utility for server and client.
 * Supports log levels, tags, and structured data.
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * // Basic usage
 * logger.info('Server started');
 *
 * // With tagging
 * const apiLogger = logger.withTag('API');
 * apiLogger.info('Request received', { path: '/api/focus' });
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private shouldLog(level: LogLevel): boolean {
    if (level === 'debug') {
      // Only debug in development or if explicitly enabled
      return (
        process.env.NODE_ENV === 'development' ||
        process.env.NEXT_PUBLIC_DEBUG === 'true'
      );
    }
    return true;
  }

  private formatMessage(level: LogLevel, message: string, tag?: string): string {
    const timestamp = now();
    const tagPrefix = tag ? `[${tag}]` : '';
    // On server, timestamps are useful. On client, browser console handles it.
    const timePrefix = typeof window === 'undefined' ? `${timestamp} ` : '';
    
    return `${timePrefix}${tagPrefix} ${message}`.trim();
  }

  private internalLog(level: LogLevel, message: string, data?: unknown, tag?: string) {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, tag);
    const args = data !== undefined ? [formatted, data] : [formatted];

    switch (level) {
      case 'error':
        console.error(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'info':
        console.info(...args);
        break;
      case 'debug':
        console.debug(...args);
        break;
    }
  }

  debug(message: string, data?: unknown, tag?: string) {
    this.internalLog('debug', message, data, tag);
  }

  info(message: string, data?: unknown, tag?: string) {
    this.internalLog('info', message, data, tag);
  }

  warn(message: string, data?: unknown, tag?: string) {
    this.internalLog('warn', message, data, tag);
  }

  error(message: string, data?: unknown, tag?: string) {
    this.internalLog('error', message, data, tag);
  }

  /**
   * Creates a scoped logger with a permanent tag
   */
  withTag(tag: string) {
    return {
      debug: (message: string, data?: unknown) => this.debug(message, data, tag),
      info: (message: string, data?: unknown) => this.info(message, data, tag),
      warn: (message: string, data?: unknown) => this.warn(message, data, tag),
      error: (message: string, data?: unknown) => this.error(message, data, tag),
    };
  }
}

export const logger = new Logger();
