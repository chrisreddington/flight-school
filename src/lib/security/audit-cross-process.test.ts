/**
 * @vitest-environment node
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetAuditState, hashUserId } from './audit';

const requireFromHere = createRequire(import.meta.url);
const tsxCliPath = requireFromHere.resolve('tsx/cli');
const probeFilePath = join(__dirname, '__fixtures__', 'audit-hash-probe.ts');
const pinnedSalt = 'pinned-test-salt';
const pinnedUserId = 'pinned-user-id';

interface ChildProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runHashProbe(env: NodeJS.ProcessEnv): Promise<ChildProcessResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('node', [tsxCliPath, probeFilePath, pinnedUserId], {
      env,
    });

    let standardOutput = '';
    let standardError = '';
    childProcess.stdout.on('data', (chunk: Buffer) => {
      standardOutput += chunk.toString();
    });
    childProcess.stderr.on('data', (chunk: Buffer) => {
      standardError += chunk.toString();
    });
    childProcess.on('error', reject);
    childProcess.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout: standardOutput.trim(),
        stderr: standardError.trim(),
      });
    });
  });
}

describe('audit hash cross-process determinism', () => {
  afterEach(() => {
    __resetAuditState();
    vi.unstubAllEnvs();
  });

  it('matches the in-process hash when child process uses the same AUDIT_SALT', async () => {
    vi.stubEnv('AUDIT_SALT', pinnedSalt);
    const expectedHash = hashUserId(pinnedUserId);

    const childResult = await runHashProbe({
      ...process.env,
      AUDIT_SALT: pinnedSalt,
    });

    expect(childResult.exitCode).toBe(0);
    expect(childResult.stderr).toBe('');
    expect(childResult.stdout).toBe(expectedHash);
  });

  it('fails in the child process when AUDIT_SALT is unset', async () => {
    const environmentWithoutAuditSalt: NodeJS.ProcessEnv = { ...process.env };
    delete environmentWithoutAuditSalt.AUDIT_SALT;

    const childResult = await runHashProbe(environmentWithoutAuditSalt);

    expect(childResult.exitCode).not.toBe(0);
    expect(childResult.stderr).toContain('AUDIT_SALT is required');
  });
});
