import { logs, SeverityNumber } from '@opentelemetry/api-logs';

import { INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION } from '@/lib/observability/semconv';
import { getActiveTraceContext } from '@/lib/observability/telemetry';
import { now } from '@/lib/utils/date-utils';

/**
 * Application Logger
 *
 * Standardized logging utility for server and client.
 * Supports log levels, tags, and structured data. On the server, log
 * records are also bridged to the OTel logs API so they appear in the
 * Aspire dashboard's Structured Logs view with the active `trace_id`
 * and `span_id` attached.
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

const LEVEL_TO_SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const isServer = typeof window === 'undefined';
const otelLogger = isServer
  ? logs.getLogger(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION)
  : null;

class Logger {
  private enrichDataWithTraceContext(data: unknown): unknown {
    const traceContext = getActiveTraceContext();
    if (!traceContext) {
      return data;
    }

    if (data === undefined) {
      return traceContext;
    }

    if (data instanceof Error) {
      return {
        ...traceContext,
        error: {
          name: data.name,
          message: data.message,
          stack: data.stack,
        },
      };
    }

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return { ...data, ...traceContext };
    }

    return {
      ...traceContext,
      value: data,
    };
  }

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

  private emitOtelLog(level: LogLevel, message: string, data: unknown, tag?: string): void {
    if (!otelLogger) return;
    const attributes: Record<string, unknown> = {};
    if (tag) attributes['log.tag'] = tag;
    if (data !== undefined) {
      if (data instanceof Error) {
        attributes['exception.type'] = data.name;
        attributes['exception.message'] = data.message;
        if (data.stack) attributes['exception.stacktrace'] = data.stack;
      } else if (typeof data === 'object' && data !== null) {
        // Spread structured fields onto the log record so dashboards can
        // filter on them. Skip the trace context — the logs SDK injects
        // trace_id/span_id from the active context automatically.
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          if (key === 'traceId' || key === 'spanId') continue;
          attributes[`app.${key}`] = value;
        }
      } else {
        attributes['app.data'] = data;
      }
    }
    otelLogger.emit({
      severityNumber: LEVEL_TO_SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: attributes as Record<string, string | number | boolean>,
    });
  }

  private internalLog(level: LogLevel, message: string, data?: unknown, tag?: string) {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, tag);
    const enrichedData = this.enrichDataWithTraceContext(data);
    const args = enrichedData !== undefined ? [formatted, enrichedData] : [formatted];

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

    this.emitOtelLog(level, message, data, tag);
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
