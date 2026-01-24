/**
 * Debug route to test GitHub authentication
 * 
 * ⚠️ DEVELOPMENT ONLY - This endpoint is disabled in production.
 */

import { getGitHubToken, isGitHubConfigured } from '@/lib/github/client';
import { NextResponse } from 'next/server';
import { Octokit } from 'octokit';

export async function GET() {
  // Gate behind environment check - don't expose debug info in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 404 }
    );
  }

  const logs: string[] = [];
  
  try {
    logs.push('[1] Checking if GitHub is configured...');
    const isConfigured = await isGitHubConfigured();
    logs.push(`[2] isGitHubConfigured() = ${isConfigured}`);
    
    logs.push('[3] Getting token...');
    const token = await getGitHubToken();
    logs.push(`[4] Token retrieved: ${token ? `${token.substring(0, 8)}... (length: ${token.length})` : 'null'}`);
    
    if (!token) {
      return NextResponse.json({
        success: false,
        configured: isConfigured,
        tokenAvailable: false,
        logs,
        env: {
          GITHUB_TOKEN_set: !!process.env.GITHUB_TOKEN,
          NODE_ENV: process.env.NODE_ENV,
        }
      });
    }
    
    logs.push('[5] Creating Octokit instance...');
    const octokit = new Octokit({ auth: token });
    
    logs.push('[6] Testing authentication with GitHub...');
    const { data: user } = await octokit.rest.users.getAuthenticated();
    logs.push(`[7] Successfully authenticated as: ${user.login}`);
    
    return NextResponse.json({
      success: true,
      configured: isConfigured,
      tokenAvailable: true,
      user: user.login,
      logs,
      env: {
        GITHUB_TOKEN_set: !!process.env.GITHUB_TOKEN,
        NODE_ENV: process.env.NODE_ENV,
      }
    });
  } catch (error) {
    logs.push(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      logs,
      env: {
        GITHUB_TOKEN_set: !!process.env.GITHUB_TOKEN,
        NODE_ENV: process.env.NODE_ENV,
      }
    }, { status: 500 });
  }
}
