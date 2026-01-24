/**
 * Tests for application logger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger';

// =============================================================================
// Setup
// =============================================================================

describe('logger', () => {
  const consoleSpy = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ===========================================================================
  // Basic Logging
  // ===========================================================================

  describe('basic logging', () => {
    it('should log info messages', () => {
      logger.info('Test message');
      expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining('Test message'));
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'));
    });

    it('should log error messages', () => {
      logger.error('Error message');
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Error message'));
    });

    it('should log messages with data', () => {
      const data = { key: 'value', count: 42 };
      logger.info('With data', data);
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('With data'),
        data
      );
    });
  });

  // ===========================================================================
  // Debug Level
  // ===========================================================================

  describe('debug level', () => {
    it('should log debug in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development');
      logger.debug('Debug message');
      expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'));
    });

    it('should log debug when NEXT_PUBLIC_DEBUG is true', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_DEBUG', 'true');
      logger.debug('Debug message');
      expect(consoleSpy.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'));
    });

    it('should suppress debug in production without debug flag', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_DEBUG', 'false');
      logger.debug('Debug message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Tagged Logger
  // ===========================================================================

  describe('withTag', () => {
    it('should create a tagged logger', () => {
      const taggedLogger = logger.withTag('MyTag');
      expect(taggedLogger).toBeDefined();
      expect(taggedLogger.info).toBeDefined();
      expect(taggedLogger.warn).toBeDefined();
      expect(taggedLogger.error).toBeDefined();
      expect(taggedLogger.debug).toBeDefined();
    });

    it('should include tag in log messages', () => {
      const taggedLogger = logger.withTag('API');
      taggedLogger.info('Request received');
      expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining('[API]'));
    });

    it('should preserve tag across multiple calls', () => {
      const taggedLogger = logger.withTag('Storage');
      taggedLogger.info('First message');
      taggedLogger.warn('Second message');
      
      expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining('[Storage]'));
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('[Storage]'));
    });

    it('should pass data through tagged logger', () => {
      const taggedLogger = logger.withTag('Test');
      const data = { id: 123 };
      taggedLogger.error('Failed', data);
      
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[Test]'),
        data
      );
    });
  });

  // ===========================================================================
  // Message Formatting
  // ===========================================================================

  describe('message formatting', () => {
    it('should handle empty data', () => {
      logger.info('No data');
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info).toHaveBeenCalledWith(expect.any(String));
    });

    it('should handle undefined data', () => {
      logger.info('Undefined data', undefined);
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Log Levels Always Output
  // ===========================================================================

  describe('log level behavior', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NEXT_PUBLIC_DEBUG', 'false');
    });

    it.each(['info', 'warn', 'error'] as const)(
      'should always log %s level in production',
      (level) => {
        logger[level](`${level} message`);
        expect(consoleSpy[level]).toHaveBeenCalled();
      }
    );
  });
});
